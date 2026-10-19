import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml, stringify } from "yaml";
import { cloneRepo, commitAll } from "@/lib/git";
import { dataDir, caddyfilePath, storeWorkDir } from "@/lib/paths";
import { errorMessage } from "@/lib/redact";
import type { Settings } from "@/lib/settings";
import { validateEntry } from "@/lib/validate";

const exec = promisify(execFile);

export async function backupToDrive(settings: Settings): Promise<{ id: string; name: string }> {
  if (!settings.drive.enabled) throw new Error("Google Drive backup is turned off");
  if (!settings.drive.accessToken) throw new Error("Add a Google Drive access token in Settings");
  const bundle = path.join(dataDir(), "backups", settings.drive.fileName || "heil-store.bundle");
  await mkdir(path.dirname(bundle), { recursive: true });
  await exec("git", ["bundle", "create", bundle, "--all"], { cwd: storeWorkDir() });
  const bytes = await readFile(bundle);
  const token = settings.drive.accessToken;
  const folder = settings.drive.folderId;
  const query = new URLSearchParams({
    q: `name = '${(settings.drive.fileName || "heil-store.bundle").replace(/'/g, "\\'")}' and trashed = false${folder ? ` and '${folder}' in parents` : ""}`,
    fields: "files(id,name)",
    spaces: "drive",
  });
  const existing = await driveFetch(`https://www.googleapis.com/drive/v3/files?${query}`, token);
  const found = (existing.files ?? [])[0];
  const metadata = {
    name: settings.drive.fileName || "heil-store.bundle",
    ...(folder && !found ? { parents: [folder] } : {}),
  };
  const boundary = "heilss-drive";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const url = found
    ? `https://www.googleapis.com/upload/drive/v3/files/${found.id}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const response = await fetch(url, {
    method: found ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!response.ok) throw new Error(`Google Drive returned ${response.status}`);
  const saved = (await response.json()) as { id: string; name: string };
  return saved;
}

async function driveFetch(url: string, token: string): Promise<{ files?: { id: string; name: string }[] }> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Google Drive returned ${response.status}`);
  return (await response.json()) as { files?: { id: string; name: string }[] };
}

export async function applyDomain(settings: Settings): Promise<{ name: string; caddyfile: string }> {
  if (!settings.domain.enabled) throw new Error("Domain setup is turned off");
  const domain = settings.domain;
  if (!domain.cloudflareToken || !domain.zoneName || !domain.recordName || !domain.target) {
    throw new Error("Zone, record name, target, and a Cloudflare token are required");
  }
  const headers = {
    Authorization: `Bearer ${domain.cloudflareToken}`,
    "Content-Type": "application/json",
  };
  const zoneResponse = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(domain.zoneName)}`, { headers });
  if (!zoneResponse.ok) throw new Error(`Cloudflare returned ${zoneResponse.status}`);
  const zoneBody = (await zoneResponse.json()) as { success: boolean; result?: { id: string }[]; errors?: { message: string }[] };
  if (!zoneBody.success || !zoneBody.result?.[0]) {
    throw new Error(zoneBody.errors?.[0]?.message || "Cloudflare zone was not found");
  }
  const zoneId = zoneBody.result[0].id;
  const fqdn = domain.recordName === "@" ? domain.zoneName : `${domain.recordName}.${domain.zoneName}`;
  const list = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=${domain.recordType}&name=${encodeURIComponent(fqdn)}`,
    { headers },
  );
  const listed = (await list.json()) as { result?: { id: string }[] };
  const payload = {
    type: domain.recordType,
    name: fqdn,
    content: domain.target,
    proxied: domain.proxied,
    ttl: domain.proxied ? 1 : 300,
  };
  const existing = listed.result?.[0];
  const write = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records${existing ? `/${existing.id}` : ""}`,
    { method: existing ? "PUT" : "POST", headers, body: JSON.stringify(payload) },
  );
  const written = (await write.json()) as { success: boolean; errors?: { message: string }[] };
  if (!write.ok || !written.success) throw new Error(written.errors?.[0]?.message || `Cloudflare returned ${write.status}`);
  const upstream = domain.caddyUpstream || "umbrel.local:8480";
  const caddyfile = `${fqdn} {\n\treverse_proxy ${upstream}\n}\n`;
  await mkdir(path.dirname(caddyfilePath()), { recursive: true });
  await writeFile(caddyfilePath(), caddyfile);
  return { name: fqdn, caddyfile };
}

export async function importStore(url: string, settings: Settings): Promise<{ imported: string[]; issues: string[] }> {
  const dest = path.join(dataDir(), "tmp", `import-${Date.now()}`);
  try {
    await cloneRepo(url, dest);
    const metaRaw = await readFile(path.join(dest, "umbrel-app-store.yml"), "utf8");
    const meta = parseYaml(metaRaw) as { id?: string; name?: string };
    if (!meta?.id) throw new Error("That repository has no umbrel-app-store.yml id");
    const names = await readdir(dest, { withFileTypes: true });
    const imported: string[] = [];
    const issues: string[] = [];
    const usedPorts = new Set<number>();
    const existing = await readdir(storeWorkDir(), { withFileTypes: true });
    for (const entry of existing) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = parseYaml(await readFile(path.join(storeWorkDir(), entry.name, "umbrel-app.yml"), "utf8")) as { port?: number };
        if (typeof manifest.port === "number") usedPorts.add(manifest.port);
      } catch {
        continue;
      }
    }
    for (const entry of names) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const manifestPath = path.join(dest, entry.name, "umbrel-app.yml");
      const composePath = path.join(dest, entry.name, "docker-compose.yml");
      let manifestYaml: string;
      let composeYaml: string;
      try {
        manifestYaml = await readFile(manifestPath, "utf8");
        composeYaml = await readFile(composePath, "utf8");
      } catch {
        continue;
      }
      const manifest = parseYaml(manifestYaml) as Record<string, unknown>;
      let id = String(manifest.id ?? entry.name);
      if (!id.startsWith(`${settings.storeId}-`)) {
        const suffix = id.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
        id = `${settings.storeId}-${suffix}`.replace(/-{2,}/g, "-");
      }
      if (existing.some((item) => item.name === id) || imported.includes(id)) {
        issues.push(`${entry.name} skipped because ${id} already exists`);
        continue;
      }
      manifest.id = id;
      let port = Number(manifest.port);
      if (!Number.isInteger(port) || usedPorts.has(port)) {
        port = 32000;
        while (usedPorts.has(port)) port += 1;
        manifest.port = port;
      }
      usedPorts.add(port);
      const nextManifest = stringify(manifest, { lineWidth: 0 });
      const nextCompose = rewriteAppHost(composeYaml, String(manifest.id ?? entry.name), id);
      const validation = validateEntry({
        storeId: settings.storeId,
        id,
        manifestYaml: nextManifest,
        composeYaml: nextCompose,
        usedPorts: [...usedPorts].filter((item) => item !== port),
      });
      const errors = validation.filter((issue) => issue.level === "error");
      if (errors.length) {
        issues.push(`${entry.name}: ${errors.map((issue) => issue.message).join("; ")}`);
        continue;
      }
      const target = path.join(storeWorkDir(), id);
      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "umbrel-app.yml"), nextManifest.endsWith("\n") ? nextManifest : `${nextManifest}\n`);
      await writeFile(path.join(target, "docker-compose.yml"), nextCompose.endsWith("\n") ? nextCompose : `${nextCompose}\n`);
      for (const icon of ["icon.svg", "icon.png", "icon.webp"]) {
        try {
          await writeFile(path.join(target, icon), await readFile(path.join(dest, entry.name, icon)));
        } catch {
          continue;
        }
      }
      imported.push(id);
    }
    if (imported.length === 0) throw new Error(issues.join("\n") || "No apps could be imported");
    await commitAll(`Import ${imported.length} app${imported.length === 1 ? "" : "s"} from ${safeUrl(url)}`);
    return { imported, issues };
  } catch (error) {
    throw new Error(errorMessage(error));
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
}

function rewriteAppHost(compose: string, previousId: string, nextId: string): string {
  if (previousId === nextId) return compose;
  return compose.replaceAll(`${previousId}_`, `${nextId}_`);
}

function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return "a community store";
  }
}

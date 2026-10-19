import { mkdir, readdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { buildEntry, bumpVersion, type BuildInput, type BuiltEntry, type EntryMeta } from "@/lib/build";
import { commitAll, diffFor, ensureStore, historyFor, restorePath, storeMetaYaml } from "@/lib/git";
import { withLock } from "@/lib/lock";
import { stripDigestImage } from "@/lib/parse";
import { storeWorkDir } from "@/lib/paths";
import { errorMessage } from "@/lib/redact";
import { inspectImage } from "@/lib/registry";
import { assertStoreId, readSettings, type Settings } from "@/lib/settings";
import { validateEntry, type Issue } from "@/lib/validate";

export type EntrySummary = {
  id: string;
  name: string;
  tagline: string;
  category: string;
  version: string;
  port: number;
  icon: string;
  umbrelLogin: boolean;
  image?: string;
  updateAvailable?: boolean;
};

export type EntryDetail = EntrySummary & {
  description: string;
  manifestYaml: string;
  composeYaml: string;
  source: string;
  issues: Issue[];
};

async function readMeta(id: string): Promise<EntryMeta | null> {
  try {
    const raw = await readFile(path.join(storeWorkDir(), id, ".heilss-meta.json"), "utf8");
    return JSON.parse(raw) as EntryMeta;
  } catch {
    return null;
  }
}

async function readManifestFile(id: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path.join(storeWorkDir(), id, "umbrel-app.yml"), "utf8");
  return parseYaml(raw) as Record<string, unknown>;
}

export async function listEntries(): Promise<EntrySummary[]> {
  const settings = await readSettings();
  await ensureStore(settings.storeId, settings.storeName);
  const entries = await readdir(storeWorkDir(), { withFileTypes: true });
  const apps: EntrySummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    try {
      const manifest = await readManifestFile(entry.name);
      const meta = await readMeta(entry.name);
      apps.push({
        id: String(manifest.id ?? entry.name),
        name: String(manifest.name ?? entry.name),
        tagline: String(manifest.tagline ?? ""),
        category: String(manifest.category ?? ""),
        version: String(manifest.version ?? ""),
        port: Number(manifest.port ?? 0),
        icon: String(manifest.icon ?? ""),
        umbrelLogin: meta?.umbrelLogin !== false,
        image: meta?.image,
      });
    } catch {
      continue;
    }
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));
  return apps;
}

async function usedPorts(exceptId?: string): Promise<number[]> {
  const entries = await listEntries();
  return entries.filter((entry) => entry.id !== exceptId).map((entry) => entry.port);
}

async function usedIds(exceptId?: string): Promise<string[]> {
  const entries = await listEntries();
  return entries.filter((entry) => entry.id !== exceptId).map((entry) => entry.id);
}

export async function previewEntry(input: BuildInput, existingId?: string): Promise<BuiltEntry> {
  const settings = await readSettings();
  assertStoreId(settings.storeId);
  await ensureStore(settings.storeId, settings.storeName);
  return buildEntry(input, {
    storeId: settings.storeId,
    submitter: settings.submitter,
    publicBaseUrl: settings.publicBaseUrl,
    usedPorts: await usedPorts(existingId),
    usedIds: await usedIds(existingId),
    existingId,
  });
}

async function writeEntry(built: BuiltEntry): Promise<void> {
  const errors = built.issues.filter((issue) => issue.level === "error");
  if (errors.length) {
    throw new Error(errors.map((issue) => issue.message).join("\n"));
  }
  const dir = path.join(storeWorkDir(), built.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "umbrel-app.yml"), built.manifestYaml.endsWith("\n") ? built.manifestYaml : `${built.manifestYaml}\n`);
  await writeFile(path.join(dir, "docker-compose.yml"), built.composeYaml.endsWith("\n") ? built.composeYaml : `${built.composeYaml}\n`);
  await writeFile(path.join(dir, "icon.svg"), built.iconSvg);
  await writeFile(path.join(dir, ".heilss-meta.json"), `${JSON.stringify(built.meta, null, 2)}\n`);
  for (const dataDir of built.dataDirs) {
    const target = path.join(dir, dataDir);
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, ".gitkeep"), "");
  }
}

export async function createEntry(input: BuildInput): Promise<BuiltEntry> {
  return withLock(async () => {
    const built = await previewEntry(input);
    await writeEntry(built);
    await commitAll(`Add ${built.id}`);
    const mirrorWarning = await mirrorAfterChange();
    if (mirrorWarning) built.issues.push({ level: "warning", message: mirrorWarning });
    return built;
  });
}

export async function updateEntry(id: string, input: BuildInput): Promise<BuiltEntry> {
  return withLock(async () => {
    await readManifestFile(id);
    const built = await previewEntry({ ...input, appId: id }, id);
    if (built.id !== id) throw new Error("App id cannot change after it is created");
    await writeEntry(built);
    await commitAll(`Update ${id}`);
    const mirrorWarning = await mirrorAfterChange();
    if (mirrorWarning) built.issues.push({ level: "warning", message: mirrorWarning });
    return built;
  });
}

export async function deleteEntry(id: string): Promise<void> {
  return withLock(async () => {
    const dir = path.join(storeWorkDir(), id);
    const info = await stat(dir).catch(() => null);
    if (!info?.isDirectory()) throw new Error(`No entry named ${id}`);
    await rm(dir, { recursive: true, force: true });
    await commitAll(`Remove ${id}`);
    await mirrorAfterChange();
  });
}

export async function getEntry(id: string): Promise<EntryDetail> {
  const manifest = await readManifestFile(id);
  const meta = await readMeta(id);
  const manifestYaml = await readFile(path.join(storeWorkDir(), id, "umbrel-app.yml"), "utf8");
  const composeYaml = await readFile(path.join(storeWorkDir(), id, "docker-compose.yml"), "utf8");
  const settings = await readSettings();
  const issues = validateEntry({
    storeId: settings.storeId,
    id,
    manifestYaml,
    composeYaml,
    usedPorts: await usedPorts(id),
    ignoreOwnPort: Number(manifest.port),
  });
  return {
    id,
    name: String(manifest.name ?? id),
    tagline: String(manifest.tagline ?? ""),
    category: String(manifest.category ?? ""),
    version: String(manifest.version ?? ""),
    port: Number(manifest.port ?? 0),
    icon: String(manifest.icon ?? ""),
    description: String(manifest.description ?? ""),
    umbrelLogin: meta?.umbrelLogin !== false,
    image: meta?.image,
    manifestYaml,
    composeYaml,
    source: meta?.source || composeYaml,
    issues,
  };
}

export async function entryHistory(id: string) {
  return historyFor(id);
}

export async function entryDiff(id: string, sha: string) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error("Invalid commit");
  return diffFor(sha, id);
}

export async function rollbackEntry(id: string, sha: string): Promise<void> {
  return withLock(async () => {
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error("Invalid commit");
    await restorePath(sha, id);
    await commitAll(`Restore ${id} to ${sha.slice(0, 7)}`);
    await mirrorAfterChange();
  });
}

export async function storeHistory() {
  const settings = await readSettings();
  await ensureStore(settings.storeId, settings.storeName);
  return historyFor();
}

export async function iconFile(id: string): Promise<{ body: Buffer; type: string } | null> {
  const svg = path.join(storeWorkDir(), id, "icon.svg");
  try {
    return { body: await readFile(svg), type: "image/svg+xml" };
  } catch {
    return null;
  }
}

export async function checkImageUpdates(): Promise<{ id: string; image: string; latestDigest?: string; update: boolean; detail?: string }[]> {
  const entries = await listEntries();
  const results = [];
  for (const entry of entries) {
    if (!entry.image) continue;
    const current = await readMeta(entry.id);
    const tag = stripDigestImage(entry.image);
    const info = await inspectImage(tag);
    const update = info.status === "found" && Boolean(info.digest) && info.digest !== current?.digest;
    results.push({
      id: entry.id,
      image: entry.image,
      latestDigest: info.digest,
      update,
      detail: info.status === "found" ? undefined : info.detail,
    });
  }
  return results;
}

export async function applyImageUpdate(id: string): Promise<EntryDetail> {
  return withLock(async () => {
    const current = await getEntry(id);
    const meta = await readMeta(id);
    if (!meta?.image) throw new Error("This entry has no tracked image");
    const tag = stripDigestImage(meta.image);
    const info = await inspectImage(tag);
    if (info.status === "missing") throw new Error(info.detail || "Image is missing from the registry");
    if (info.status !== "found" || !info.digest) throw new Error(info.detail || "Could not read a new image digest");
    if (info.digest === meta.digest) throw new Error("Image is already current");
    const compose = current.composeYaml.replaceAll(meta.image, `${tag}@${info.digest}`);
    const manifest = parseYaml(current.manifestYaml) as Record<string, unknown>;
    manifest.version = bumpVersion(String(manifest.version ?? "1.0.0"));
    manifest.releaseNotes = `Updated the container image to ${info.digest}.`;
    const { stringify } = await import("yaml");
    const manifestYaml = stringify(manifest, { lineWidth: 0 });
    const dir = path.join(storeWorkDir(), id);
    await writeFile(path.join(dir, "docker-compose.yml"), compose.endsWith("\n") ? compose : `${compose}\n`);
    await writeFile(path.join(dir, "umbrel-app.yml"), manifestYaml.endsWith("\n") ? manifestYaml : `${manifestYaml}\n`);
    await writeFile(
      path.join(dir, ".heilss-meta.json"),
      `${JSON.stringify({ ...meta, image: `${tag}@${info.digest}`, digest: info.digest }, null, 2)}\n`,
    );
    await commitAll(`Update image for ${id}`);
    await mirrorAfterChange();
    return getEntry(id);
  });
}

async function mirrorAfterChange(): Promise<string | undefined> {
  const settings = await readSettings();
  try {
    if (settings.github.enabled && settings.github.token && settings.github.repo) {
      const { pushGithub } = await import("@/lib/git");
      await pushGithub(settings.github.repo, settings.github.branch || "main", settings.github.token);
    }
    if (settings.drive.enabled && settings.drive.accessToken) {
      const { backupToDrive } = await import("@/lib/remotes");
      await backupToDrive(settings);
    }
    return undefined;
  } catch (error) {
    return `Saved locally. Mirror failed: ${errorMessage(error)}`;
  }
}

export async function updateStoreMeta(settings: Settings, previous: Settings): Promise<void> {
  if (settings.storeId === previous.storeId && settings.storeName === previous.storeName) return;
  assertStoreId(settings.storeId);
  const names = await readdir(storeWorkDir(), { withFileTypes: true });
  const apps = [];
  for (const entry of names) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    try {
      await readManifestFile(entry.name);
      apps.push(entry.name);
    } catch {
      continue;
    }
  }
  if (settings.storeId !== previous.storeId && apps.length > 0) {
    throw new Error("Store id is locked once the store has apps, because every app id is prefixed with it.");
  }
  const file = path.join(storeWorkDir(), "umbrel-app-store.yml");
  await writeFile(file, storeMetaYaml(settings.storeId, settings.storeName));
  await commitAll("Update store name");
}

export function cloneUrlFor(origin: string, settings: Settings): string {
  const base = (settings.publicBaseUrl || origin).replace(/\/$/, "");
  return `${base}/git/store.git`;
}

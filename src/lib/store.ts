import { mkdir, readdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { buildEntry, bumpVersion, type BuildInput, type BuiltEntry, type EntryMeta } from "@/lib/build";
import { assertWritable, commitAll, diffFor, ensureStore, historyFor, restorePath, storeMetaYaml } from "@/lib/git";
import { decodeIconUpload, fetchRepoIcon, findIconFile, iconHash, isOwnIconUrl, manifestIconUrl, monogramIcon, writeIconFile, type IconData } from "@/lib/icons";
import { withLock } from "@/lib/lock";
import { stripDigestImage } from "@/lib/parse";
import { activeStoreKey, storeWorkDir } from "@/lib/paths";
import { errorMessage } from "@/lib/redact";
import { inspectImage } from "@/lib/registry";
import { assertStoreId, findLinkedStore, readSettings, type LinkedStore, type Settings } from "@/lib/settings";
import { parseDocument } from "yaml";
import { validateEntry, type Issue } from "@/lib/validate";

export type EntrySummary = {
  id: string;
  name: string;
  tagline: string;
  category: string;
  version: string;
  port: number;
  icon: string;
  /** What the HeilSS UI should load to show the icon (local file when there is one). */
  iconSrc: string;
  umbrelLogin: boolean;
  image?: string;
  updateAvailable?: boolean;
  /** Created by HeilSS (has .heilss-meta.json), so the full Edit form can rebuild it safely. */
  managed: boolean;
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

export type StoreContext = { storeId: string; storeName: string; linked: LinkedStore | null; settings: Settings };

/** The store this request works on: HeilSS's own, or a linked one (its id comes from its umbrel-app-store.yml). */
export async function currentStore(): Promise<StoreContext> {
  const settings = await readSettings();
  const key = activeStoreKey();
  if (!key) {
    await ensureStore(settings.storeId, settings.storeName);
    return { storeId: settings.storeId, storeName: settings.storeName, linked: null, settings };
  }
  const linked = findLinkedStore(settings, key);
  await ensureStore(settings.storeId, settings.storeName);
  let meta: { id?: string; name?: string } = {};
  try {
    meta = (parseYaml(await readFile(path.join(storeWorkDir(), "umbrel-app-store.yml"), "utf8")) ?? {}) as typeof meta;
  } catch {
    throw new Error(`${linked.url} has no umbrel-app-store.yml, so it is not an Umbrel community store.`);
  }
  return { storeId: String(meta.id ?? ""), storeName: String(meta.name ?? meta.id ?? key), linked, settings };
}

function iconUrlBuilder(ctx: StoreContext) {
  return (id: string, icon: IconData) => manifestIconUrl({ id, icon, linked: ctx.linked, publicBaseUrl: ctx.settings.publicBaseUrl });
}

function iconSrcFor(id: string, icon: (IconData & { name: string }) | null, manifestIcon: string): string {
  const key = activeStoreKey();
  // Show what Umbrel shows: a data: icon or one hosted elsewhere wins over a stale local file.
  if (manifestIcon.startsWith("data:") || (/^https?:\/\//i.test(manifestIcon) && !isOwnIconUrl(manifestIcon, id))) return manifestIcon;
  if (icon) return `/media/apps/${id}/icon?${key ? `store=${encodeURIComponent(key)}&` : ""}v=${iconHash(icon.data)}`;
  return manifestIcon;
}

export async function listEntries(): Promise<EntrySummary[]> {
  await currentStore();
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
        iconSrc: iconSrcFor(entry.name, await findIconFile(path.join(storeWorkDir(), entry.name)), String(manifest.icon ?? "")),
        umbrelLogin: meta?.umbrelLogin !== false,
        image: meta?.image,
        managed: meta !== null,
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
  const ctx = await currentStore();
  assertStoreId(ctx.storeId);
  let existingIcon: { icon: IconData | null; field: string } | undefined;
  if (existingId) {
    const manifest = await readManifestFile(existingId).catch(() => ({}) as Record<string, unknown>);
    existingIcon = { icon: await findIconFile(path.join(storeWorkDir(), existingId)), field: String(manifest.icon ?? "") };
  }
  return buildEntry(input, {
    storeId: ctx.storeId,
    submitter: ctx.settings.submitter,
    publicBaseUrl: ctx.settings.publicBaseUrl,
    usedPorts: await usedPorts(existingId),
    usedIds: await usedIds(existingId),
    existingId,
    iconUrl: iconUrlBuilder(ctx),
    existingIcon,
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
  await writeIconFile(dir, built.icon);
  await writeFile(path.join(dir, ".heilss-meta.json"), `${JSON.stringify(built.meta, null, 2)}\n`);
  for (const dataDir of built.dataDirs) {
    const target = path.join(dir, dataDir);
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, ".gitkeep"), "");
  }
}

export async function createEntry(input: BuildInput): Promise<BuiltEntry> {
  return withLock(async () => {
    await assertWritable();
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
    await assertWritable();
    await readManifestFile(id);
    if (!(await readMeta(id))) {
      throw new Error("This app was not created by HeilSS, so the rebuild form could drop parts of it. Use Change icon or Edit files instead.");
    }
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
    await assertWritable();
    const dir = path.join(storeWorkDir(), id);
    const info = await stat(dir).catch(() => null);
    if (!info?.isDirectory()) throw new Error(`No entry named ${id}`);
    await rm(dir, { recursive: true, force: true });
    await commitAll(`Remove ${id}`);
    await mirrorAfterChange();
  });
}

export async function getEntry(id: string): Promise<EntryDetail> {
  assertAppId(id);
  const ctx = await currentStore(); // sync a linked store before reading its files
  await assertRegularFiles(id);
  const manifest = await readManifestFile(id);
  const meta = await readMeta(id);
  const manifestYaml = await readFile(path.join(storeWorkDir(), id, "umbrel-app.yml"), "utf8");
  const composeYaml = await readFile(path.join(storeWorkDir(), id, "docker-compose.yml"), "utf8");
  const issues = validateEntry({
    storeId: ctx.storeId,
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
    iconSrc: iconSrcFor(id, await findIconFile(path.join(storeWorkDir(), id)), String(manifest.icon ?? "")),
    managed: meta !== null,
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
    await assertWritable();
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error("Invalid commit");
    await restorePath(sha, id);
    await commitAll(`Restore ${id} to ${sha.slice(0, 7)}`);
    await mirrorAfterChange();
  });
}

export async function storeHistory() {
  await currentStore();
  return historyFor();
}

export async function iconFile(id: string): Promise<{ body: Buffer; type: string } | null> {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  const { ICON_TYPES } = await import("@/lib/icons");
  const icon = await findIconFile(path.join(storeWorkDir(), id));
  return icon ? { body: icon.data, type: ICON_TYPES[icon.ext] } : null;
}

/**
 * Linked stores are other people's (or other tools') repositories: refuse app folders or files that are
 * symlinks, so reads and writes cannot leave the clone.
 */
async function assertRegularFiles(id: string): Promise<void> {
  const { lstat } = await import("node:fs/promises");
  const dir = path.join(storeWorkDir(), id);
  const info = await lstat(dir).catch(() => null);
  if (!info) throw new Error(`No app named ${id}`);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${id} is not a regular folder in this store`);
  for (const name of await readdir(dir)) {
    if (!/^(umbrel-app\.yml|docker-compose\.yml|icon\.\w+)$/.test(name)) continue;
    if ((await lstat(path.join(dir, name))).isSymbolicLink()) throw new Error(`${id}/${name} is a symlink; HeilSS will not follow it`);
  }
}

function assertAppId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("Invalid app id");
}

function composeYamlObject(text: string): unknown {
  try {
    const value = parseYaml(text) as unknown;
    return value && typeof value === "object" && "services" in (value as object) ? value : undefined;
  } catch {
    return undefined;
  }
}

export type IconChange = { mode: "upload"; dataUrl: string } | { mode: "monogram" } | { mode: "fetch" };

/** Replace an app's icon: write icon.<ext> next to the manifest, point `icon:` at it, commit (and push for linked stores). */
export async function setEntryIcon(id: string, change: IconChange): Promise<EntryDetail> {
  assertAppId(id);
  return withLock(async () => {
    await assertWritable();
    const ctx = await currentStore();
    await assertRegularFiles(id);
    const dir = path.join(storeWorkDir(), id);
    const manifestPath = path.join(dir, "umbrel-app.yml");
    const doc = parseDocument(await readFile(manifestPath, "utf8"));
    if (doc.errors.length) throw new Error(`umbrel-app.yml does not parse: ${doc.errors[0].message}`);
    const name = String(doc.get("name") ?? id);
    let icon: IconData;
    if (change.mode === "upload") {
      icon = decodeIconUpload(change.dataUrl);
    } else if (change.mode === "monogram") {
      icon = monogramIcon(name);
    } else {
      const meta = await readMeta(id);
      const repo = [String(doc.get("repo") ?? ""), String(doc.get("website") ?? ""), meta?.source ?? ""].find((url) => /github\.com\//i.test(url));
      if (!repo) throw new Error("No GitHub repository is listed for this app (repo or website), so there is nothing to fetch. Upload an icon instead.");
      const fetched = await fetchRepoIcon(repo);
      if (!fetched) throw new Error(`No icon.svg / logo.svg / logo.png found in ${repo}. Upload an icon instead.`);
      icon = fetched;
    }
    await writeIconFile(dir, icon);
    doc.set("icon", manifestIconUrl({ id, icon, linked: ctx.linked, publicBaseUrl: ctx.settings.publicBaseUrl }));
    const text = doc.toString({ lineWidth: 0 });
    await writeFile(manifestPath, text.endsWith("\n") ? text : `${text}\n`);
    await commitAll(`Change icon for ${id}`);
    if (!ctx.linked) await mirrorAfterChange();
    return getEntry(id);
  });
}

/** Save hand-edited umbrel-app.yml / docker-compose.yml. Errors that would stop Umbrel loading the app block the save. */
export async function saveEntryFiles(id: string, files: { manifestYaml: string; composeYaml: string; bump?: boolean }): Promise<EntryDetail> {
  assertAppId(id);
  return withLock(async () => {
    await assertWritable();
    const ctx = await currentStore();
    await assertRegularFiles(id);
    const dir = path.join(storeWorkDir(), id);
    await readManifestFile(id);
    if (typeof composeYamlObject(files.composeYaml) !== "object") throw new Error("docker-compose.yml must be a YAML mapping with services.");
    const manifestDoc = parseDocument(files.manifestYaml);
    if (manifestDoc.errors.length) throw new Error(`umbrel-app.yml: ${manifestDoc.errors[0].message}`);
    const composeDoc = parseDocument(files.composeYaml);
    if (composeDoc.errors.length) throw new Error(`docker-compose.yml: ${composeDoc.errors[0].message}`);
    if (String(manifestDoc.get("id") ?? "") !== id) throw new Error(`The manifest id must stay ${id}.`);
    if (files.bump) manifestDoc.set("version", bumpVersion(String(manifestDoc.get("version") ?? "1.0.0")));
    const manifestYaml = manifestDoc.toString({ lineWidth: 0 });
    // Hand edits are deliberate: HeilSS's packaging rules (no Docker socket, port ranges …) show as warnings
    // on the app page instead of blocking. Only unparseable YAML or a changed id stops the save.
    await writeFile(path.join(dir, "umbrel-app.yml"), manifestYaml.endsWith("\n") ? manifestYaml : `${manifestYaml}\n`);
    await writeFile(path.join(dir, "docker-compose.yml"), files.composeYaml.endsWith("\n") ? files.composeYaml : `${files.composeYaml}\n`);
    await commitAll(`Edit ${id}${files.bump ? " (version bump)" : ""}`);
    if (!ctx.linked) await mirrorAfterChange();
    return getEntry(id);
  });
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
    await assertWritable();
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
  if (activeStoreKey()) return undefined; // linked stores were already pushed to their own remote
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

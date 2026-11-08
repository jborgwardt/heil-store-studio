import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { activeStoreKey, linkedStoreDir, storeBareDir, storeWorkDir, dataDir } from "@/lib/paths";
import { findLinkedStore, readSettings, type LinkedStore } from "@/lib/settings";
import { redactString } from "@/lib/redact";
import { lockBusy } from "@/lib/lock";

const exec = promisify(execFile);

/**
 * Stop git from discovering a checkout that contains the data directory.
 * HeilSS often runs from its own git repo (`npm run dev`) or from a clone of
 * the bootstrap store. Without a ceiling, `git` in `data/store` walks up,
 * treats that parent as the community store, and can rewrite its remote.
 */
function gitEnv(cwd: string, extraEnv: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extraEnv,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "0",
    GIT_CEILING_DIRECTORIES: path.resolve(path.dirname(cwd)),
  };
}

export async function git(args: string[], cwd = storeWorkDir(), extraEnv: Record<string, string> = {}): Promise<string> {
  try {
    const { stdout } = await exec("git", args, {
      cwd,
      env: gitEnv(cwd, extraEnv),
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    const message = redactString(`${(error as Error).message}\n${stderr}`.trim());
    throw new Error(message);
  }
}

export function storeMetaYaml(id: string, name: string): string {
  const safeName = name.replace(/"/g, "'");
  return [
    `id: "${id}" # Choose the ID for your app store. This should contain only alphabets ("a to z") and dashes ("-").`,
    `name: "${safeName}" # Shown in umbrelOS as "<name> App Store".`,
    "",
  ].join("\n");
}

/**
 * Run git with credentials for a linked store. The token never appears in argv, the remote URL or .git/config:
 * git asks GIT_ASKPASS, which reads it from the environment of this one process.
 */
async function withAuth<T>(store: LinkedStore, fn: (env: Record<string, string>) => Promise<T>): Promise<T> {
  if (!store.token) return fn({});
  const askpass = path.join(dataDir(), `git-askpass-${process.pid}-${Math.random().toString(36).slice(2)}.sh`);
  await mkdir(dataDir(), { recursive: true });
  await writeFile(askpass, "#!/bin/sh\ncase \"$1\" in\n  *Username*) printf '%s\\n' \"$HEILSS_GIT_USER\" ;;\n  *) printf '%s\\n' \"$HEILSS_GIT_TOKEN\" ;;\nesac\n", { mode: 0o700 });
  await chmod(askpass, 0o700);
  const user = store.username || (/github\.com/i.test(store.url) ? "x-access-token" : store.token);
  try {
    return await fn({ GIT_ASKPASS: askpass, HEILSS_GIT_USER: user, HEILSS_GIT_TOKEN: store.token });
  } finally {
    await rm(askpass, { force: true });
  }
}

const lastFetch = new Map<string, number>();
const inflight = new Map<string, Promise<void>>();

/** Clone a linked store, or bring a clean clone up to date with its remote branch. Concurrent callers share one sync. */
export function syncLinkedStore(store: LinkedStore, opts: { force?: boolean } = {}): Promise<void> {
  const running = inflight.get(store.key);
  if (running) return running;
  const job = doSyncLinkedStore(store, opts).finally(() => inflight.delete(store.key));
  inflight.set(store.key, job);
  return job;
}

async function doSyncLinkedStore(store: LinkedStore, { force = false }: { force?: boolean }): Promise<void> {
  const dir = linkedStoreDir(store.key);
  const hasGit = await access(path.join(dir, ".git")).then(() => true, () => false);
  if (!hasGit) {
    // Clone next to the final folder and rename, so an interrupted clone never looks like a store.
    const tmp = `${dir}.cloning-${process.pid}`;
    await rm(tmp, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.dirname(dir), { recursive: true });
    // core.symlinks=false: links in someone else's repo become plain files, never paths out of the clone.
    await withAuth(store, (env) => git(["-c", "core.symlinks=false", "clone", "--branch", store.branch, "--single-branch", "--", store.url, tmp], path.dirname(dir), env));
    await git(["config", "core.symlinks", "false"], tmp);
    await git(["config", "user.name", "HeilSS"], tmp);
    await git(["config", "user.email", "heilss@localhost"], tmp);
    const { rename } = await import("node:fs/promises");
    await rename(tmp, dir);
    lastFetch.set(store.key, Date.now());
    return;
  }
  // A locked write is using the tree; plain reads serve what is there instead of resetting under it.
  if (!force && lockBusy()) return;
  if (!force && Date.now() - (lastFetch.get(store.key) ?? 0) < 20_000) return;
  lastFetch.set(store.key, Date.now());
  await git(["config", "core.symlinks", "false"], dir);
  await git(["remote", "set-url", "origin", store.url], dir);
  // Explicit refspec: the clone is single-branch, and the branch may have been changed in Settings since.
  await withAuth(store, (env) => git(["fetch", "--quiet", "origin", `+refs/heads/${store.branch}:refs/remotes/origin/${store.branch}`], dir, env));
  // Local commits only exist if a push failed earlier; those are rolled back, so the remote always wins.
  await git(["reset", "--hard", `origin/${store.branch}`], dir);
  await git(["clean", "-fdq"], dir);
}

async function activeLinkedStore(): Promise<LinkedStore | null> {
  const key = activeStoreKey();
  if (!key) return null;
  return findLinkedStore(await readSettings(), key);
}

export async function ensureStore(storeId: string, storeName: string): Promise<void> {
  const linked = await activeLinkedStore();
  if (linked) return syncLinkedStore(linked);
  const work = storeWorkDir();
  const bare = storeBareDir();
  await mkdir(work, { recursive: true });
  await mkdir(dataDir(), { recursive: true });
  const ownGit = path.join(work, ".git");
  try {
    await access(ownGit);
  } catch {
    await git(["init", "-b", "main", work], dataDir());
  }
  await git(["config", "user.name", "HeilSS"], work);
  await git(["config", "user.email", "heilss@localhost"], work);
  try {
    await git(["rev-parse", "--git-dir"], bare);
  } catch {
    await rm(bare, { recursive: true, force: true });
    await git(["init", "--bare", "-b", "main", bare], dataDir());
  }
  await git(["config", "http.receivepack", "false"], bare);
  await git(["config", "http.uploadpack", "true"], bare);
  const remotes = await git(["remote"], work);
  if (!remotes.split("\n").includes("origin")) {
    await git(["remote", "add", "origin", bare], work);
  } else {
    await git(["remote", "set-url", "origin", bare], work);
  }
  const metaPath = path.join(work, "umbrel-app-store.yml");
  const readmePath = path.join(work, "README.md");
  let meta = "";
  try {
    meta = await readFile(metaPath, "utf8");
  } catch {
    meta = "";
  }
  const desired = storeMetaYaml(storeId, storeName);
  if (meta !== desired) {
    await writeFile(metaPath, desired);
  }
  try {
    await access(readmePath);
  } catch {
    await writeFile(
      readmePath,
      "# Heil community app store\n\nThis repository is an Umbrel community app store managed by HeilSS.\nAdd it in umbrelOS under App Store → Community App Stores.\n",
    );
  }
  const status = await git(["status", "--porcelain"], work);
  const hasHead = await git(["rev-parse", "--verify", "HEAD"], work).then(
    () => true,
    () => false,
  );
  if (!hasHead || status.trim()) {
    await git(["add", "-A"], work);
    await git(["commit", "-m", hasHead ? "Update store metadata" : "Initial community app store"], work);
    await publishBare();
  }
}

export async function publishBare(): Promise<void> {
  await git(["push", "--set-upstream", "origin", "HEAD:main"]);
}

/** Fail early (before touching files) when the active linked store cannot be pushed to. */
export async function assertWritable(): Promise<void> {
  const linked = await activeLinkedStore();
  if (linked && !linked.token) {
    throw new Error(`${linked.url} is read-only in HeilSS until you add an access token for it in Settings → Linked stores.`);
  }
  if (linked) await syncLinkedStore(linked, { force: true });
}

export async function commitAll(message: string): Promise<string> {
  await git(["add", "-A"]);
  const status = await git(["status", "--porcelain"]);
  if (!status.trim()) {
    const head = await git(["rev-parse", "HEAD"]);
    return head.trim();
  }
  await git(["commit", "-m", message]);
  const linked = await activeLinkedStore();
  if (linked) {
    try {
      await withAuth(linked, (env) => git(["push", "origin", `HEAD:${linked.branch}`], storeWorkDir(), env));
    } catch (error) {
      await git(["reset", "--hard", `origin/${linked.branch}`]).catch(() => "");
      await git(["clean", "-fdq"]).catch(() => "");
      throw new Error(`Nothing was changed: the push to ${linked.url} failed. ${(error as Error).message}`);
    }
    lastFetch.set(linked.key, Date.now());
  } else {
    await publishBare();
  }
  const head = await git(["rev-parse", "HEAD"]);
  return head.trim();
}

export async function historyFor(appPath?: string): Promise<{ sha: string; date: string; subject: string }[]> {
  const args = ["log", "--pretty=format:%H%x09%aI%x09%s", "-n", "40"];
  if (appPath) args.push("--", appPath);
  const output = await git(args).catch(() => "");
  if (!output.trim()) return [];
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, date, ...rest] = line.split("\t");
      return { sha, date, subject: rest.join("\t") };
    });
}

export async function diffFor(sha: string, appPath?: string): Promise<string> {
  const parent = await git(["rev-parse", `${sha}^`]).catch(() => "");
  if (!parent.trim()) {
    const args = ["show", "--format=fuller", "--patch", sha];
    if (appPath) args.push("--", appPath);
    return git(args);
  }
  const args = ["diff", `${sha}^`, sha];
  if (appPath) args.push("--", appPath);
  return git(args);
}

export async function restorePath(sha: string, appPath: string): Promise<void> {
  await git(["checkout", sha, "--", appPath]);
}

export async function pushGithub(repo: string, branch: string, token: string): Promise<void> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("GitHub repo must look like owner/name");
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error("Invalid git branch");
  const askpass = path.join(dataDir(), "git-askpass.sh");
  await mkdir(dataDir(), { recursive: true });
  await writeFile(askpass, "#!/bin/sh\ncase \"$1\" in\n  *Username*) printf '%s\\n' 'x-access-token' ;;\n  *) printf '%s\\n' \"$HEILSS_GIT_TOKEN\" ;;\nesac\n", { mode: 0o700 });
  await chmod(askpass, 0o700);
  const url = `https://github.com/${repo}.git`;
  try {
    await git(["push", "--set-upstream", url, `HEAD:${branch}`], storeWorkDir(), {
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: "0",
      HEILSS_GIT_TOKEN: token,
    });
  } finally {
    await rm(askpass, { force: true });
  }
}

export async function cloneRepo(url: string, dest: string): Promise<void> {
  if (!/^https?:\/\//.test(url)) throw new Error("Import URL must be http or https");
  await rm(dest, { recursive: true, force: true });
  await mkdir(path.dirname(dest), { recursive: true });
  await git(["clone", "--depth", "1", url, dest], dataDir());
}

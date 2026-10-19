import path from "node:path";

export function dataDir(): string {
  return process.env.HEILSS_DATA_DIR || path.join(process.cwd(), "data");
}

export function settingsPath(): string {
  return path.join(dataDir(), "settings.json");
}

/** Working tree of the community store. */
export function storeWorkDir(): string {
  return path.join(dataDir(), "store");
}

/** Bare repo served over git smart HTTP. */
export function storeBareDir(): string {
  return path.join(dataDir(), "store.git");
}

export function caddyfilePath(): string {
  return path.join(dataDir(), "caddy", "Caddyfile");
}

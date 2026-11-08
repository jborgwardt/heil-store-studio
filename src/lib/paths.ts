import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

export function dataDir(): string {
  return process.env.HEILSS_DATA_DIR || path.join(process.cwd(), "data");
}

export function settingsPath(): string {
  return path.join(dataDir(), "settings.json");
}

/**
 * Which store a request works on. Unset means HeilSS's own store (data/store, served at /git/store.git).
 * A linked store is a clone of a community store git repository that Umbrel already loads (GitHub, Gitea …),
 * kept in data/stores/<key>; commits are pushed back to its remote.
 */
export type StoreScope = { key: string };
export const storeScope = new AsyncLocalStorage<StoreScope>();

export function activeStoreKey(): string | null {
  return storeScope.getStore()?.key ?? null;
}

export function linkedStoreDir(key: string): string {
  return path.join(dataDir(), "stores", key);
}

/** Working tree of the store the current request works on. */
export function storeWorkDir(): string {
  const key = activeStoreKey();
  return key ? linkedStoreDir(key) : path.join(dataDir(), "store");
}

/** Bare repo served over git smart HTTP (HeilSS's own store only). */
export function storeBareDir(): string {
  return path.join(dataDir(), "store.git");
}

export function caddyfilePath(): string {
  return path.join(dataDir(), "caddy", "Caddyfile");
}

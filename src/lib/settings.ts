import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dataDir, settingsPath } from "@/lib/paths";

export type DomainSettings = {
  enabled: boolean;
  cloudflareToken: string;
  zoneName: string;
  recordName: string;
  recordType: "A" | "CNAME";
  target: string;
  proxied: boolean;
  caddyUpstream: string;
};

/** A community store git repository that Umbrel already loads, edited in place by HeilSS. */
export type LinkedStore = {
  key: string;
  url: string;
  branch: string;
  username: string;
  token: string;
};

export type PublicLinkedStore = Omit<LinkedStore, "token"> & { hasToken: boolean };

export type Settings = {
  storeId: string;
  storeName: string;
  submitter: string;
  publicBaseUrl: string;
  umbrelMcpUrl: string;
  umbrelMcpToken: string;
  github: {
    enabled: boolean;
    repo: string;
    branch: string;
    token: string;
  };
  drive: {
    enabled: boolean;
    accessToken: string;
    folderId: string;
    fileName: string;
  };
  domain: DomainSettings;
  stores: LinkedStore[];
};

export const defaultSettings = (): Settings => ({
  storeId: "heil",
  storeName: "Heil",
  submitter: "HeilSS",
  publicBaseUrl: "",
  umbrelMcpUrl: "http://umbrel.local/mcp",
  umbrelMcpToken: "",
  github: { enabled: false, repo: "", branch: "main", token: "" },
  drive: {
    enabled: false,
    accessToken: "",
    folderId: "",
    fileName: "heil-store.bundle",
  },
  domain: {
    enabled: false,
    cloudflareToken: "",
    zoneName: "",
    recordName: "",
    recordType: "A",
    target: "",
    proxied: false,
    caddyUpstream: "umbrel.local:8480",
  },
  stores: [],
});

export async function readSettings(): Promise<Settings> {
  try {
    const raw = await readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return mergeSettings(defaultSettings(), parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultSettings();
    throw error;
  }
}

export async function writeSettings(next: Settings): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  const file = settingsPath();
  await writeFile(file, JSON.stringify(next, null, 2), { mode: 0o600 });
  await chmod(file, 0o600);
}

export function mergeSettings(base: Settings, patch: Partial<Settings>): Settings {
  return {
    ...base,
    ...patch,
    github: { ...base.github, ...patch.github },
    drive: { ...base.drive, ...patch.drive },
    domain: { ...base.domain, ...patch.domain },
    stores: Array.isArray(patch.stores) ? patch.stores.map(normalizeLinkedStore).filter((s): s is LinkedStore => s !== null) : base.stores,
  };
}

export function storeKeyFor(url: string): string {
  const clean = url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const parts = clean.split(/[/:]/).filter(Boolean);
  const tail = parts.slice(-2).join("-") || "store";
  return tail.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "store";
}

function normalizeLinkedStore(value: unknown): LinkedStore | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const url = typeof v.url === "string" ? v.url.trim() : "";
  // file:// remotes are for tests only (HEILSS_ALLOW_FILE_REMOTES=1).
  if (!/^https?:\/\/[^\s]+$/.test(url) && !(process.env.HEILSS_ALLOW_FILE_REMOTES === "1" && /^file:\/\/\/[^\s]+$/.test(url))) return null;
  const key = typeof v.key === "string" && /^[a-z0-9][a-z0-9-]{0,59}$/.test(v.key) ? v.key : storeKeyFor(url);
  const branch = typeof v.branch === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(v.branch.trim()) && !v.branch.includes("..") ? v.branch.trim() : "main";
  return {
    key,
    url,
    branch,
    username: typeof v.username === "string" ? v.username.trim() : "",
    token: typeof v.token === "string" ? v.token.trim() : "",
  };
}

export function findLinkedStore(settings: Settings, key: string): LinkedStore {
  const store = settings.stores.find((item) => item.key === key);
  if (!store) throw new Error(`No linked store named ${key}`);
  return store;
}

export type PublicSettings = Omit<
  Settings,
  "umbrelMcpToken" | "github" | "drive" | "domain" | "stores"
> & {
  stores: PublicLinkedStore[];
  github: Omit<Settings["github"], "token">;
  drive: Omit<Settings["drive"], "accessToken">;
  domain: Omit<DomainSettings, "cloudflareToken">;
  secrets: {
    umbrelMcpToken: boolean;
    githubToken: boolean;
    driveAccessToken: boolean;
    cloudflareToken: boolean;
  };
};

export function toPublicSettings(settings: Settings): PublicSettings {
  return {
    storeId: settings.storeId,
    storeName: settings.storeName,
    submitter: settings.submitter,
    publicBaseUrl: settings.publicBaseUrl,
    umbrelMcpUrl: settings.umbrelMcpUrl,
    github: {
      enabled: settings.github.enabled,
      repo: settings.github.repo,
      branch: settings.github.branch,
    },
    drive: {
      enabled: settings.drive.enabled,
      folderId: settings.drive.folderId,
      fileName: settings.drive.fileName,
    },
    domain: {
      enabled: settings.domain.enabled,
      zoneName: settings.domain.zoneName,
      recordName: settings.domain.recordName,
      recordType: settings.domain.recordType,
      target: settings.domain.target,
      proxied: settings.domain.proxied,
      caddyUpstream: settings.domain.caddyUpstream,
    },
    stores: settings.stores.map(({ token, ...rest }) => ({ ...rest, hasToken: token.length > 0 })),
    secrets: {
      umbrelMcpToken: settings.umbrelMcpToken.length > 0,
      githubToken: settings.github.token.length > 0,
      driveAccessToken: settings.drive.accessToken.length > 0,
      cloudflareToken: settings.domain.cloudflareToken.length > 0,
    },
  };
}

const SECRET_FIELDS = new Set([
  "umbrelMcpToken",
  "token",
  "accessToken",
  "cloudflareToken",
]);

export function applySettingsPatch(current: Settings, patch: Record<string, unknown>): Settings {
  const next = structuredClone(current);
  if (typeof patch.storeId === "string") next.storeId = patch.storeId.trim().toLowerCase();
  if (typeof patch.storeName === "string") next.storeName = patch.storeName.trim();
  if (typeof patch.submitter === "string") next.submitter = patch.submitter.trim();
  if (typeof patch.publicBaseUrl === "string") next.publicBaseUrl = patch.publicBaseUrl.trim().replace(/\/$/, "");
  if (typeof patch.umbrelMcpUrl === "string") next.umbrelMcpUrl = patch.umbrelMcpUrl.trim();
  if (typeof patch.umbrelMcpToken === "string" && patch.umbrelMcpToken.trim() && patch.umbrelMcpToken !== "********") {
    next.umbrelMcpToken = patch.umbrelMcpToken.trim();
  }
  if (patch.clearUmbrelMcpToken === true) next.umbrelMcpToken = "";

  const github = patch.github;
  if (github && typeof github === "object") {
    const g = github as Record<string, unknown>;
    if (typeof g.enabled === "boolean") next.github.enabled = g.enabled;
    if (typeof g.repo === "string") next.github.repo = g.repo.trim();
    if (typeof g.branch === "string" && g.branch.trim()) next.github.branch = g.branch.trim();
    if (typeof g.token === "string" && g.token.trim() && g.token !== "********") next.github.token = g.token.trim();
    if (g.clearToken === true) next.github.token = "";
  }

  const drive = patch.drive;
  if (drive && typeof drive === "object") {
    const d = drive as Record<string, unknown>;
    if (typeof d.enabled === "boolean") next.drive.enabled = d.enabled;
    if (typeof d.folderId === "string") next.drive.folderId = d.folderId.trim();
    if (typeof d.fileName === "string" && d.fileName.trim()) next.drive.fileName = d.fileName.trim();
    if (typeof d.accessToken === "string" && d.accessToken.trim() && d.accessToken !== "********") {
      next.drive.accessToken = d.accessToken.trim();
    }
    if (d.clearToken === true) next.drive.accessToken = "";
  }

  const domain = patch.domain;
  if (domain && typeof domain === "object") {
    const d = domain as Record<string, unknown>;
    if (typeof d.enabled === "boolean") next.domain.enabled = d.enabled;
    if (typeof d.zoneName === "string") next.domain.zoneName = d.zoneName.trim();
    if (typeof d.recordName === "string") next.domain.recordName = d.recordName.trim();
    if (d.recordType === "A" || d.recordType === "CNAME") next.domain.recordType = d.recordType;
    if (typeof d.target === "string") next.domain.target = d.target.trim();
    if (typeof d.proxied === "boolean") next.domain.proxied = d.proxied;
    if (typeof d.caddyUpstream === "string" && d.caddyUpstream.trim()) next.domain.caddyUpstream = d.caddyUpstream.trim();
    if (typeof d.cloudflareToken === "string" && d.cloudflareToken.trim() && d.cloudflareToken !== "********") {
      next.domain.cloudflareToken = d.cloudflareToken.trim();
    }
    if (d.clearToken === true) next.domain.cloudflareToken = "";
  }

  if (Array.isArray(patch.stores)) {
    const incoming: LinkedStore[] = [];
    for (const raw of patch.stores) {
      const rawUrl = String((raw as Record<string, unknown>)?.url ?? "");
      if (/^https?:\/\/[^/]*@/i.test(rawUrl)) throw new Error("Put the access token in the token field, not inside the store URL.");
      const item = normalizeLinkedStore(raw);
      if (!item) throw new Error("Each linked store needs an http(s) git URL");
      // A saved token only carries over to the same URL, so it is never sent to a different host.
      const previous = current.stores.find((store) => store.url === item.url);
      const r = raw as Record<string, unknown>;
      // Keep the saved token unless a new one is typed; "********" is the masked placeholder.
      if (!item.token || item.token === "********") item.token = previous?.token ?? "";
      if (r.clearToken === true) item.token = "";
      if (incoming.some((store) => store.key === item.key)) throw new Error(`Two linked stores share the key ${item.key}`);
      incoming.push(item);
    }
    next.stores = incoming;
  }

  for (const key of Object.keys(patch)) {
    if (SECRET_FIELDS.has(key)) continue;
  }
  return next;
}

export function assertStoreId(id: string): void {
  if (!/^[a-z]+(-[a-z]+)*$/.test(id)) {
    throw new Error(
      'Store id must contain only letters a-z and dashes, matching umbrel-app-store.yml ("a to z" and "-").',
    );
  }
}

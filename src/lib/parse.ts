import { parse as parseYaml } from "yaml";

export type ImageRef = {
  raw: string;
  registry: string;
  repository: string;
  tag: string;
  digest?: string;
};

export type PublishedPort = {
  host?: string;
  container: number;
  protocol?: string;
};

export type DockerRun = {
  image: string;
  command: string[];
  env: Record<string, string>;
  volumes: string[];
  ports: PublishedPort[];
  user?: string;
  restart?: string;
  name?: string;
  entrypoint?: string;
  privileged: boolean;
  networkMode?: string;
  socketMount: boolean;
};

export type SourceKind = "docker-run" | "compose" | "github" | "image";

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escape = false;
  for (const ch of input) {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escape = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (quote) throw new Error("Unclosed quote in the pasted command");
  if (current) tokens.push(current);
  return tokens;
}

function takeOption(tokens: string[], index: number): { key: string; value?: string; next: number } {
  const token = tokens[index];
  const eq = token.indexOf("=");
  if (token.startsWith("--") && eq > 2) {
    return { key: token.slice(2, eq), value: token.slice(eq + 1), next: index + 1 };
  }
  const key = token.startsWith("--") ? token.slice(2) : token.slice(1);
  const valued = new Set([
    "p",
    "publish",
    "e",
    "env",
    "v",
    "volume",
    "u",
    "user",
    "name",
    "restart",
    "entrypoint",
    "network",
    "net",
    "label",
    "l",
    "memory",
    "cpus",
    "pull",
    "hostname",
    "add-host",
    "workdir",
    "w",
    "mount",
  ]);
  if (!token.startsWith("--") && token.length > 2 && valued.has(token[1])) {
    return { key: token[1], value: token.slice(2), next: index + 1 };
  }
  if (valued.has(key)) {
    const value = tokens[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`Missing value for -${key}`);
    return { key, value, next: index + 2 };
  }
  return { key, next: index + 1 };
}

export function parsePublishedPort(spec: string): PublishedPort {
  const [body, protocol] = spec.split("/");
  const parts = body.split(":");
  const containerRaw = parts[parts.length - 1];
  const hostRaw = parts.length > 1 ? parts[parts.length - 2] : undefined;
  const container = Number(containerRaw);
  if (!Number.isInteger(container) || container < 1 || container > 65535) {
    throw new Error(`Could not read a container port from "${spec}"`);
  }
  return { host: hostRaw, container, protocol };
}

export function parseDockerRun(source: string): DockerRun {
  const tokens = tokenize(source.trim());
  if (tokens[0] === "sudo") tokens.shift();
  if (tokens[0] !== "docker" && tokens[0] !== "podman") {
    throw new Error("Not a docker run command");
  }
  if (tokens[1] !== "run") throw new Error("Expected `docker run`");
  const result: DockerRun = {
    image: "",
    command: [],
    env: {},
    volumes: [],
    ports: [],
    privileged: false,
    socketMount: false,
  };
  let i = 2;
  while (i < tokens.length && tokens[i].startsWith("-")) {
    const option = takeOption(tokens, i);
    i = option.next;
    switch (option.key) {
      case "p":
      case "publish":
        if (option.value) result.ports.push(parsePublishedPort(option.value));
        break;
      case "e":
      case "env": {
        if (!option.value) break;
        const eq = option.value.indexOf("=");
        if (eq === -1) result.env[option.value] = "";
        else result.env[option.value.slice(0, eq)] = option.value.slice(eq + 1);
        break;
      }
      case "v":
      case "volume":
      case "mount":
        if (option.value) result.volumes.push(option.value);
        break;
      case "u":
      case "user":
        result.user = option.value;
        break;
      case "name":
        result.name = option.value;
        break;
      case "restart":
        result.restart = option.value;
        break;
      case "entrypoint":
        result.entrypoint = option.value;
        break;
      case "network":
      case "net":
        result.networkMode = option.value;
        break;
      case "privileged":
        result.privileged = true;
        break;
      default:
        break;
    }
  }
  if (i >= tokens.length) throw new Error("docker run is missing an image name");
  result.image = tokens[i];
  result.command = tokens.slice(i + 1);
  result.socketMount = result.volumes.some((volume) => volume.includes("docker.sock"));
  return result;
}

export function parseImageRef(raw: string): ImageRef {
  let rest = raw.trim();
  let digest: string | undefined;
  const at = rest.lastIndexOf("@");
  if (at > 0 && rest.slice(at + 1).startsWith("sha256:")) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  const parts = rest.split("/");
  let registry = "docker.io";
  let nameAndTag = rest;
  if (parts.length > 1 && (parts[0].includes(".") || parts[0].includes(":") || parts[0] === "localhost")) {
    registry = parts[0];
    nameAndTag = parts.slice(1).join("/");
  }
  let tag = "latest";
  const colon = nameAndTag.lastIndexOf(":");
  if (colon > 0) {
    tag = nameAndTag.slice(colon + 1);
    nameAndTag = nameAndTag.slice(0, colon);
  }
  if (!nameAndTag.includes("/") && registry === "docker.io") nameAndTag = `library/${nameAndTag}`;
  if (!nameAndTag) throw new Error(`Not an image reference: ${raw}`);
  return { raw: raw.trim(), registry, repository: nameAndTag, tag, digest };
}

export function stripDigestImage(image: string): string {
  const at = image.lastIndexOf("@");
  if (at > 0 && image.slice(at + 1).startsWith("sha256:")) return image.slice(0, at);
  return image;
}

export function formatImage(ref: ImageRef, digest?: string): string {
  const registry = ref.registry === "docker.io" ? "" : `${ref.registry}/`;
  const repo =
    ref.registry === "docker.io" && ref.repository.startsWith("library/")
      ? ref.repository.slice("library/".length)
      : ref.repository;
  const pin = digest ?? ref.digest;
  return `${registry}${repo}:${ref.tag}${pin ? `@${pin}` : ""}`;
}

export function hubPage(ref: ImageRef): string {
  if (ref.registry !== "docker.io") return `https://${ref.registry}/${ref.repository}`;
  if (ref.repository.startsWith("library/")) return `https://hub.docker.com/_/${ref.repository.slice("library/".length)}`;
  return `https://hub.docker.com/r/${ref.repository}`;
}

export function detectSourceKind(source: string): SourceKind {
  const trimmed = source.trim();
  if (/^(sudo\s+)?(docker|podman)\s+run\b/.test(trimmed)) return "docker-run";
  if (/^https?:\/\/(www\.)?github\.com\/[^/\s]+\/[^/\s]+/i.test(trimmed) && !trimmed.includes("\n")) return "github";
  if (/^git@github\.com:[^/\s]+\/[^/\s]+/.test(trimmed) && !trimmed.includes("\n")) return "github";
  if (looksLikeCompose(trimmed)) return "compose";
  if (!trimmed.includes("\n") && !trimmed.includes(" ")) {
    parseImageRef(trimmed);
    return "image";
  }
  throw new Error("Paste a Docker Compose file, a docker run command, a GitHub repository URL, or an image name.");
}

export function looksLikeCompose(source: string): boolean {
  if (!/services\s*:/.test(source) && !/^version\s*:/m.test(source)) return false;
  try {
    const doc = parseYaml(source);
    return Boolean(doc && typeof doc === "object" && (doc as { services?: unknown }).services);
  } catch {
    return false;
  }
}

export function parseGithubUrl(source: string): { owner: string; repo: string } {
  const trimmed = source.trim().replace(/\.git$/, "");
  const ssh = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+)$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const web = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#]+)/i);
  if (!web) throw new Error("That GitHub URL is not a repository");
  return { owner: web[1], repo: web[2].replace(/\.git$/, "") };
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || "app";
}

export function guessCategory(text: string): string {
  const hay = text.toLowerCase();
  const rules: [RegExp, string][] = [
    [/bitcoin|lightning|lnd|electrum/, "bitcoin"],
    [/\b(ai|llm|ollama|machine learning)\b/, "ai"],
    [/photo|video|jellyfin|plex|music|media/, "media"],
    [/nginx|dns|vpn|proxy|firewall|network/, "networking"],
    [/chat|matrix|social|mastodon/, "social"],
    [/home assistant|n8n|automation|workflow/, "automation"],
    [/finance|invoice|budget|accounting/, "finance"],
    [/file|sync|drive|nextcloud|photos/, "files"],
    [/crypto|ethereum|monero|wallet/, "crypto"],
  ];
  for (const [pattern, category] of rules) {
    if (pattern.test(hay)) return category;
  }
  return "developer";
}

export const CATEGORIES = [
  "files",
  "bitcoin",
  "media",
  "networking",
  "social",
  "automation",
  "finance",
  "ai",
  "developer",
  "crypto",
] as const;

const RESERVED = new Set([80, 443, 2000]);

export function isReservedPort(port: number): boolean {
  return port < 1 || port > 65535 || RESERVED.has(port) || (port >= 40000 && port <= 49999);
}

export function allocatePort(used: Set<number>, requested?: number): number {
  if (requested !== undefined) {
    if (isReservedPort(requested) || used.has(requested)) {
      throw new Error(`Port ${requested} is reserved or already used by another entry`);
    }
    return requested;
  }
  for (let port = 32000; port < 40000; port += 1) {
    if (!used.has(port) && !isReservedPort(port)) return port;
  }
  throw new Error("No free host port left in 32000-39999");
}

export function taglineFrom(name: string, description: string): string {
  const sentence = description.split(/(?<=[.!?])\s/)[0]?.trim() || `${name} on your Umbrel`;
  const stripped = sentence.replace(/[.]+$/g, "").trim();
  const cut = stripped.length > 90 ? `${stripped.slice(0, 87).trim()}…` : stripped;
  return cut || name;
}

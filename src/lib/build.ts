import { parse as parseYaml, stringify } from "yaml";
import {
  allocatePort,
  detectSourceKind,
  formatImage,
  guessCategory,
  hubPage,
  parseDockerRun,
  parseGithubUrl,
  parseImageRef,
  parsePublishedPort,
  slugify,
  taglineFrom,
  type DockerRun,
  type PublishedPort,
  type SourceKind,
} from "@/lib/parse";
import { imageWebsite, inspectImage, type ImageInfo } from "@/lib/registry";
import { validateEntry, type Issue } from "@/lib/validate";

export type BuildInput = {
  name?: string;
  description?: string;
  category?: string;
  source: string;
  umbrelLogin: boolean;
  iconDataUrl?: string;
  autoIcon: boolean;
  tagline?: string;
  version?: string;
  developer?: string;
  website?: string;
  repo?: string;
  support?: string;
  port?: number;
  appId?: string;
};

export type BuildContext = {
  storeId: string;
  submitter: string;
  publicBaseUrl: string;
  usedPorts: number[];
  usedIds: string[];
  existingId?: string;
};

export type EntryMeta = {
  source: string;
  kind: SourceKind;
  image: string;
  digest?: string;
  umbrelLogin: boolean;
  internalPort: number;
  primaryService: string;
};

export type BuiltEntry = {
  id: string;
  manifestYaml: string;
  composeYaml: string;
  iconSvg: string;
  iconDataUrl: string;
  dataDirs: string[];
  meta: EntryMeta;
  issues: Issue[];
  detected: SourceKind;
};

type Service = Record<string, unknown>;

const HTTP_PORTS = new Set([80, 81, 443, 3000, 3001, 5000, 5173, 8000, 8080, 8081, 8443, 8888, 7860, 9090]);

function yaml(value: unknown): string {
  return stringify(value, { lineWidth: 0 });
}

function splitVolume(spec: string): { source?: string; target: string; mode?: string } {
  let mode: string | undefined;
  let body = spec;
  const modeMatch = spec.match(/:(ro|rw|z|Z)$/);
  if (modeMatch && spec.split(":").length > 2) {
    mode = modeMatch[1];
    body = spec.slice(0, -modeMatch[0].length);
  }
  const idx = body.lastIndexOf(":");
  if (idx > 0 && body.slice(idx + 1).startsWith("/")) {
    return { source: body.slice(0, idx), target: body.slice(idx + 1), mode };
  }
  return { target: body, mode };
}

function safeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "data";
}

function rewriteVolume(spec: string, service: string, index: number): { spec: string; dir: string } {
  if (spec.includes("${APP_DATA_DIR}")) {
    const dir = spec.split("${APP_DATA_DIR}/")[1]?.split(":")[0] ?? `data/${service}`;
    return { spec, dir };
  }
  const parts = splitVolume(spec);
  const source = parts.source;
  let dir: string;
  if (!source || source.startsWith("/") || source.startsWith("./") || source.startsWith("~")) {
    dir = `data/${service}-${safeSegment(parts.target)}-${index}`;
  } else if (source.startsWith("$")) {
    return { spec, dir: `data/${service}` };
  } else {
    dir = `data/${safeSegment(source)}`;
  }
  const mode = parts.mode ? `:${parts.mode}` : "";
  return { spec: `\${APP_DATA_DIR}/${dir}:${parts.target}${mode}`, dir };
}

function defaultVolume(image: string): { spec: string; dir: string } {
  const ref = parseImageRef(image);
  const short = ref.repository.split("/").pop() ?? "";
  if (short === "nginx") return { spec: "${APP_DATA_DIR}/data/html:/usr/share/nginx/html", dir: "data/html" };
  return { spec: "${APP_DATA_DIR}/data:/data", dir: "data" };
}

function publishedPorts(service: Service): PublishedPort[] {
  const ports = service.ports;
  if (!Array.isArray(ports)) return [];
  const found: PublishedPort[] = [];
  for (const port of ports) {
    if (typeof port === "string" || typeof port === "number") {
      found.push(parsePublishedPort(String(port)));
    } else if (port && typeof port === "object" && "target" in port) {
      const target = Number((port as { target: unknown }).target);
      const published = (port as { published?: unknown }).published;
      if (Number.isInteger(target)) found.push({ container: target, host: published ? String(published) : undefined });
    }
  }
  return found;
}

function chooseInternalPort(ports: PublishedPort[], exposed: number[]): number {
  const containers = ports.map((port) => port.container);
  const pool = [...containers, ...exposed];
  const http = pool.find((port) => HTTP_PORTS.has(port));
  return http ?? pool[0] ?? 80;
}

function serviceFromRun(run: DockerRun, info: ImageInfo): { services: Record<string, Service>; primary: string; internalPort: number; image: string } {
  const ref = parseImageRef(run.image);
  const image = formatImage(ref, info.status === "found" ? info.digest : ref.digest);
  const primary = "web";
  const internalPort = chooseInternalPort(run.ports, info.exposedPorts);
  const volumes = run.volumes.map((volume, index) => rewriteVolume(volume, primary, index));
  if (volumes.length === 0) volumes.push(defaultVolume(image));
  const service: Service = {
    image,
    restart: run.restart || "on-failure",
    init: true,
    volumes: volumes.map((volume) => volume.spec),
  };
  if (Object.keys(run.env).length) service.environment = run.env;
  if (run.user) service.user = run.user;
  if (run.command.length) service.command = run.command;
  if (run.entrypoint) service.entrypoint = run.entrypoint;
  const extraPorts = run.ports.filter((port) => port.container !== internalPort && port.host);
  if (extraPorts.length) {
    service.ports = extraPorts.map((port) => `${port.host}:${port.container}${port.protocol ? `/${port.protocol}` : ""}`);
  }
  return { services: { [primary]: service }, primary, internalPort, image };
}

function normalizeCompose(raw: string, infoFor: (image: string) => ImageInfo): {
  services: Record<string, Service>;
  primary: string;
  internalPort: number;
  image: string;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  const doc = parseYaml(raw) as { services?: Record<string, Service> };
  const incoming = { ...(doc.services ?? {}) };
  delete incoming.app_proxy;
  const names = Object.keys(incoming);
  if (names.length === 0) throw new Error("Compose file has no services");
  const scored = names.map((name) => {
    const ports = publishedPorts(incoming[name]);
    const http = ports.some((port) => HTTP_PORTS.has(port.container));
    const preferred = /^(web|server|app|frontend|ui)$/.test(name) ? 2 : 0;
    return { name, score: (http ? 4 : 0) + preferred + (incoming[name].image ? 1 : 0) };
  });
  scored.sort((a, b) => b.score - a.score);
  const primary = scored[0].name;
  let image = "";
  const services: Record<string, Service> = {};
  for (const name of names) {
    const service: Service = { ...incoming[name] };
    delete service.container_name;
    delete service.networks;
    delete service.build;
    if (incoming[name].build && !service.image) {
      errors.push(`${name} only has a build: section. Umbrel needs a published image.`);
    } else if (incoming[name].build) {
      warnings.push(`Removed build: from ${name}. Umbrel installs prebuilt images.`);
    }
    if (service.privileged === true) errors.push(`${name} sets privileged: true`);
    if (service.network_mode === "host") errors.push(`${name} uses network_mode: host`);
    const originalVolumes = Array.isArray(service.volumes) ? service.volumes.map(String) : [];
    if (originalVolumes.some((volume) => volume.includes("docker.sock"))) {
      errors.push(`${name} mounts the Docker socket`);
    }
    const rewritten = originalVolumes.map((volume, index) => rewriteVolume(volume, name, index));
    if (name === primary && rewritten.length === 0 && typeof service.image === "string") {
      rewritten.push(defaultVolume(service.image));
    }
    if (rewritten.length) service.volumes = rewritten.map((volume) => volume.spec);
    if (!service.restart) service.restart = "on-failure";
    if (service.init === undefined) service.init = true;
    if (typeof service.image === "string") {
      const info = infoFor(service.image);
      const ref = parseImageRef(service.image);
      service.image = formatImage(ref, info.status === "found" ? info.digest ?? ref.digest : ref.digest);
      if (name === primary) image = String(service.image);
    }
    const ports = publishedPorts(incoming[name]);
    if (name === primary) {
      const info = typeof incoming[name].image === "string" ? infoFor(String(incoming[name].image)) : { exposedPorts: [] as number[] };
      const internal = chooseInternalPort(ports, info.exposedPorts);
      const kept = ports.filter((port) => port.container !== internal && port.host);
      if (kept.length) {
        service.ports = kept.map((port) => `${port.host}:${port.container}${port.protocol ? `/${port.protocol}` : ""}`);
      } else {
        delete service.ports;
      }
      services[name] = service;
      continue;
    }
    services[name] = service;
  }
  const primaryPorts = publishedPorts(incoming[primary]);
  const primaryInfo =
    typeof incoming[primary].image === "string"
      ? infoFor(String(incoming[primary].image))
      : { status: "unknown" as const, exposedPorts: [] };
  const internalPort = chooseInternalPort(primaryPorts, primaryInfo.exposedPorts);
  if (!image && typeof services[primary].image === "string") image = String(services[primary].image);
  return { services, primary, internalPort, image, warnings, errors };
}

async function githubSource(source: string): Promise<{ compose?: string; image?: string; description?: string; website?: string; iconSvg?: string; repo: string }> {
  const { owner, repo } = parseGithubUrl(source);
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "HeilSS" };
  const metaResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!metaResponse.ok) throw new Error(`GitHub returned ${metaResponse.status} for ${owner}/${repo}`);
  const meta = (await metaResponse.json()) as {
    description?: string;
    default_branch?: string;
    homepage?: string;
  };
  const branch = meta.default_branch || "main";
  const files = ["docker-compose.yml", "compose.yml", "docker-compose.yaml", "compose.yaml"];
  let compose: string | undefined;
  for (const file of files) {
    const response = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const text = await response.text();
      if (text.includes("services")) {
        compose = text;
        break;
      }
    }
  }
  let iconSvg: string | undefined;
  for (const file of ["icon.svg", "logo.svg", "public/logo.svg", "public/icon.svg", "docs/logo.svg", "assets/logo.svg"]) {
    const response = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) continue;
    const text = await response.text();
    if (text.includes("<svg")) {
      iconSvg = text;
      break;
    }
  }
  let image: string | undefined;
  if (!compose && meta.description) {
    const match = meta.description.match(/\b((?:[a-z0-9.-]+\.[a-z]{2,}\/)?[a-z0-9._-]+(?:\/[a-z0-9._-]+)?:[A-Za-z0-9._-]+)\b/);
    if (match) image = match[1];
  }
  return {
    compose,
    image,
    description: meta.description,
    website: meta.homepage || repoUrl,
    iconSvg,
    repo: repoUrl,
  };
}

function monogramSvg(name: string): string {
  const initials = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "A";
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="56" fill="#14161e"/>
  <rect x="18" y="18" width="220" height="220" rx="46" fill="hsl(${hue} 28% 18%)"/>
  <text x="128" y="148" text-anchor="middle" font-family="Inter, ui-sans-serif, sans-serif" font-size="92" font-weight="650" fill="#f4f4f5">${initials}</text>
</svg>
`;
}

function dataUrlFromSvg(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function decodeDataUrl(dataUrl: string): { mime: string; svg?: string } {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,([\s\S]*)$/);
  if (!match) return { mime: "application/octet-stream" };
  const mime = match[1] || "application/octet-stream";
  if (!dataUrl.includes(";base64,") && mime.includes("svg")) {
    return { mime, svg: decodeURIComponent(match[2]) };
  }
  if (mime.includes("svg")) {
    return { mime, svg: Buffer.from(match[2], "base64").toString("utf8") };
  }
  return { mime };
}

function pickId(storeId: string, name: string, requested: string | undefined, used: string[], existing?: string): string {
  if (existing) return existing;
  if (requested) {
    if (!requested.startsWith(`${storeId}-`) || !/^[a-z0-9-]+$/.test(requested)) {
      throw new Error(`App id must look like ${storeId}-your-app`);
    }
    if (used.includes(requested)) throw new Error(`App id ${requested} already exists`);
    return requested;
  }
  const base = `${storeId}-${slugify(name)}`;
  if (!used.includes(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.includes(candidate)) return candidate;
  }
  throw new Error("Could not allocate a unique app id");
}

function manifestDocument(fields: Record<string, unknown>): string {
  return yaml(fields).replace(/PROXY_AUTH_ADD: false/g, 'PROXY_AUTH_ADD: "false"');
}

export async function buildEntry(input: BuildInput, context: BuildContext): Promise<BuiltEntry> {
  const issues: Issue[] = [];
  const kind = detectSourceKind(input.source);
  const imageInfoCache = new Map<string, ImageInfo>();
  const infoFor = (image: string) =>
    imageInfoCache.get(stripDigest(image)) ??
    imageInfoCache.get(image) ?? { status: "unknown" as const, exposedPorts: [] };

  let services: Record<string, Service> = {};
  let primary = "web";
  let internalPort = 80;
  let image = "";
  let fetchedDescription = "";
  let fetchedWebsite = "";
  let fetchedRepo = "";
  let fetchedDeveloper = "";
  let fetchedIcon: string | undefined;
  let digest: string | undefined;

  if (kind === "docker-run") {
    const run = parseDockerRun(input.source);
    if (run.privileged) issues.push({ level: "error", message: "Refusing a privileged container" });
    if (run.socketMount) issues.push({ level: "error", message: "Refusing a Docker socket mount" });
    if (run.networkMode === "host") issues.push({ level: "error", message: "Host networking cannot sit behind app_proxy" });
    const info = await inspectImage(run.image);
    imageInfoCache.set(run.image, info);
    noteRegistry(issues, run.image, info);
    const built = serviceFromRun(run, info);
    services = built.services;
    primary = built.primary;
    internalPort = built.internalPort;
    image = built.image;
    digest = info.digest;
    fetchedDescription = info.description ?? "";
    fetchedWebsite = imageWebsite(parseImageRef(run.image), info);
    fetchedRepo = info.source && /^https?:\/\//.test(info.source) ? info.source : "";
    fetchedDeveloper = info.vendor || info.title || "";
  } else if (kind === "image") {
    const ref = parseImageRef(input.source.trim());
    const info = await inspectImage(input.source.trim());
    imageInfoCache.set(input.source.trim(), info);
    noteRegistry(issues, input.source.trim(), info);
    const run: DockerRun = {
      image: input.source.trim(),
      command: [],
      env: {},
      volumes: [],
      ports: [],
      privileged: false,
      socketMount: false,
    };
    const built = serviceFromRun(run, info);
    services = built.services;
    primary = built.primary;
    internalPort = built.internalPort;
    image = built.image;
    digest = info.digest;
    fetchedDescription = info.description ?? "";
    fetchedWebsite = imageWebsite(ref, info);
    fetchedRepo = info.source && /^https?:\/\//.test(info.source) ? info.source : "";
    fetchedDeveloper = info.vendor || "";
  } else if (kind === "github") {
    const github = await githubSource(input.source);
    fetchedDescription = github.description ?? "";
    fetchedWebsite = github.website ?? "";
    fetchedRepo = github.repo;
    fetchedIcon = github.iconSvg;
    if (github.compose) {
      const images = collectImages(github.compose);
      for (const candidate of images) {
        const info = await inspectImage(candidate);
        imageInfoCache.set(candidate, info);
        noteRegistry(issues, candidate, info);
      }
      const normalized = normalizeCompose(github.compose, infoFor);
      services = normalized.services;
      primary = normalized.primary;
      internalPort = normalized.internalPort;
      image = normalized.image;
      issues.push(...normalized.warnings.map((message) => ({ level: "warning" as const, message })));
      issues.push(...normalized.errors.map((message) => ({ level: "error" as const, message })));
      digest = image ? imageInfoCache.get(stripDigest(image))?.digest : undefined;
    } else if (github.image) {
      const info = await inspectImage(github.image);
      imageInfoCache.set(github.image, info);
      noteRegistry(issues, github.image, info);
      const built = serviceFromRun(
        { image: github.image, command: [], env: {}, volumes: [], ports: [], privileged: false, socketMount: false },
        info,
      );
      services = built.services;
      primary = built.primary;
      internalPort = built.internalPort;
      image = built.image;
      digest = info.digest;
    } else {
      issues.push({
        level: "error",
        message: "That GitHub repo has no docker-compose.yml and no obvious published image. Paste a Compose file or an image name.",
      });
    }
  } else {
    const images = collectImages(input.source);
    for (const candidate of images) {
      const info = await inspectImage(candidate);
      imageInfoCache.set(candidate, info);
      noteRegistry(issues, candidate, info);
    }
    const normalized = normalizeCompose(input.source, (candidate) => infoFor(candidate));
    services = normalized.services;
    primary = normalized.primary;
    internalPort = normalized.internalPort;
    image = normalized.image;
    digest = image ? findDigest(image, imageInfoCache) : undefined;
    issues.push(...normalized.warnings.map((message) => ({ level: "warning" as const, message })));
    issues.push(...normalized.errors.map((message) => ({ level: "error" as const, message })));
    if (image) {
      const ref = parseImageRef(stripDigest(image));
      const info = infoFor(stripDigest(image));
      fetchedDescription = info.description ?? "";
      fetchedWebsite = imageWebsite(ref, info.status ? info : { status: "unknown", exposedPorts: [] });
      fetchedRepo = info.source && /^https?:\/\//.test(info.source) ? info.source : "";
      fetchedDeveloper = info.vendor || "";
    }
  }

  const name = (input.name || titleFromImage(image) || "App").trim();
  const description = (input.description || fetchedDescription || `${name} packaged for umbrelOS. Its data is stored in the app data directory and the UI is opened through Umbrel.`).trim();
  const category = input.category || guessCategory(`${name} ${description} ${image}`);
  const version = input.version || versionFromImage(image);
  const tagline = input.tagline || taglineFrom(name, description);
  const website = input.website || fetchedWebsite || (image ? hubPage(parseImageRef(stripDigest(image))) : "https://umbrel.com");
  const developer = input.developer || fetchedDeveloper || "Community";
  const repo = input.repo ?? fetchedRepo;
  const support = input.support || (repo ? `${repo.replace(/\.git$/, "")}/issues` : website);
  const id = pickId(context.storeId, name, input.appId, context.usedIds, context.existingId);
  const port = allocatePort(new Set(context.usedPorts), input.port);

  let iconSvg = fetchedIcon && input.autoIcon ? fetchedIcon : monogramSvg(name);
  let iconDataUrl = dataUrlFromSvg(iconSvg);
  if (input.iconDataUrl) {
    const decoded = decodeDataUrl(input.iconDataUrl);
    iconDataUrl = input.iconDataUrl;
    if (decoded.svg) iconSvg = decoded.svg;
  } else if (!input.autoIcon) {
    iconSvg = monogramSvg(name);
    iconDataUrl = dataUrlFromSvg(iconSvg);
  }
  const iconField =
    context.publicBaseUrl && !input.iconDataUrl
      ? `${context.publicBaseUrl}/media/apps/${id}/icon.svg`
      : iconDataUrl;

  const proxyEnv: Record<string, string | number> = {
    APP_HOST: `${id}_${primary}_1`,
    APP_PORT: internalPort,
  };
  if (!input.umbrelLogin) proxyEnv.PROXY_AUTH_ADD = "false";

  const compose = {
    version: "3.7",
    services: {
      app_proxy: { environment: proxyEnv },
      ...services,
    },
  };
  let composeYaml = `# Generated by HeilSS for umbrelOS. app_proxy is routing config; umbrelOS 2.0 does not run it as a container.\n${yaml(compose)}`;
  composeYaml = composeYaml.replace(/PROXY_AUTH_ADD: false\n/g, 'PROXY_AUTH_ADD: "false"\n');

  const manifest: Record<string, unknown> = {
    manifestVersion: 1,
    id,
    storage: { dataRoot: "data" },
    category,
    name,
    version: String(version),
    tagline,
    icon: iconField,
    description,
    releaseNotes: "",
    developer,
    website,
    dependencies: [],
    repo: repo || "",
    support,
    port,
    gallery: [],
    path: "",
    defaultUsername: "",
    defaultPassword: "",
    submitter: context.submitter || "HeilSS",
  };
  const manifestYaml = manifestDocument(manifest);
  const dataDirs = collectDataDirs(services);
  const validation = validateEntry({
    storeId: context.storeId,
    id,
    manifestYaml,
    composeYaml,
    usedPorts: context.usedPorts,
  });
  issues.push(...validation.filter((issue) => !issues.some((existing) => existing.message === issue.message)));

  return {
    id,
    manifestYaml,
    composeYaml,
    iconSvg,
    iconDataUrl,
    dataDirs,
    detected: kind,
    issues,
    meta: {
      source: input.source,
      kind,
      image: image || input.source.trim(),
      digest,
      umbrelLogin: input.umbrelLogin,
      internalPort,
      primaryService: primary,
    },
  };
}

function noteRegistry(issues: Issue[], image: string, info: ImageInfo): void {
  if (info.status === "missing") {
    issues.push({ level: "error", message: info.detail || `${image} was not found on the registry` });
  } else if (info.status === "unknown") {
    issues.push({
      level: "warning",
      message: info.detail || `Could not confirm ${image} on the registry. Save is allowed, but check the image name before installing.`,
    });
  }
}

function collectImages(compose: string): string[] {
  try {
    const doc = parseYaml(compose) as { services?: Record<string, { image?: string }> };
    return Object.values(doc.services ?? {})
      .map((service) => service.image)
      .filter((image): image is string => Boolean(image))
      .map(stripDigest);
  } catch {
    return [];
  }
}

function stripDigest(image: string): string {
  const at = image.lastIndexOf("@");
  if (at > 0 && image.slice(at + 1).startsWith("sha256:")) return image.slice(0, at);
  return image;
}

function findDigest(image: string, cache: Map<string, ImageInfo>): string | undefined {
  return cache.get(stripDigest(image))?.digest ?? parseImageRef(image).digest;
}

function titleFromImage(image: string): string {
  if (!image) return "";
  try {
    const ref = parseImageRef(stripDigest(image));
    const short = ref.repository.split("/").pop() ?? "";
    return short
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "";
  }
}

function versionFromImage(image: string): string {
  if (!image) return "1.0.0";
  try {
    const tag = parseImageRef(stripDigest(image)).tag.replace(/^v/, "");
    if (!tag || tag === "latest" || tag === "stable") return "1.0.0";
    return tag;
  } catch {
    return "1.0.0";
  }
}

function collectDataDirs(services: Record<string, Service>): string[] {
  const dirs = new Set<string>();
  for (const service of Object.values(services)) {
    const volumes = Array.isArray(service.volumes) ? service.volumes.map(String) : [];
    for (const volume of volumes) {
      const match = volume.match(/\$\{APP_DATA_DIR\}\/([^:]+)/);
      if (match) dirs.add(match[1]);
    }
  }
  return [...dirs];
}

export function bumpVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!match) return `${version}.1`;
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}${match[4]}`;
}

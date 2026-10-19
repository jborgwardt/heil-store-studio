import { formatImage, hubPage, parseImageRef, type ImageRef } from "@/lib/parse";
import { redactString } from "@/lib/redact";

export type ImageInfo = {
  status: "found" | "missing" | "unknown";
  digest?: string;
  exposedPorts: number[];
  description?: string;
  website?: string;
  source?: string;
  vendor?: string;
  title?: string;
  detail?: string;
};

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

function registryHost(registry: string): string {
  return registry === "docker.io" ? "registry-1.docker.io" : registry;
}

async function registryToken(ref: ImageRef): Promise<string | undefined> {
  const host = registryHost(ref.registry);
  const service = ref.registry === "docker.io" ? "registry.docker.io" : ref.registry;
  const urls = [
    `https://${host}/token?service=${encodeURIComponent(service)}&scope=${encodeURIComponent(`repository:${ref.repository}:pull`)}`,
    `https://auth.docker.io/token?service=registry.docker.io&scope=${encodeURIComponent(`repository:${ref.repository}:pull`)}`,
  ];
  if (ref.registry !== "docker.io") urls.splice(1, 1);
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) continue;
      const body = (await response.json()) as { token?: string; access_token?: string };
      const token = body.token || body.access_token;
      if (token) return token;
    } catch {
      continue;
    }
  }
  return undefined;
}

type OciIndex = {
  manifests?: { digest: string; platform?: { os?: string; architecture?: string }; mediaType?: string }[];
  config?: { digest: string };
  layers?: unknown[];
};

async function readConfigPorts(host: string, ref: ImageRef, token: string | undefined, manifest: OciIndex): Promise<{
  ports: number[];
  labels: Record<string, string>;
}> {
  let configDigest = manifest.config?.digest;
  if (!configDigest && manifest.manifests?.length) {
    const preferred =
      manifest.manifests.find((item) => item.platform?.os === "linux" && item.platform.architecture === "amd64") ??
      manifest.manifests.find((item) => item.platform?.os === "linux") ??
      manifest.manifests[0];
    const child = await fetch(`${host}/v2/${ref.repository}/manifests/${preferred.digest}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (child.ok) {
      const body = (await child.json()) as OciIndex;
      configDigest = body.config?.digest;
    }
  }
  if (!configDigest) return { ports: [], labels: {} };
  const blob = await fetch(`${host}/v2/${ref.repository}/blobs/${configDigest}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(8000),
  });
  if (!blob.ok) return { ports: [], labels: {} };
  const config = (await blob.json()) as {
    config?: { ExposedPorts?: Record<string, unknown>; Labels?: Record<string, string> };
  };
  const ports = Object.keys(config.config?.ExposedPorts ?? {})
    .map((key) => Number(key.split("/")[0]))
    .filter((port) => Number.isInteger(port));
  return { ports, labels: config.config?.Labels ?? {} };
}

export async function liveImageInfo(image: string): Promise<ImageInfo> {
  if (process.env.HEILSS_REGISTRY === "off") {
    return { status: "unknown", exposedPorts: [], detail: "Registry checks are disabled" };
  }
  const ref = parseImageRef(image);
  const host = `https://${registryHost(ref.registry)}`;
  try {
    const token = await registryToken(ref);
    const response = await fetch(`${host}/v2/${ref.repository}/manifests/${ref.digest ?? ref.tag}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: MANIFEST_ACCEPT,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 404) {
      return { status: "missing", exposedPorts: [], detail: `${formatImage(ref)} was not found on the registry` };
    }
    if (!response.ok) {
      return {
        status: "unknown",
        exposedPorts: [],
        detail: `Registry returned ${response.status} for ${formatImage(ref)}`,
      };
    }
    const digest = response.headers.get("docker-content-digest") ?? ref.digest ?? undefined;
    const manifest = (await response.json()) as OciIndex;
    const config = await readConfigPorts(host, ref, token, manifest).catch(() => ({
      ports: [] as number[],
      labels: {} as Record<string, string>,
    }));
    const hub = await dockerHubBlurb(ref).catch(() => ({} as { description?: string }));
    const labels = config.labels;
    return {
      status: "found",
      digest: digest ?? undefined,
      exposedPorts: config.ports,
      description: labels["org.opencontainers.image.description"] || hub.description,
      website: labels["org.opencontainers.image.url"] || labels["org.opencontainers.image.documentation"],
      source: labels["org.opencontainers.image.source"],
      vendor: labels["org.opencontainers.image.vendor"] || labels["org.opencontainers.image.authors"],
      title: labels["org.opencontainers.image.title"],
    };
  } catch (error) {
    return { status: "unknown", exposedPorts: [], detail: redactString(error instanceof Error ? error.message : "registry unreachable") };
  }
}

async function dockerHubBlurb(ref: ImageRef): Promise<{ description?: string }> {
  if (ref.registry !== "docker.io") return {};
  const response = await fetch(`https://hub.docker.com/v2/repositories/${ref.repository}/`, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return {};
  const body = (await response.json()) as { description?: string };
  return { description: body.description };
}

export type RegistryClient = (image: string) => Promise<ImageInfo>;

let client: RegistryClient = liveImageInfo;

export function setRegistryClient(next: RegistryClient | null): void {
  client = next ?? liveImageInfo;
}

export async function inspectImage(image: string): Promise<ImageInfo> {
  return client(image);
}

export function imageWebsite(ref: ImageRef, info: ImageInfo): string {
  if (info.website && /^https?:\/\//.test(info.website)) return info.website;
  if (info.source && /^https?:\/\//.test(info.source)) return info.source;
  return hubPage(ref);
}

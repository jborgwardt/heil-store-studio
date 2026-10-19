import { parse as parseYaml } from "yaml";
import { isReservedPort } from "@/lib/parse";

export type Issue = { level: "error" | "warning"; message: string };

type Manifest = Record<string, unknown>;

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Checks a generated entry against the umbrelOS AppManifestSchema
 * (packages/umbreld/source/modules/apps/schema.ts) and the community store
 * rules in getumbrel/umbrel-community-app-store plus the app_proxy /
 * APP_DATA_DIR conventions in getumbrel/umbrel-apps.
 */
export function validateEntry(input: {
  storeId: string;
  id: string;
  manifestYaml: string;
  composeYaml: string;
  usedPorts: number[];
  ignoreOwnPort?: number;
}): Issue[] {
  const issues: Issue[] = [];
  let manifest: Manifest;
  let compose: { services?: Record<string, Record<string, unknown>> };
  try {
    manifest = parseYaml(input.manifestYaml) as Manifest;
  } catch (error) {
    return [{ level: "error", message: `umbrel-app.yml is not valid YAML: ${(error as Error).message}` }];
  }
  try {
    compose = parseYaml(input.composeYaml) as { services?: Record<string, Record<string, unknown>> };
  } catch (error) {
    return [{ level: "error", message: `docker-compose.yml is not valid YAML: ${(error as Error).message}` }];
  }

  if (manifest.manifestVersion !== 1 && manifest.manifestVersion !== "1" && manifest.manifestVersion !== "1.0.0") {
    const version = manifest.manifestVersion;
    if (typeof version !== "number" && typeof version !== "string") {
      issues.push({ level: "error", message: "manifestVersion is required" });
    }
  }
  if (manifest.id !== input.id) issues.push({ level: "error", message: "Manifest id must match the app folder name" });
  if (typeof manifest.id !== "string" || !/^[a-z0-9-]+$/.test(manifest.id)) {
    issues.push({ level: "error", message: "App id must be lowercase letters, numbers, and dashes" });
  } else if (!manifest.id.startsWith(`${input.storeId}-`)) {
    issues.push({
      level: "error",
      message: `App id must be prefixed with the store id ("${input.storeId}-")`,
    });
  }
  for (const field of ["name", "tagline", "category", "version", "description", "support"] as const) {
    if (typeof manifest[field] !== "string" || !(manifest[field] as string).trim()) {
      issues.push({ level: "error", message: `${field} is required` });
    }
  }
  if (typeof manifest.tagline === "string" && manifest.tagline.trim().endsWith(".")) {
    issues.push({ level: "error", message: "Tagline must not end with a period" });
  }
  if (typeof manifest.website !== "string" || !isUrl(manifest.website)) {
    issues.push({ level: "error", message: "website must be an http(s) URL" });
  }
  if (manifest.repo !== undefined && manifest.repo !== "" && (typeof manifest.repo !== "string" || !isUrl(manifest.repo))) {
    issues.push({ level: "error", message: "repo must be empty or an http(s) URL" });
  }
  if (typeof manifest.port !== "number" || !Number.isInteger(manifest.port)) {
    issues.push({ level: "error", message: "port must be an integer" });
  } else if (isReservedPort(manifest.port)) {
    issues.push({
      level: "error",
      message: `port ${manifest.port} is reserved (80, 443, 2000, or the 40000-49999 virtual machine range)`,
    });
  } else if (input.usedPorts.includes(manifest.port) && manifest.port !== input.ignoreOwnPort) {
    issues.push({ level: "error", message: `port ${manifest.port} clashes with another entry in this store` });
  }
  if (!Array.isArray(manifest.gallery)) issues.push({ level: "error", message: "gallery must be an array" });
  if (manifest.dependencies !== undefined && !Array.isArray(manifest.dependencies)) {
    issues.push({ level: "error", message: "dependencies must be an array" });
  }
  const storage = manifest.storage as { dataRoot?: string } | undefined;
  if (!storage || storage.dataRoot !== "data") {
    issues.push({ level: "error", message: 'storage.dataRoot must be exactly "data"' });
  }
  if (typeof manifest.icon !== "string" || !manifest.icon) {
    issues.push({
      level: "error",
      message: "Community stores need an icon URL. Umbrel falls back to the official gallery otherwise.",
    });
  }
  if (/www-authenticate/i.test(input.manifestYaml) || /www-authenticate/i.test(input.composeYaml)) {
    issues.push({ level: "error", message: "Entries must not configure HTTP authentication challenges" });
  }

  const services = compose.services ?? {};
  const proxy = services.app_proxy;
  if (!proxy) {
    issues.push({ level: "error", message: "docker-compose.yml needs an app_proxy service" });
  } else {
    const env = (proxy.environment ?? {}) as Record<string, unknown>;
    const host = env.APP_HOST;
    const port = env.APP_PORT;
    if (typeof host !== "string" || !host.endsWith("_1") || !host.startsWith(`${input.id}_`)) {
      issues.push({
        level: "error",
        message: "APP_HOST must be the Umbrel container name <app-id>_<service>_1",
      });
    }
    if (typeof port !== "number" && typeof port !== "string") {
      issues.push({ level: "error", message: "APP_PORT must be the container listen port" });
    }
    if (env.PROXY_AUTH_ADD !== undefined && env.PROXY_AUTH_ADD !== "false" && env.PROXY_AUTH_ADD !== false) {
      issues.push({ level: "warning", message: 'PROXY_AUTH_ADD only needs to be set to "false" when Umbrel login is off' });
    }
  }
  const appServices = Object.entries(services).filter(([name]) => name !== "app_proxy");
  if (appServices.length === 0) issues.push({ level: "error", message: "Add at least one application service next to app_proxy" });
  for (const [name, service] of appServices) {
    if (service.build) issues.push({ level: "error", message: `${name} uses build:. Umbrel packages must use a prebuilt image` });
    if (!service.image) issues.push({ level: "error", message: `${name} is missing an image` });
    if (service.privileged === true) issues.push({ level: "error", message: `${name} must not run privileged` });
    if (service.network_mode === "host") {
      issues.push({ level: "error", message: `${name} uses host networking, which cannot sit behind app_proxy` });
    }
    const volumes = Array.isArray(service.volumes) ? service.volumes.map(String) : [];
    if (volumes.some((volume) => volume.includes("docker.sock"))) {
      issues.push({ level: "error", message: `${name} must not mount the Docker socket` });
    }
    for (const volume of volumes) {
      if (volume.includes(":") && !volume.includes("${APP_DATA_DIR}")) {
        const source = volume.split(":")[0];
        if (!source.startsWith("$") && !source.startsWith("./") && !source.startsWith("/")) {
          issues.push({ level: "error", message: `${name} still has named volume "${source}". Persist under \${APP_DATA_DIR}` });
        }
      }
    }
    if (!volumes.some((volume) => volume.includes("${APP_DATA_DIR}"))) {
      issues.push({ level: "warning", message: `${name} has no \${APP_DATA_DIR} mount, so its files will not survive a recreate` });
    }
  }
  return issues;
}

export function storeMetaIssues(id: string, name: string): Issue[] {
  const issues: Issue[] = [];
  if (!/^[a-z]+(-[a-z]+)*$/.test(id)) {
    issues.push({ level: "error", message: "Store id must be lowercase a-z and dashes only" });
  }
  if (!name.trim()) issues.push({ level: "error", message: "Store name is required" });
  return issues;
}

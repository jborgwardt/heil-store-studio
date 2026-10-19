import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const data = mkdtempSync(path.join(os.tmpdir(), "heilss-unit-"));
process.env.HEILSS_DATA_DIR = data;
process.env.HEILSS_REGISTRY = "off";

describe("store entry from docker run nginx", () => {
  beforeAll(() => {
    process.env.HEILSS_DATA_DIR = data;
    process.env.HEILSS_REGISTRY = "off";
  });

  afterAll(async () => {
    await rm(data, { recursive: true, force: true });
  });

  it("commits a valid Umbrel community app", async () => {
    const { createEntry, listEntries } = await import("@/lib/store");
    const { validateEntry } = await import("@/lib/validate");
    const built = await createEntry({
      name: "Nginx",
      source: "docker run nginx",
      umbrelLogin: true,
      autoIcon: true,
    });
    expect(built.id).toBe("heil-nginx");
    expect(built.issues.filter((issue) => issue.level === "error")).toEqual([]);

    const root = path.join(data, "store");
    const meta = parseYaml(await readFile(path.join(root, "umbrel-app-store.yml"), "utf8")) as { id: string; name: string };
    expect(meta.id).toBe("heil");
    expect(meta.name).toBe("Heil");

    const manifestYaml = await readFile(path.join(root, "heil-nginx", "umbrel-app.yml"), "utf8");
    const composeYaml = await readFile(path.join(root, "heil-nginx", "docker-compose.yml"), "utf8");
    const manifest = parseYaml(manifestYaml) as Record<string, unknown>;
    const compose = parseYaml(composeYaml) as {
      version: string;
      services: Record<string, { environment?: Record<string, unknown>; image?: string; volumes?: string[] }>;
    };

    expect(manifest.id).toBe("heil-nginx");
    expect(String(manifest.id)).toMatch(/^heil-/);
    expect(manifest.manifestVersion).toBe(1);
    expect((manifest.storage as { dataRoot: string }).dataRoot).toBe("data");
    expect(manifest.port).toBe(32000);
    expect(manifest.gallery).toEqual([]);
    expect(manifest.dependencies).toEqual([]);
    expect(manifest.path).toBe("");
    expect(String(manifest.icon).startsWith("data:image/svg+xml")).toBe(true);
    expect(String(manifest.tagline).endsWith(".")).toBe(false);
    expect(compose.version).toBe("3.7");
    expect(compose.services.app_proxy.environment?.APP_HOST).toBe("heil-nginx_web_1");
    expect(compose.services.app_proxy.environment?.APP_PORT).toBe(80);
    expect(compose.services.app_proxy.environment?.PROXY_AUTH_ADD).toBeUndefined();
    expect(compose.services.web.image).toBe("nginx:latest");
    expect(compose.services.web.volumes?.[0]).toContain("${APP_DATA_DIR}");
    expect(composeYaml).not.toMatch(/www-authenticate/i);
    expect(composeYaml).not.toMatch(/docker\.sock/);

    const issues = validateEntry({
      storeId: "heil",
      id: "heil-nginx",
      manifestYaml,
      composeYaml,
      usedPorts: [],
    });
    expect(issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect((await listEntries()).map((entry) => entry.id)).toEqual(["heil-nginx"]);
  });

  it("rejects a second entry that reuses the host port", async () => {
    const { createEntry } = await import("@/lib/store");
    await expect(
      createEntry({
        name: "Other",
        source: "docker run redis:7",
        umbrelLogin: false,
        autoIcon: true,
        port: 32000,
      }),
    ).rejects.toThrow(/32000/);
  });

  it("turns Umbrel login off with PROXY_AUTH_ADD", async () => {
    const { createEntry } = await import("@/lib/store");
    const built = await createEntry({
      name: "Public Nginx",
      source: "docker run -p 8080:80 nginx:1.27",
      umbrelLogin: false,
      autoIcon: true,
    });
    expect(built.composeYaml).toMatch(/PROXY_AUTH_ADD: "false"/);
    expect(built.composeYaml).not.toMatch(/www-authenticate/i);
    const compose = parseYaml(built.composeYaml) as { services: { app_proxy: { environment: { APP_PORT: number } } } };
    expect(compose.services.app_proxy.environment.APP_PORT).toBe(80);
  });
});

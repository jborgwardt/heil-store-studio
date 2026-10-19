import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import { parse as parseYaml } from "yaml";

const port = 43921;
const base = `http://127.0.0.1:${port}`;
let dataDir = "";
let server: ChildProcess | undefined;

async function waitForServer() {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < 90000) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
      last = `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : "not ready";
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`HeilSS did not start: ${last}`);
}

describe("end to end store", () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "heilss-e2e-"));
    server = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: path.resolve(__dirname, "../.."),
      env: {
        ...process.env,
        HEILSS_DATA_DIR: dataDir,
        HEILSS_REGISTRY: "off",
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", () => undefined);
    server.stderr?.on("data", () => undefined);
    await waitForServer();
  }, 120000);

  afterAll(async () => {
    server?.kill("SIGTERM");
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("creates an nginx entry from docker run and serves a cloneable Umbrel store", async () => {
    const created = await fetch(`${base}/api/apps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Nginx",
        source: "docker run nginx",
        umbrelLogin: true,
        autoIcon: true,
      }),
    });
    expect(created.headers.get("www-authenticate")).toBeNull();
    const body = await created.json();
    expect(created.ok, JSON.stringify(body)).toBe(true);
    expect(body.id).toBe("heil-nginx");
    expect(body.issues.filter((issue: { level: string }) => issue.level === "error")).toEqual([]);

    const health = await fetch(`${base}/api/health`);
    expect(health.headers.get("www-authenticate")).toBeNull();

    const refs = await fetch(`${base}/git/store.git/info/refs?service=git-upload-pack`);
    expect(refs.ok).toBe(true);
    expect(refs.headers.get("www-authenticate")).toBeNull();
    expect(refs.headers.get("content-type")).toContain("git-upload-pack-advertisement");

    const cloneDir = path.join(dataDir, "clone");
    await git.clone({
      fs,
      http,
      dir: cloneDir,
      url: `${base}/git/store.git`,
      depth: 1,
      singleBranch: true,
    });
    const remoteRefs = await git.listServerRefs({ http, url: `${base}/git/store.git` });
    expect(remoteRefs.some((ref) => ref.ref === "HEAD")).toBe(true);

    const store = parseYaml(fs.readFileSync(path.join(cloneDir, "umbrel-app-store.yml"), "utf8")) as { id: string; name: string };
    expect(store.id).toBe("heil");
    expect(store.name).toBe("Heil");
    const manifest = parseYaml(fs.readFileSync(path.join(cloneDir, "heil-nginx", "umbrel-app.yml"), "utf8")) as Record<string, unknown>;
    const compose = parseYaml(fs.readFileSync(path.join(cloneDir, "heil-nginx", "docker-compose.yml"), "utf8")) as {
      services: { app_proxy: { environment: Record<string, unknown> }; web: { image: string; volumes: string[] } };
    };
    expect(manifest.id).toBe("heil-nginx");
    expect(String(manifest.id).startsWith(`${store.id}-`)).toBe(true);
    expect(fs.existsSync(path.join(cloneDir, String(manifest.id)))).toBe(true);
    expect(manifest.port).toBe(32000);
    expect((manifest.storage as { dataRoot: string }).dataRoot).toBe("data");
    expect(Array.isArray(manifest.gallery)).toBe(true);
    expect(Array.isArray(manifest.dependencies)).toBe(true);
    expect(String(manifest.website)).toMatch(/^https?:\/\//);
    expect(String(manifest.icon).length).toBeGreaterThan(20);
    expect(compose.services.app_proxy.environment.APP_HOST).toBe("heil-nginx_web_1");
    expect(Number(compose.services.app_proxy.environment.APP_PORT)).toBe(80);
    expect(compose.services.web.image.startsWith("nginx")).toBe(true);
    expect(compose.services.web.volumes.join("\n")).toContain("${APP_DATA_DIR}");
    const composeText = fs.readFileSync(path.join(cloneDir, "heil-nginx", "docker-compose.yml"), "utf8");
    expect(composeText).not.toMatch(/www-authenticate/i);
    expect(composeText).not.toMatch(/basic auth/i);
  }, 60000);
});

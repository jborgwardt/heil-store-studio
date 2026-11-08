import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, chmodSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const data = mkdtempSync(path.join(os.tmpdir(), "heilss-icons-"));
process.env.HEILSS_DATA_DIR = data;
process.env.HEILSS_REGISTRY = "off";
process.env.HEILSS_ALLOW_FILE_REMOTES = "1";

// 1×1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const pngUrl = `data:image/png;base64,${PNG.toString("base64")}`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';

function sh(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
}

/** A bare "remote" community store with one hand-written app (docker.sock: must never be rebuilt by HeilSS). */
function makeRemote(name: string): { bare: string; url: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), `heilss-remote-${name}-`));
  const bare = path.join(root, "store.git");
  const seed = path.join(root, "seed");
  sh(["init", "--bare", "-b", "main", bare], root);
  sh(["init", "-b", "main", seed], root);
  writeFileSync(path.join(seed, "umbrel-app-store.yml"), 'id: "priv"\nname: "Priv"\n');
  mkdirSync(path.join(seed, "priv-tool"));
  writeFileSync(
    path.join(seed, "priv-tool", "umbrel-app.yml"),
    "manifestVersion: 1\nid: priv-tool\n# keep this comment\nname: Priv Tool\nversion: \"1.2.3\"\ncategory: developer\ntagline: A tool\nicon: https://example.com/old.png\ndescription: Hand written\ndeveloper: me\nwebsite: https://github.com/octo/tool\ndependencies: []\nrepo: \"\"\nsupport: https://example.com\nport: 41234\ngallery: []\npath: \"\"\ndefaultUsername: \"\"\ndefaultPassword: \"\"\nsubmitter: me\n",
  );
  writeFileSync(
    path.join(seed, "priv-tool", "docker-compose.yml"),
    'version: "3.7"\nservices:\n  app_proxy:\n    environment:\n      APP_HOST: priv-tool_web_1\n      APP_PORT: 8080\n  web:\n    image: alpine:3.20\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n',
  );
  sh(["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], seed);
  sh(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "seed"], seed);
  sh(["push", "-q", bare, "main"], seed);
  return { bare, url: `file://${bare}` };
}

async function inLinked<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const { storeScope } = await import("@/lib/paths");
  return storeScope.run({ key }, fn);
}

describe("icon uploads", () => {
  it("accepts real images and rejects disguised or oversized files", async () => {
    const { decodeIconUpload } = await import("@/lib/icons");
    expect(decodeIconUpload(pngUrl).ext).toBe("png");
    expect(decodeIconUpload(`data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`).ext).toBe("svg");
    // Claimed PNG, actually text: the bytes decide.
    expect(() => decodeIconUpload(`data:image/png;base64,${Buffer.from("hello").toString("base64")}`)).toThrow(/not an SVG, PNG/);
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    expect(() => decodeIconUpload(`data:image/png;base64,${big.toString("base64")}`)).toThrow(/1 MB/);
  });
});

describe("HeilSS's own store", () => {
  afterAll(async () => {
    await rm(data, { recursive: true, force: true });
  });

  it("stores an uploaded PNG as icon.png and keeps it on edit", async () => {
    const { createEntry, updateEntry, getEntry, iconFile } = await import("@/lib/store");
    const built = await createEntry({ name: "Pic", source: "docker run nginx", umbrelLogin: true, autoIcon: false, iconDataUrl: pngUrl });
    const dir = path.join(data, "store", built.id);
    expect(existsSync(path.join(dir, "icon.png"))).toBe(true);
    expect(existsSync(path.join(dir, "icon.svg"))).toBe(false);
    const manifest = parseYaml(readFileSync(path.join(dir, "umbrel-app.yml"), "utf8")) as { icon: string };
    expect(manifest.icon.startsWith("data:image/png;base64,")).toBe(true);
    expect((await iconFile(built.id))?.type).toBe("image/png");
    expect((await getEntry(built.id)).iconSrc).toMatch(new RegExp(`^/media/apps/${built.id}/icon\\?v=`));

    await updateEntry(built.id, { name: "Pic", source: "docker run nginx", umbrelLogin: false, autoIcon: true, keepIcon: true });
    expect(readFileSync(path.join(dir, "icon.png")).equals(PNG)).toBe(true);
  });

  it("Change icon replaces the file and points the manifest at the public URL", async () => {
    const { writeSettings, readSettings } = await import("@/lib/settings");
    await writeSettings({ ...(await readSettings()), publicBaseUrl: "http://umbrel.local:8480" });
    const { createEntry, setEntryIcon } = await import("@/lib/store");
    const built = await createEntry({ name: "Swap", source: "docker run redis:7", umbrelLogin: true, autoIcon: false });
    const dir = path.join(data, "store", built.id);
    expect(existsSync(path.join(dir, "icon.svg"))).toBe(true);
    await setEntryIcon(built.id, { mode: "upload", dataUrl: pngUrl });
    expect(existsSync(path.join(dir, "icon.svg"))).toBe(false);
    const manifest = parseYaml(readFileSync(path.join(dir, "umbrel-app.yml"), "utf8")) as { icon: string };
    expect(manifest.icon).toMatch(new RegExp(`^http://umbrel\\.local:8480/media/apps/${built.id}/icon\\.png\\?v=[0-9a-f]{10}$`));
  });
});

describe("linked stores", () => {
  let writable: { bare: string; url: string };
  let readonly: { bare: string; url: string };

  beforeAll(async () => {
    writable = makeRemote("rw");
    readonly = makeRemote("ro");
    const { applySettingsPatch, readSettings, writeSettings } = await import("@/lib/settings");
    const next = applySettingsPatch(await readSettings(), {
      stores: [
        { key: "priv", url: writable.url, branch: "main", token: "test-token" },
        { key: "ro", url: readonly.url, branch: "main" },
      ],
    });
    await writeSettings(next);
  });

  it("lists the store's own apps, marked as not HeilSS-built", async () => {
    const { listEntries, currentStore } = await import("@/lib/store");
    const apps = await inLinked("priv", () => listEntries());
    expect(apps.map((app) => app.id)).toEqual(["priv-tool"]);
    expect(apps[0].managed).toBe(false);
    expect((await inLinked("priv", () => currentStore())).storeId).toBe("priv");
  });

  it("Change icon commits icon.png, keeps manifest comments, and pushes to the remote", async () => {
    const { setEntryIcon } = await import("@/lib/store");
    const detail = await inLinked("priv", () => setEntryIcon("priv-tool", { mode: "upload", dataUrl: pngUrl }));
    expect(detail.icon).toMatch(/\/raw\/branch\/main\/priv-tool\/icon\.png\?v=[0-9a-f]{10}$/);
    const pushed = execFileSync("git", ["show", "main:priv-tool/icon.png"], { cwd: writable.bare });
    expect(Buffer.from(pushed).equals(PNG)).toBe(true);
    const manifest = sh(["show", "main:priv-tool/umbrel-app.yml"], writable.bare);
    expect(manifest).toContain("# keep this comment");
    expect(sh(["log", "-1", "--format=%s", "main"], writable.bare).trim()).toBe("Change icon for priv-tool");
  });

  it("refuses the rebuild form for apps HeilSS did not create", async () => {
    const { updateEntry } = await import("@/lib/store");
    await expect(
      inLinked("priv", () => updateEntry("priv-tool", { name: "Priv Tool", source: "docker run alpine", umbrelLogin: true, autoIcon: true })),
    ).rejects.toThrow(/not created by HeilSS/);
  });

  it("Edit files saves YAML and bumps the version", async () => {
    const { getEntry, saveEntryFiles } = await import("@/lib/store");
    const current = await inLinked("priv", () => getEntry("priv-tool"));
    await inLinked("priv", () =>
      saveEntryFiles("priv-tool", { manifestYaml: current.manifestYaml.replace("A tool", "A better tool"), composeYaml: current.composeYaml, bump: true }),
    );
    const manifest = parseYaml(sh(["show", "main:priv-tool/umbrel-app.yml"], writable.bare)) as { version: string; tagline: string };
    expect(manifest.version).toBe("1.2.4");
    expect(manifest.tagline).toBe("A better tool");
  });

  it("a store without a token is read-only", async () => {
    const { setEntryIcon } = await import("@/lib/store");
    await expect(inLinked("ro", () => setEntryIcon("priv-tool", { mode: "monogram" }))).rejects.toThrow(/read-only/);
  });

  it("a rejected push changes nothing locally", async () => {
    const hook = path.join(writable.bare, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho denied >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    const { setEntryIcon } = await import("@/lib/store");
    const { linkedStoreDir } = await import("@/lib/paths");
    await expect(inLinked("priv", () => setEntryIcon("priv-tool", { mode: "monogram" }))).rejects.toThrow(/Nothing was changed/);
    const clone = linkedStoreDir("priv");
    expect(existsSync(path.join(clone, "priv-tool", "icon.png"))).toBe(true);
    expect(existsSync(path.join(clone, "priv-tool", "icon.svg"))).toBe(false);
    expect(sh(["status", "--porcelain"], clone).trim()).toBe("");
  });
});

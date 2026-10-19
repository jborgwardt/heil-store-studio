import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const parent = mkdtempSync(path.join(os.tmpdir(), "heilss-parent-"));

function git(args: string[], cwd = parent): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

describe("community store git stays inside its data directory", () => {
  afterAll(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  it("does not commit or retarget a parent checkout", async () => {
    git(["init", "-b", "main", parent], os.tmpdir());
    git(["config", "user.email", "parent@example.com"]);
    git(["config", "user.name", "Parent"]);
    await writeFile(path.join(parent, "README.md"), "parent\n");
    git(["add", "README.md"]);
    git(["commit", "-m", "parent seed"]);
    git(["remote", "add", "origin", "https://example.invalid/parent.git"]);
    const before = git(["rev-parse", "HEAD"]).trim();

    process.env.HEILSS_DATA_DIR = path.join(parent, "data");
    process.env.HEILSS_REGISTRY = "off";
    const { createEntry } = await import("@/lib/store");
    const built = await createEntry({
      name: "Nginx",
      source: "docker run nginx",
      umbrelLogin: true,
      autoIcon: true,
    });
    expect(built.id).toBe("heil-nginx");
    expect(built.issues.filter((issue) => issue.level === "error")).toEqual([]);

    expect(git(["rev-parse", "HEAD"]).trim()).toBe(before);
    expect(git(["log", "--oneline"]).trim().split("\n")).toHaveLength(1);
    expect(git(["remote", "get-url", "origin"]).trim()).toBe("https://example.invalid/parent.git");
    expect(git(["config", "user.name"]).trim()).toBe("Parent");

    const store = path.join(parent, "data", "store");
    expect(git(["rev-parse", "--show-toplevel"], store).trim()).toBe(store);
    expect(git(["log", "--oneline"], store)).toMatch(/nginx/i);
    expect(git(["remote", "get-url", "origin"], store).trim()).toBe(path.join(parent, "data", "store.git"));
  });
});

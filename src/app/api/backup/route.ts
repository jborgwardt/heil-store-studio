import { pushGithub } from "@/lib/git";
import { backupToDrive } from "@/lib/remotes";
import { ensureStore } from "@/lib/git";
import { readSettings } from "@/lib/settings";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { target?: string };
    const settings = await readSettings();
    await ensureStore(settings.storeId, settings.storeName);
    if (body.target === "github") {
      if (!settings.github.enabled) return json({ error: "Turn on GitHub mirroring in Settings first" }, 400);
      await pushGithub(settings.github.repo, settings.github.branch || "main", settings.github.token);
      return json({ ok: true, target: "github" });
    }
    if (body.target === "drive") {
      const saved = await backupToDrive(settings);
      return json({ ok: true, target: "drive", id: saved.id, name: saved.name });
    }
    return json({ error: "Choose github or drive" }, 400);
  } catch (error) {
    return fail(error);
  }
}

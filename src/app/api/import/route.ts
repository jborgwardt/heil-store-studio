import { withLock } from "@/lib/lock";
import { ensureStore } from "@/lib/git";
import { importStore } from "@/lib/remotes";
import { readSettings } from "@/lib/settings";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("store")) return json({ error: "Import copies apps into HeilSS's own store. Switch to it first." }, 400);
    const body = (await request.json()) as { url?: string };
    if (!body.url?.trim()) return json({ error: "Paste a community store git URL" }, 400);
    const result = await withLock(async () => {
      const settings = await readSettings();
      await ensureStore(settings.storeId, settings.storeName);
      return importStore(body.url!.trim(), settings);
    });
    return json(result);
  } catch (error) {
    return fail(error);
  }
}

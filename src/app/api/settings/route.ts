import { ensureStore } from "@/lib/git";
import { applySettingsPatch, readSettings, toPublicSettings, writeSettings } from "@/lib/settings";
import { cloneUrlFor, updateStoreMeta } from "@/lib/store";
import { fail, json, originOf } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const settings = await readSettings();
    return json({ settings: toPublicSettings(settings), cloneUrl: cloneUrlFor(originOf(request), settings) });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function PUT(request: Request) {
  try {
    const previous = await readSettings();
    const patch = (await request.json()) as Record<string, unknown>;
    const next = applySettingsPatch(previous, patch);
    await ensureStore(previous.storeId, previous.storeName);
    if (next.storeId !== previous.storeId || next.storeName !== previous.storeName) {
      await updateStoreMeta(next, previous);
    }
    await writeSettings(next);
    return json({ settings: toPublicSettings(next), cloneUrl: cloneUrlFor(originOf(request), next) });
  } catch (error) {
    return fail(error);
  }
}

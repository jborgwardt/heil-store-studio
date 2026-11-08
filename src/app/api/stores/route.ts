import { readSettings } from "@/lib/settings";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Stores HeilSS can show: its own, plus every linked community store. */
export async function GET() {
  try {
    const settings = await readSettings();
    return json({
      stores: [
        { key: "", label: `${settings.storeName} (HeilSS)`, url: "", writable: true },
        ...settings.stores.map((store) => ({
          key: store.key,
          label: store.url.replace(/^https?:\/\//, "").replace(/\.git$/, ""),
          url: store.url,
          writable: store.token.length > 0,
        })),
      ],
    });
  } catch (error) {
    return fail(error, 500);
  }
}

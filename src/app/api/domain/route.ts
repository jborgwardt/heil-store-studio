import { applyDomain } from "@/lib/remotes";
import { readSettings } from "@/lib/settings";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const settings = await readSettings();
    return json(await applyDomain(settings));
  } catch (error) {
    return fail(error);
  }
}

import { callUmbrelTool } from "@/lib/mcp";
import { readSettings } from "@/lib/settings";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await readSettings();
    return json(await callUmbrelTool(settings, "list_apps", {}));
  } catch (error) {
    return fail(error);
  }
}

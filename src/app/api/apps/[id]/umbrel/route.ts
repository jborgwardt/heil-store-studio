import { callUmbrelTool } from "@/lib/mcp";
import { readSettings } from "@/lib/settings";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { action?: string };
    const settings = await readSettings();
    const action = body.action;
    if (action === "install") return json(await callUmbrelTool(settings, "install_app", { appId: id }));
    if (action === "update") return json(await callUmbrelTool(settings, "update_app", { appId: id }));
    if (action === "uninstall") return json(await callUmbrelTool(settings, "uninstall_app", { appId: id }));
    if (action === "status") return json(await callUmbrelTool(settings, "get_app_status", { appId: id }));
    return json({ error: "Unknown Umbrel action" }, 400);
  } catch (error) {
    return fail(error);
  }
}

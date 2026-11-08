import { saveEntryFiles } from "@/lib/store";
import { fail, inStore, json } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Save hand-edited umbrel-app.yml and docker-compose.yml, optionally bumping the version so Umbrel offers an update. */
export async function PUT(request: Request, context: Context) {
  try {
    return await inStore(request, async () => {
      const { id } = await context.params;
      const body = (await request.json()) as Partial<{ manifestYaml: string; composeYaml: string; bump: boolean }>;
      if (typeof body.manifestYaml !== "string" || typeof body.composeYaml !== "string") {
        return json({ error: "Both umbrel-app.yml and docker-compose.yml are required" }, 400);
      }
      return json(await saveEntryFiles(id, { manifestYaml: body.manifestYaml, composeYaml: body.composeYaml, bump: body.bump === true }));
    });
  } catch (error) {
    return fail(error);
  }
}

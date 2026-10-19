import { deleteEntry, getEntry, updateEntry } from "@/lib/store";
import { fail, json } from "@/lib/http";
import type { BuildInput } from "@/lib/build";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return json(await getEntry(id));
  } catch (error) {
    return fail(error, 404);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as BuildInput;
    const built = await updateEntry(id, {
      ...body,
      umbrelLogin: body.umbrelLogin !== false,
      autoIcon: body.autoIcon !== false,
    });
    return json({ id: built.id, issues: built.issues, manifestYaml: built.manifestYaml, composeYaml: built.composeYaml });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    await deleteEntry(id);
    return json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

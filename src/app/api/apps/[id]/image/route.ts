import { applyImageUpdate, checkImageUpdates } from "@/lib/store";
import { fail, inStore, json } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    return await inStore(request, async () => {
      const { id } = await context.params;
      const updates = await checkImageUpdates();
      return json(updates.find((item) => item.id === id) ?? { id, update: false });
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    return await inStore(request, async () => {
      const { id } = await context.params;
      return json(await applyImageUpdate(id));
    });
  } catch (error) {
    return fail(error);
  }
}

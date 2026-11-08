import { setEntryIcon, type IconChange } from "@/lib/store";
import { fail, inStore, json } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Change an app's icon: { mode: "upload", dataUrl } | { mode: "monogram" } | { mode: "fetch" }. */
export async function POST(request: Request, context: Context) {
  try {
    return await inStore(request, async () => {
      const { id } = await context.params;
      const body = (await request.json()) as Partial<{ mode: string; dataUrl: string }>;
      let change: IconChange;
      if (body.mode === "upload" && typeof body.dataUrl === "string") change = { mode: "upload", dataUrl: body.dataUrl };
      else if (body.mode === "monogram") change = { mode: "monogram" };
      else if (body.mode === "fetch") change = { mode: "fetch" };
      else return json({ error: "Choose an image to upload, or fetch / draw one" }, 400);
      return json(await setEntryIcon(id, change));
    });
  } catch (error) {
    return fail(error);
  }
}

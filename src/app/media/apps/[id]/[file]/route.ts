import { iconFile } from "@/lib/store";
import { inStore } from "@/lib/http";
import { iconHeaders } from "@/lib/icons";

export const dynamic = "force-dynamic";

/** /media/apps/<id>/icon.svg|png|webp|gif|jpg — serves whatever icon the app has. */
export async function GET(request: Request, context: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await context.params;
  if (!/^[a-z0-9-]+$/.test(id) || !/^icon\.(svg|png|webp|gif|jpe?g)$/i.test(file)) return new Response("Not found", { status: 404 });
  const icon = await inStore(request, () => iconFile(id)).catch(() => null);
  if (!icon) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(icon.body), { headers: iconHeaders(icon.type) });
}

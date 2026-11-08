import { iconFile } from "@/lib/store";
import { inStore } from "@/lib/http";
import { iconHeaders } from "@/lib/icons";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-z0-9-]+$/.test(id)) return new Response("Not found", { status: 404 });
  const icon = await inStore(request, () => iconFile(id)).catch(() => null);
  if (!icon) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(icon.body), { headers: iconHeaders(icon.type) });
}

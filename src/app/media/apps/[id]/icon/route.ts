import { iconFile } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-z0-9-]+$/.test(id)) return new Response("Not found", { status: 404 });
  const icon = await iconFile(id);
  if (!icon) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(icon.body), {
    headers: {
      "Content-Type": icon.type,
      "Cache-Control": "public, max-age=300",
    },
  });
}

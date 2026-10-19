import { serveGit } from "@/lib/git-http";
import { ensureStore } from "@/lib/git";
import { readSettings } from "@/lib/settings";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ path?: string[] }> };

async function handle(request: Request, context: Context) {
  const settings = await readSettings();
  await ensureStore(settings.storeId, settings.storeName);
  const { path } = await context.params;
  if (!path?.length) {
    return json({
      git: true,
      hint: "Clone this community store with the URL ending in /git/store.git",
    });
  }
  const pathInfo = `/store.git/${path.join("/")}`;
  return serveGit(request, pathInfo);
}

export function GET(request: Request, context: Context) {
  return handle(request, context);
}

export function POST(request: Request, context: Context) {
  return handle(request, context);
}

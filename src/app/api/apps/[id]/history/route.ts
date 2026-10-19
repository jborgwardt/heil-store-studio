import { entryDiff, entryHistory, rollbackEntry } from "@/lib/store";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const sha = new URL(request.url).searchParams.get("diff");
    if (sha) return json({ diff: await entryDiff(id, sha) });
    return json({ history: await entryHistory(id) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { sha?: string };
    if (!body.sha) return json({ error: "Choose a commit to restore" }, 400);
    await rollbackEntry(id, body.sha);
    return json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

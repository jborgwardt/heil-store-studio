import { createEntry, currentStore, listEntries, previewEntry } from "@/lib/store";
import { cloneUrlFor } from "@/lib/store";
import { fail, inStore, json, originOf } from "@/lib/http";
import type { BuildInput } from "@/lib/build";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await inStore(request, async () => {
      const ctx = await currentStore();
      const apps = await listEntries();
      return json({
        storeId: ctx.storeId,
        storeName: ctx.storeName,
        cloneUrl: ctx.linked ? ctx.linked.url : cloneUrlFor(originOf(request), ctx.settings),
        linked: ctx.linked ? { key: ctx.linked.key, url: ctx.linked.url, branch: ctx.linked.branch, writable: ctx.linked.token.length > 0 } : null,
        apps,
      });
    });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    return await inStore(request, async () => {
      const body = (await request.json()) as BuildInput & { preview?: boolean };
      if (!body.source?.trim()) return json({ error: "Paste a Compose file, docker run command, GitHub URL, or image name" }, 400);
      const input: BuildInput = {
        ...body,
        umbrelLogin: body.umbrelLogin !== false,
        autoIcon: body.autoIcon !== false,
      };
      const built = body.preview ? await previewEntry(input) : await createEntry(input);
      return json({
        id: built.id,
        manifestYaml: built.manifestYaml,
        composeYaml: built.composeYaml,
        icon: built.iconDataUrl,
        issues: built.issues,
        detected: built.detected,
        meta: { ...built.meta, source: undefined },
        saved: !body.preview && built.issues.every((issue) => issue.level !== "error"),
      });
    });
  } catch (error) {
    return fail(error);
  }
}

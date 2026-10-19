import { createEntry, listEntries, previewEntry } from "@/lib/store";
import { cloneUrlFor } from "@/lib/store";
import { readSettings } from "@/lib/settings";
import { fail, json, originOf } from "@/lib/http";
import type { BuildInput } from "@/lib/build";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const settings = await readSettings();
    const apps = await listEntries();
    return json({
      storeId: settings.storeId,
      storeName: settings.storeName,
      cloneUrl: cloneUrlFor(originOf(request), settings),
      apps,
    });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(request: Request) {
  try {
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
  } catch (error) {
    return fail(error);
  }
}

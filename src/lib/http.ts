import { errorMessage } from "@/lib/redact";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function fail(error: unknown, status = 400): Response {
  return json({ error: errorMessage(error) }, status);
}

export function originOf(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

/**
 * Run a handler against the store named by `?store=<key>` (a linked store), or HeilSS's own store when absent.
 * Unknown keys fail instead of silently falling back to the wrong store.
 */
export async function inStore<T>(request: Request, fn: () => Promise<T>): Promise<T> {
  const key = new URL(request.url).searchParams.get("store");
  if (!key) return fn();
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(key)) throw new Error("Invalid store");
  const { readSettings, findLinkedStore } = await import("@/lib/settings");
  findLinkedStore(await readSettings(), key);
  const { storeScope } = await import("@/lib/paths");
  return storeScope.run({ key }, fn);
}

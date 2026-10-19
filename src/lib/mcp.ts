import { redactString } from "@/lib/redact";
import type { Settings } from "@/lib/settings";

type JsonRpc = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export async function callUmbrelTool(settings: Settings, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!settings.umbrelMcpToken) throw new Error("Add an Umbrel MCP token in Settings first");
  if (!settings.umbrelMcpUrl) throw new Error("Add the Umbrel MCP URL in Settings first");
  const endpoint = settings.umbrelMcpUrl;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${settings.umbrelMcpToken}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const init = await rpc(endpoint, headers, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "HeilSS", version: "1.0.0" },
    },
  });
  const session = init.session;
  if (session) headers["mcp-session-id"] = session;
  await rpc(endpoint, headers, { jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => undefined);
  const call = await rpc(endpoint, headers, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return unwrapTool(call.body);
}

async function rpc(
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ body: JsonRpc; session?: string }> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    throw new Error(`Could not reach Umbrel MCP: ${redactString(error instanceof Error ? error.message : "network error")}`);
  }
  const text = await response.text();
  const parsed = parseMcpBody(text);
  if (!response.ok || parsed.error) {
    const message = parsed.error?.message || `Umbrel MCP returned ${response.status}`;
    throw new Error(redactString(message));
  }
  return { body: parsed, session: response.headers.get("mcp-session-id") ?? undefined };
}

function parseMcpBody(text: string): JsonRpc {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const json = JSON.parse(trimmed) as JsonRpc | JsonRpc[];
    return Array.isArray(json) ? json[json.length - 1] : json;
  }
  const dataLines = trimmed
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
  const last = dataLines[dataLines.length - 1];
  if (!last) throw new Error("Empty response from Umbrel MCP");
  return JSON.parse(last) as JsonRpc;
}

function unwrapTool(message: JsonRpc): unknown {
  const result = message.result as { content?: { type?: string; text?: string }[]; isError?: boolean } | undefined;
  if (!result) return message;
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (result.isError) throw new Error(redactString(text || "Umbrel tool failed"));
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { dataDir } from "@/lib/paths";

const exec = promisify(execFile);
let backendPath: string | undefined;

async function gitBackend(): Promise<string> {
  if (backendPath) return backendPath;
  const { stdout } = await exec("git", ["--exec-path"]);
  backendPath = path.join(stdout.trim(), "git-http-backend");
  return backendPath;
}

function splitCgi(buffer: Buffer): { status: number; headers: Headers; body: Buffer } {
  let index = buffer.indexOf("\r\n\r\n");
  let separator = 4;
  if (index < 0) {
    index = buffer.indexOf("\n\n");
    separator = 2;
  }
  if (index < 0) throw new Error("git http-backend returned no headers");
  const headerText = buffer.subarray(0, index).toString("latin1");
  const body = buffer.subarray(index + separator);
  const headers = new Headers();
  let status = 200;
  for (const line of headerText.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (/^status$/i.test(key)) {
      status = Number(value.split(" ")[0]) || 500;
      continue;
    }
    if (/^www-authenticate$/i.test(key)) continue;
    headers.append(key, value);
  }
  return { status, headers, body };
}

export async function serveGit(request: Request, pathInfo: string): Promise<Response> {
  const backend = await gitBackend();
  const url = new URL(request.url);
  const protocol = request.headers.get("git-protocol") ?? "";
  const body = request.method === "GET" || request.method === "HEAD" ? Buffer.alloc(0) : Buffer.from(await request.arrayBuffer());
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_PROJECT_ROOT: dataDir(),
    GIT_HTTP_EXPORT_ALL: "1",
    PATH_INFO: pathInfo,
    REQUEST_METHOD: request.method,
    QUERY_STRING: url.search.startsWith("?") ? url.search.slice(1) : "",
    CONTENT_TYPE: request.headers.get("content-type") ?? "",
    CONTENT_LENGTH: String(body.length),
    GIT_PROTOCOL: protocol,
    HTTP_GIT_PROTOCOL: protocol,
  };
  delete env.AUTH_TYPE;
  const child = spawn(backend, [], { env });
  const chunks: Buffer[] = [];
  const errors: Buffer[] = [];
  const done = new Promise<number>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (body.length) child.stdin.write(body);
  child.stdin.end();
  const code = await done;
  if (code !== 0 && chunks.length === 0) {
    return Response.json({ error: "Git service failed" }, { status: 500 });
  }
  const cgi = splitCgi(Buffer.concat(chunks));
  cgi.headers.delete("www-authenticate");
  return new Response(new Uint8Array(cgi.body), { status: cgi.status, headers: cgi.headers });
}

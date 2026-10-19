const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const USERINFO = /\/\/[^/\s:@]+:[^@\s/]+@/g;
const GITHUB_TOKEN = /\b(ghp|github_pat|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+/g;
const GENERIC_SECRET = /\b(sk|rk|cf)_[A-Za-z0-9_-]{10,}\b/g;

export function redactString(input: string): string {
  return input
    .replace(BEARER, "Bearer [redacted]")
    .replace(USERINFO, "//[redacted]@")
    .replace(GITHUB_TOKEN, "[redacted]")
    .replace(GENERIC_SECRET, "[redacted]");
}

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Request failed";
  return redactString(raw);
}

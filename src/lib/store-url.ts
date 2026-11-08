/** Append ?store=<key> (linked store) to an app or API path; HeilSS's own store has no key. */
export function withStore(path: string, store: string | null | undefined): string {
  if (!store) return path;
  return `${path}${path.includes("?") ? "&" : "?"}store=${encodeURIComponent(store)}`;
}

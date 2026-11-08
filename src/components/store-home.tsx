"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { withStore } from "@/lib/store-url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Glass } from "@/components/shell";

type AppTile = {
  id: string;
  name: string;
  tagline: string;
  category: string;
  version: string;
  port: number;
  icon: string;
  iconSrc: string;
  managed: boolean;
};

type StoreOption = { key: string; label: string; url: string; writable: boolean };
type Linked = { key: string; url: string; branch: string; writable: boolean } | null;

type HistoryItem = { sha: string; date: string; subject: string };

export function StoreHome() {
  const router = useRouter();
  const store = useSearchParams().get("store") ?? "";
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [linked, setLinked] = useState<Linked>(null);
  const [query, setQuery] = useState("");
  const [apps, setApps] = useState<AppTile[] | null>(null);
  const [storeName, setStoreName] = useState("Heil");
  const [cloneUrl, setCloneUrl] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [importUrl, setImportUrl] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load(isStale: () => boolean = () => false) {
    setApps(null);
    setError("");
    fetch("/api/stores")
      .then((response) => response.json())
      .then((body) => setStores(body.stores ?? []))
      .catch(() => undefined);
    const response = await fetch(withStore("/api/apps", store));
    const body = await response.json();
    if (isStale()) return;
    if (!response.ok) throw new Error(body.error || "Could not load the store");
    setApps(body.apps);
    setStoreName(body.storeName);
    setCloneUrl(body.cloneUrl);
    setLinked(body.linked ?? null);
    const historyResponse = await fetch(withStore("/api/history", store));
    const historyBody = await historyResponse.json();
    if (isStale()) return;
    if (historyResponse.ok) setHistory(historyBody.history ?? []);
  }

  useEffect(() => {
    // Switching stores while a slow first clone loads must not show the old store's answer.
    let cancelled = false;
    load(() => cancelled).catch((reason: Error) => {
      if (cancelled) return;
      setApps([]);
      setError(reason.message);
    });
    return () => {
      cancelled = true;
    };
    // load reads `store`; it is the only input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const shown = (apps ?? []).filter((app) => !query.trim() || `${app.name} ${app.id} ${app.tagline}`.toLowerCase().includes(query.trim().toLowerCase()));

  async function copyUrl() {
    await navigator.clipboard.writeText(cloneUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function importStore() {
    setBusy(true);
    setImportMessage("");
    setError("");
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Import failed");
      setImportMessage(`Imported ${body.imported.join(", ")}${body.issues?.length ? `. Skipped: ${body.issues.join(" ")}` : ""}`);
      setImportUrl("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-white/45 uppercase">{storeName} App Store</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Apps in this store</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/60">
            {linked
              ? "A community store your Umbrel already loads. Changes here are committed and pushed to that repository; Umbrel picks them up on its next store refresh."
              : "HeilSS writes each app into its own community store and serves that git repository from this Umbrel. Add the clone URL in App Store, then Community App Stores."}
          </p>
        </div>
        {linked ? null : (
          <Button render={<Link href="/new" />} nativeButton={false} className="h-10 rounded-full px-4">
            Add an app
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(stores.length ? stores : [{ key: "", label: "HeilSS store", url: "", writable: true }]).map((option) => (
          <button
            key={option.key || "own"}
            type="button"
            onClick={() => router.push(option.key ? `/?store=${encodeURIComponent(option.key)}` : "/")}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${option.key === store ? "border-white/40 bg-white/15 text-white" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}
          >
            {option.label}
            {option.key && !option.writable ? <span className="ml-1.5 text-[10px] tracking-wide text-amber-200/80 uppercase">read-only</span> : null}
          </button>
        ))}
        <Link href="/settings#linked-stores" className="rounded-full px-3 py-1.5 text-sm text-white/50 hover:text-white">
          + Link a store
        </Link>
      </div>
      {linked && !linked.writable ? (
        <p className="rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
          Read-only: add an access token for {linked.url} in Settings → Linked stores to change icons or edit apps here.
        </p>
      ) : null}

      {error ? <p className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}

      <Glass className="p-4 sm:p-5">
        <p className="text-xs font-medium tracking-wide text-white/45 uppercase">Community store URL</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input readOnly value={cloneUrl || "Preparing the store…"} className="h-10 font-mono text-xs" />
          <Button type="button" variant="secondary" className="h-10" onClick={copyUrl} disabled={!cloneUrl}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </Glass>

      {apps && apps.length > 8 ? (
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${apps.length} apps`} className="h-10 max-w-sm" />
      ) : null}

      {apps === null ? (
        <p className="text-sm text-white/55">Loading the store…{store ? " (the first visit clones the repository)" : ""}</p>
      ) : apps.length === 0 ? (
        <Glass className="px-6 py-14 text-center">
          <p className="text-lg font-medium">No apps yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/60">
            Add one from a docker run command, a Compose file, a GitHub repository, or an image name. HeilSS will write the Umbrel manifest, app proxy, and data volume.
          </p>
          <Button render={<Link href="/new" />} nativeButton={false} className="mt-6 h-10 rounded-full px-4">
            Create the first entry
          </Button>
        </Glass>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((app) => (
            <Link
              key={app.id}
              href={withStore(`/apps/${app.id}`, store)}
              className="group rounded-[28px] border border-white/10 bg-white/[0.045] p-4 backdrop-blur-xl transition hover:border-white/20 hover:bg-white/[0.07]"
            >
              <span className="grid size-[72px] place-items-center overflow-hidden rounded-[22px] border border-white/10 bg-[#14161e] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={app.iconSrc || app.icon} alt="" className="size-full object-cover" />
              </span>
              <span className="mt-4 block truncate text-sm font-medium">{app.name}</span>
              <span className="mt-1 line-clamp-2 block min-h-10 text-xs leading-5 text-white/55">{app.tagline}</span>
              <span className="mt-3 block text-[11px] tracking-wide text-white/40 uppercase">
                {app.category} · {app.port}
              </span>
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Glass className={`p-5 ${linked ? "hidden" : ""}`}>
          <h2 className="text-base font-medium">Import a community store</h2>
          <p className="mt-1 text-sm leading-6 text-white/55">
            Paste a git URL. HeilSS copies each app, prefixes ids with this store, and commits them.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Input value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="https://github.com/org/umbrel-community-app-store" className="h-10" />
            <Button type="button" className="h-10" disabled={busy || !importUrl.trim()} onClick={importStore}>
              {busy ? "Importing…" : "Import"}
            </Button>
          </div>
          {importMessage ? <p className="mt-3 text-sm text-white/70">{importMessage}</p> : null}
        </Glass>
        <Glass className="p-5">
          <h2 className="text-base font-medium">Store history</h2>
          {history.length === 0 ? (
            <p className="mt-3 text-sm text-white/55">Commits show up here after the first app is saved.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {history.slice(0, 6).map((item) => (
                <li key={item.sha} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate text-white/80">{item.subject}</span>
                  <span className="shrink-0 font-mono text-[11px] text-white/40">{item.sha.slice(0, 7)}</span>
                </li>
              ))}
            </ul>
          )}
        </Glass>
      </div>
    </div>
  );
}

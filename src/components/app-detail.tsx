"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { withStore } from "@/lib/store-url";
import { Button } from "@/components/ui/button";
import { Glass } from "@/components/shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Detail = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  version: string;
  port: number;
  icon: string;
  iconSrc: string;
  managed: boolean;
  umbrelLogin: boolean;
  image?: string;
  manifestYaml: string;
  composeYaml: string;
  source: string;
};

type HistoryItem = { sha: string; date: string; subject: string };

export function AppDetail({ id }: { id: string }) {
  const router = useRouter();
  const store = useSearchParams().get("store") ?? "";
  const api = (path: string) => withStore(path, store);
  const [app, setApp] = useState<Detail | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [diff, setDiff] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imageUpdate, setImageUpdate] = useState<{ update: boolean; detail?: string; latestDigest?: string } | null>(null);

  async function load() {
    const response = await fetch(api(`/api/apps/${id}`));
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "App not found");
    setApp(body);
    const historyResponse = await fetch(api(`/api/apps/${id}/history`));
    const historyBody = await historyResponse.json();
    if (historyResponse.ok) setHistory(historyBody.history ?? []);
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
    // load closes over id and is recreated each render; id is the only input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function act(path: string, options: RequestInit, label: string) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const response = await fetch(api(path), options);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Request failed");
      setNotice(label === "Icon" || label === "Files" ? "" : typeof body === "object" ? JSON.stringify(body, null, 2) : String(body));
      if (label === "Delete") {
        router.push(withStore("/", store));
        return;
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed");
    } finally {
      setBusy("");
    }
  }

  if (!app && !error) return <p className="text-sm text-white/55">Loading {id}…</p>;
  if (!app) return <p className="text-sm text-rose-100">{error}</p>;

  return (
    <div className="space-y-6">
      <Glass className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-[24px] border border-white/10 bg-[#14161e]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={app.iconSrc || app.icon} alt="" className="size-full object-cover" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs tracking-[0.16em] text-white/40 uppercase">{app.category}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{app.name}</h1>
          <p className="mt-1 text-sm text-white/60">{app.tagline}</p>
          <p className="mt-3 text-xs text-white/40">
            {app.id} · port {app.port} · {app.version} · Umbrel login {app.umbrelLogin ? "on" : "off"}
          </p>
        </div>
      </Glass>

      <p className="max-w-3xl text-sm leading-6 whitespace-pre-wrap text-white/70">{app.description}</p>
      {error ? <p className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
      {notice ? <pre className="max-h-48 overflow-auto rounded-2xl bg-black/30 p-4 text-xs text-white/70">{notice}</pre> : null}

      <div className="flex flex-wrap gap-2">
        {app.managed ? (
          <Button render={<Link href={withStore(`/apps/${app.id}/edit`, store)} />} nativeButton={false} variant="secondary" className="h-10">
            Edit
          </Button>
        ) : null}
        <Button className="h-10" disabled={Boolean(busy)} onClick={() => act(`/api/apps/${app.id}/umbrel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "install" }) }, "Install")}>
          {busy === "Install" ? "Installing…" : "Install on Umbrel"}
        </Button>
        <Button variant="secondary" className="h-10" disabled={Boolean(busy)} onClick={() => act(`/api/apps/${app.id}/umbrel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status" }) }, "Status")}>
          Status
        </Button>
        <Button variant="secondary" className="h-10" disabled={Boolean(busy)} onClick={() => act(`/api/apps/${app.id}/umbrel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update" }) }, "Update")}>
          Update on Umbrel
        </Button>
        <Button variant="secondary" className="h-10" disabled={Boolean(busy)} onClick={async () => {
          setBusy("Check");
          setError("");
          try {
            const response = await fetch(api(`/api/apps/${app.id}/image`));
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || "Could not check the image");
            setImageUpdate(body);
            setNotice(body.update ? `Update available: ${body.latestDigest}` : body.detail || "Image is current, or the registry could not be checked.");
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Could not check the image");
          } finally {
            setBusy("");
          }
        }}>
          Check image
        </Button>
        {imageUpdate?.update ? (
          <Button className="h-10" disabled={Boolean(busy)} onClick={() => act(`/api/apps/${app.id}/image`, { method: "POST" }, "Pin")}>
            Apply image update
          </Button>
        ) : null}
        <Button variant="destructive" className="h-10" onClick={() => setConfirmDelete(true)}>
          Delete
        </Button>
      </div>
      <p className="text-xs leading-5 text-white/45">
        Install asks Umbrel over MCP. The store URL has to be added on the Umbrel first, and the token needs App Store access. Umbrel pulls the git store on its own schedule. There is no separate refresh tool.
      </p>

      <IconPanel
        app={app}
        busy={busy}
        onChange={(change) => act(`/api/apps/${app.id}/icon`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) }, "Icon")}
      />

      <FilesPanel
        app={app}
        busy={busy}
        onSave={(files) => act(`/api/apps/${app.id}/files`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(files) }, "Files")}
      />

      <Glass className="p-5">
        <h2 className="text-base font-medium">History</h2>
        {history.length === 0 ? <p className="mt-3 text-sm text-white/55">No commits for this app yet.</p> : (
          <ul className="mt-3 divide-y divide-white/10">
            {history.map((item) => (
              <li key={item.sha} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm">{item.subject}</p>
                  <p className="font-mono text-[11px] text-white/40">{item.sha.slice(0, 7)} · {new Date(item.date).toLocaleString()}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => act(`/api/apps/${app.id}/history?diff=${item.sha}`, {}, "Diff").then(async () => {
                    const response = await fetch(api(`/api/apps/${app.id}/history?diff=${item.sha}`));
                    const body = await response.json();
                    if (response.ok) setDiff(body.diff || "");
                  })}>
                    View diff
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => act(`/api/apps/${app.id}/history`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sha: item.sha }) }, "Restore")}>
                    Roll back
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {diff ? <pre className="mt-4 max-h-96 overflow-auto rounded-2xl bg-black/40 p-4 text-xs leading-5 text-white/75">{diff}</pre> : null}
      </Glass>

      <div className="grid gap-4 lg:grid-cols-2">
        <Glass className="p-4">
          <p className="mb-2 text-xs tracking-wide text-white/40 uppercase">umbrel-app.yml</p>
          <pre className="max-h-80 overflow-auto text-xs leading-5 text-white/75">{app.manifestYaml}</pre>
        </Glass>
        <Glass className="p-4">
          <p className="mb-2 text-xs tracking-wide text-white/40 uppercase">docker-compose.yml</p>
          <pre className="max-h-80 overflow-auto text-xs leading-5 text-white/75">{app.composeYaml}</pre>
        </Glass>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {app.name}?</DialogTitle>
            <DialogDescription>This deletes the folder from the store and commits the removal. You can roll the files back from history.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Keep it</Button>
            <Button variant="destructive" onClick={() => act(`/api/apps/${app.id}`, { method: "DELETE" }, "Delete")}>Delete entry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type IconChangeBody = { mode: "upload"; dataUrl: string } | { mode: "fetch" } | { mode: "monogram" };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

function IconPanel({ app, busy, onChange }: { app: Detail; busy: string; onChange: (change: IconChangeBody) => Promise<void> }) {
  const [pending, setPending] = useState<{ dataUrl: string; name: string } | null>(null);
  const [problem, setProblem] = useState("");
  const working = busy === "Icon";
  return (
    <Glass className="p-5">
      <h2 className="text-base font-medium">Icon</h2>
      <p className="mt-1 text-sm leading-6 text-white/55">
        Upload an SVG, PNG, WebP, GIF or JPEG (up to 1 MB, square works best). HeilSS stores it next to the manifest, points <code>icon:</code> at it and commits.
      </p>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <span className="grid size-16 place-items-center overflow-hidden rounded-[20px] border border-white/10 bg-[#14161e]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={app.iconSrc || app.icon} alt="Current icon" className="size-full object-cover" />
          </span>
          {pending ? (
            <>
              <span className="text-white/40">→</span>
              <span className="grid size-16 place-items-center overflow-hidden rounded-[20px] border border-emerald-300/40 bg-[#14161e]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pending.dataUrl} alt="New icon" className="size-full object-cover" />
              </span>
            </>
          ) : null}
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <label className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-white/15 bg-white/5 px-3 text-sm hover:bg-white/10">
            Choose image…
            <input
              type="file"
              accept="image/svg+xml,image/png,image/webp,image/gif,image/jpeg"
              className="sr-only"
              onChange={async (event) => {
                setProblem("");
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (file.size > 1024 * 1024) {
                  setProblem("That image is larger than 1 MB.");
                  return;
                }
                setPending({ dataUrl: await readAsDataUrl(file), name: file.name });
              }}
            />
          </label>
          {pending ? (
            <>
              <Button className="h-10" disabled={Boolean(busy)} onClick={() => onChange({ mode: "upload", dataUrl: pending.dataUrl }).then(() => setPending(null))}>
                {working ? "Saving…" : `Use ${pending.name}`}
              </Button>
              <Button variant="ghost" className="h-10" disabled={Boolean(busy)} onClick={() => setPending(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" className="h-10" disabled={Boolean(busy)} onClick={() => onChange({ mode: "fetch" })}>
                Fetch from repo
              </Button>
              <Button variant="secondary" className="h-10" disabled={Boolean(busy)} onClick={() => onChange({ mode: "monogram" })}>
                Draw monogram
              </Button>
            </>
          )}
        </div>
      </div>
      {problem ? <p className="mt-3 text-sm text-rose-100">{problem}</p> : null}
    </Glass>
  );
}

function FilesPanel({ app, busy, onSave }: { app: Detail; busy: string; onSave: (files: { manifestYaml: string; composeYaml: string; bump: boolean }) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [manifestYaml, setManifestYaml] = useState(app.manifestYaml);
  const [composeYaml, setComposeYaml] = useState(app.composeYaml);
  const [bump, setBump] = useState(true);
  useEffect(() => {
    setManifestYaml(app.manifestYaml);
    setComposeYaml(app.composeYaml);
  }, [app.manifestYaml, app.composeYaml]);
  if (!open) {
    return (
      <Button variant="secondary" className="h-10" onClick={() => setOpen(true)}>
        Edit files
      </Button>
    );
  }
  return (
    <Glass className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-medium">Edit files</h2>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs tracking-wide text-white/40 uppercase">umbrel-app.yml</span>
          <textarea value={manifestYaml} onChange={(event) => setManifestYaml(event.target.value)} spellCheck={false} className="h-96 w-full rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-xs leading-5 text-white/85" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs tracking-wide text-white/40 uppercase">docker-compose.yml</span>
          <textarea value={composeYaml} onChange={(event) => setComposeYaml(event.target.value)} spellCheck={false} className="h-96 w-full rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-xs leading-5 text-white/85" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-white/70">
        <input type="checkbox" checked={bump} onChange={(event) => setBump(event.target.checked)} />
        Bump the version so Umbrel offers this as an update
      </label>
      <Button className="h-10" disabled={Boolean(busy)} onClick={() => onSave({ manifestYaml, composeYaml, bump }).then(() => setOpen(false))}>
        {busy === "Files" ? "Saving…" : "Save and commit"}
      </Button>
    </Glass>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Glass } from "@/components/shell";
import { CATEGORIES } from "@/lib/parse";

type Issue = { level: "error" | "warning"; message: string };

type Initial = {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  source?: string;
  umbrelLogin?: boolean;
  tagline?: string;
  version?: string;
};

export function AppForm({ initial, mode }: { initial?: Initial; mode: "create" | "edit" }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [source, setSource] = useState(initial?.source ?? "");
  const [umbrelLogin, setUmbrelLogin] = useState(initial?.umbrelLogin !== false);
  const [autoIcon, setAutoIcon] = useState(true);
  const [iconDataUrl, setIconDataUrl] = useState("");
  const [tagline, setTagline] = useState(initial?.tagline ?? "");
  const [version, setVersion] = useState(initial?.version ?? "");
  const [port, setPort] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [preview, setPreview] = useState<{ id: string; manifestYaml: string; composeYaml: string; detected: string } | null>(null);

  async function readIcon(file: File) {
    const data = await file.arrayBuffer();
    const bytes = new Uint8Array(data);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    setIconDataUrl(`data:${file.type || "image/png"};base64,${btoa(binary)}`);
    setAutoIcon(false);
  }

  function payload(previewOnly: boolean) {
    return {
      preview: previewOnly,
      name,
      description,
      category: category || undefined,
      source,
      umbrelLogin,
      autoIcon,
      iconDataUrl: iconDataUrl || undefined,
      tagline: tagline || undefined,
      version: version || undefined,
      port: port ? Number(port) : undefined,
    };
  }

  async function submit(previewOnly: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(mode === "edit" && !previewOnly ? `/api/apps/${initial?.id}` : "/api/apps", {
        method: mode === "edit" && !previewOnly ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(previewOnly)),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not build the entry");
      setIssues(body.issues ?? []);
      setPreview({ id: body.id, manifestYaml: body.manifestYaml, composeYaml: body.composeYaml, detected: body.detected });
      if (!previewOnly && (body.issues ?? []).every((issue: Issue) => issue.level !== "error")) {
        router.push(`/apps/${body.id}`);
        router.refresh();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not build the entry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{mode === "edit" ? "Edit entry" : "Add an app"}</h1>
        <p className="mt-2 text-sm leading-6 text-white/60">
          Name it, drop an icon if you have one, and paste one source. HeilSS turns that into an Umbrel app folder and commits it to the store.
        </p>
      </div>
      <Glass className="space-y-5 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="App name">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nginx" className="h-10" />
          </Field>
          <Field label="Category">
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-10 w-full rounded-lg border border-white/15 bg-white/5 px-2.5 text-sm"
            >
              <option value="">Choose from the paste</option>
              {CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional. Leave blank to fill this from the image or repository." className="min-h-24" />
        </Field>
        <Field label="Icon">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input type="file" accept="image/svg+xml,image/png,image/webp,image/gif" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readIcon(file);
            }} className="h-10" />
            <label className="flex items-center gap-2 text-sm text-white/70">
              <Switch checked={autoIcon} onCheckedChange={(checked) => setAutoIcon(Boolean(checked))} />
              Fetch or draw one
            </label>
          </div>
        </Field>
        <Field label="Docker Compose, docker run, GitHub URL, or image">
          <Textarea
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder={"docker run nginx"}
            className="min-h-40 font-mono text-[13px]"
          />
        </Field>
        <label className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <span>
            <span className="block text-sm font-medium">Umbrel login</span>
            <span className="block text-xs text-white/50">On uses app_proxy auth. Off sets PROXY_AUTH_ADD to false for this app only.</span>
          </span>
          <Switch checked={umbrelLogin} onCheckedChange={(checked) => setUmbrelLogin(Boolean(checked))} />
        </label>
        <details className="rounded-2xl border border-white/10 px-4 py-3 text-sm">
          <summary className="cursor-pointer text-white/80">Optional listing details</summary>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Tagline">
              <Input value={tagline} onChange={(event) => setTagline(event.target.value)} className="h-10" />
            </Field>
            <Field label="Version">
              <Input value={version} onChange={(event) => setVersion(event.target.value)} className="h-10" />
            </Field>
            <Field label="Host port">
              <Input value={port} onChange={(event) => setPort(event.target.value)} placeholder="Auto" className="h-10" />
            </Field>
          </div>
        </details>
        {error ? <p className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
        {issues.length ? (
          <ul className="space-y-2">
            {issues.map((issue) => (
              <li key={issue.message} className={`rounded-2xl px-4 py-2 text-sm ${issue.level === "error" ? "bg-rose-400/10 text-rose-100" : "bg-amber-300/10 text-amber-100"}`}>
                {issue.message}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="secondary" className="h-10" disabled={busy || !source.trim()} onClick={() => submit(true)}>
            {busy ? "Checking…" : "Preview"}
          </Button>
          <Button type="button" className="h-10" disabled={busy || !source.trim()} onClick={() => submit(false)}>
            {busy ? "Saving…" : mode === "edit" ? "Save changes" : "Save to the store"}
          </Button>
        </div>
      </Glass>
      {preview ? (
        <Glass className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-medium">{preview.id}</h2>
            <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/70">{preview.detected}</span>
          </div>
          <Yaml title="umbrel-app.yml" value={preview.manifestYaml} />
          <Yaml title="docker-compose.yml" value={preview.composeYaml} />
        </Glass>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block space-y-1.5">
      <Label className="text-white/70">{label}</Label>
      {children}
    </div>
  );
}

function Yaml({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <p className="mb-2 text-xs tracking-wide text-white/45 uppercase">{title}</p>
      <pre className="max-h-80 overflow-auto rounded-2xl bg-black/40 p-4 text-xs leading-5 text-white/80">{value}</pre>
    </div>
  );
}

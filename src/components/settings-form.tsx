"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Glass } from "@/components/shell";

type PublicSettings = {
  storeId: string;
  storeName: string;
  submitter: string;
  publicBaseUrl: string;
  umbrelMcpUrl: string;
  github: { enabled: boolean; repo: string; branch: string };
  drive: { enabled: boolean; folderId: string; fileName: string };
  domain: {
    enabled: boolean;
    zoneName: string;
    recordName: string;
    recordType: "A" | "CNAME";
    target: string;
    proxied: boolean;
    caddyUpstream: string;
  };
  secrets: {
    umbrelMcpToken: boolean;
    githubToken: boolean;
    driveAccessToken: boolean;
    cloudflareToken: boolean;
  };
};

export function SettingsForm() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [tokens, setTokens] = useState({ umbrel: "", github: "", drive: "", cloudflare: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((response) => response.json())
      .then((body) => setSettings(body.settings))
      .catch(() => setError("Could not load settings"));
  }, []);

  if (!settings) return <p className="text-sm text-white/55">{error || "Loading settings…"}</p>;

  function update<K extends keyof PublicSettings>(key: K, value: PublicSettings[K]) {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  }

  async function save() {
    if (!settings) return;
    const current = settings;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...current,
          umbrelMcpToken: tokens.umbrel,
          github: { ...current.github, token: tokens.github },
          drive: { ...current.drive, accessToken: tokens.drive },
          domain: { ...current.domain, cloudflareToken: tokens.cloudflare },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save settings");
      setSettings(body.settings);
      setTokens({ umbrel: "", github: "", drive: "", cloudflare: "" });
      setMessage("Saved. Tokens stay in this app's data directory and are not shown again.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save settings");
    } finally {
      setBusy(false);
    }
  }

  async function backup(target: "github" | "drive") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Backup failed");
      setMessage(target === "github" ? "Pushed the store to GitHub." : "Uploaded a git bundle to Google Drive.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Backup failed");
    } finally {
      setBusy(false);
    }
  }

  async function domain() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/domain", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Domain setup failed");
      setMessage(`DNS record ${body.name} is in place. Caddyfile written on the data volume. HeilSS does not start Caddy.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Domain setup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm leading-6 text-white/60">
          The store id becomes the prefix on every app. Secrets are written to the data volume only. Empty token fields keep the saved value.
        </p>
      </div>
      {error ? <p className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
      {message ? <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80">{message}</p> : null}

      <Glass className="space-y-4 p-5">
        <h2 className="text-base font-medium">Store</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Store id">
            <Input value={settings.storeId} onChange={(event) => update("storeId", event.target.value)} className="h-10" />
          </Field>
          <Field label="Store name">
            <Input value={settings.storeName} onChange={(event) => update("storeName", event.target.value)} className="h-10" />
          </Field>
          <Field label="Submitter">
            <Input value={settings.submitter} onChange={(event) => update("submitter", event.target.value)} className="h-10" />
          </Field>
          <Field label="Public base URL">
            <Input value={settings.publicBaseUrl} onChange={(event) => update("publicBaseUrl", event.target.value)} placeholder="http://umbrel.local:8480" className="h-10" />
          </Field>
        </div>
      </Glass>

      <Glass className="space-y-4 p-5">
        <h2 className="text-base font-medium">Umbrel MCP</h2>
        <p className="text-sm text-white/55">Settings → AI agents (MCP) on umbrelOS. The token needs App Store access for install.</p>
        <Field label="Endpoint">
          <Input value={settings.umbrelMcpUrl} onChange={(event) => update("umbrelMcpUrl", event.target.value)} className="h-10" />
        </Field>
        <Field label={settings.secrets.umbrelMcpToken ? "Token saved. Paste a new one to replace it." : "Bearer token"}>
          <Input type="password" value={tokens.umbrel} onChange={(event) => setTokens({ ...tokens, umbrel: event.target.value })} autoComplete="off" className="h-10" />
        </Field>
      </Glass>

      <Glass className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">GitHub mirror</h2>
          <Switch checked={settings.github.enabled} onCheckedChange={(checked) => update("github", { ...settings.github, enabled: Boolean(checked) })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="owner/repo">
            <Input value={settings.github.repo} onChange={(event) => update("github", { ...settings.github, repo: event.target.value })} className="h-10" />
          </Field>
          <Field label="Branch">
            <Input value={settings.github.branch} onChange={(event) => update("github", { ...settings.github, branch: event.target.value })} className="h-10" />
          </Field>
        </div>
        <Field label={settings.secrets.githubToken ? "Token saved" : "GitHub token"}>
          <Input type="password" value={tokens.github} onChange={(event) => setTokens({ ...tokens, github: event.target.value })} autoComplete="off" className="h-10" />
        </Field>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => backup("github")}>Push now</Button>
      </Glass>

      <Glass className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">Google Drive backup</h2>
          <Switch checked={settings.drive.enabled} onCheckedChange={(checked) => update("drive", { ...settings.drive, enabled: Boolean(checked) })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Folder id">
            <Input value={settings.drive.folderId} onChange={(event) => update("drive", { ...settings.drive, folderId: event.target.value })} className="h-10" />
          </Field>
          <Field label="File name">
            <Input value={settings.drive.fileName} onChange={(event) => update("drive", { ...settings.drive, fileName: event.target.value })} className="h-10" />
          </Field>
        </div>
        <Field label={settings.secrets.driveAccessToken ? "Access token saved" : "OAuth access token"}>
          <Input type="password" value={tokens.drive} onChange={(event) => setTokens({ ...tokens, drive: event.target.value })} autoComplete="off" className="h-10" />
        </Field>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => backup("drive")}>Back up now</Button>
      </Glass>

      <Glass className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-medium">Domain setup</h2>
            <p className="text-sm text-white/50">Off by default. Creates a Cloudflare DNS record and writes a Caddyfile. It does not start a proxy.</p>
          </div>
          <Switch checked={settings.domain.enabled} onCheckedChange={(checked) => update("domain", { ...settings.domain, enabled: Boolean(checked) })} />
        </div>
        {settings.domain.enabled ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Zone">
              <Input value={settings.domain.zoneName} onChange={(event) => update("domain", { ...settings.domain, zoneName: event.target.value })} placeholder="example.com" className="h-10" />
            </Field>
            <Field label="Record name">
              <Input value={settings.domain.recordName} onChange={(event) => update("domain", { ...settings.domain, recordName: event.target.value })} placeholder="apps" className="h-10" />
            </Field>
            <Field label="Type">
              <select value={settings.domain.recordType} onChange={(event) => update("domain", { ...settings.domain, recordType: event.target.value as "A" | "CNAME" })} className="h-10 w-full rounded-lg border border-white/15 bg-white/5 px-2.5 text-sm">
                <option value="A">A</option>
                <option value="CNAME">CNAME</option>
              </select>
            </Field>
            <Field label="Target">
              <Input value={settings.domain.target} onChange={(event) => update("domain", { ...settings.domain, target: event.target.value })} className="h-10" />
            </Field>
            <Field label="Caddy upstream">
              <Input value={settings.domain.caddyUpstream} onChange={(event) => update("domain", { ...settings.domain, caddyUpstream: event.target.value })} className="h-10" />
            </Field>
            <Field label={settings.secrets.cloudflareToken ? "Cloudflare token saved" : "Cloudflare token"}>
              <Input type="password" value={tokens.cloudflare} onChange={(event) => setTokens({ ...tokens, cloudflare: event.target.value })} autoComplete="off" className="h-10" />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Switch checked={settings.domain.proxied} onCheckedChange={(checked) => update("domain", { ...settings.domain, proxied: Boolean(checked) })} />
              Proxy through Cloudflare
            </label>
            <Button type="button" variant="secondary" disabled={busy} onClick={domain}>Apply DNS</Button>
          </div>
        ) : null}
      </Glass>

      <Button type="button" className="h-10" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save settings"}</Button>
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

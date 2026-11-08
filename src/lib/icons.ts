import { createHash } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LinkedStore } from "@/lib/settings";

/** Icon file types HeilSS stores next to an app's manifest (icon.<ext>). */
export const ICON_TYPES = {
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  jpg: "image/jpeg",
} as const;
export type IconExt = keyof typeof ICON_TYPES;
export type IconData = { ext: IconExt; data: Buffer };

export const MAX_ICON_BYTES = 1024 * 1024;
const ICON_FILE = /^icon\.(svg|png|webp|gif|jpg|jpeg)$/i;

function sniff(data: Buffer): IconExt | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  if (data.length >= 6 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString("latin1"))) return "gif";
  if (data.length >= 12 && data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  const head = data.subarray(0, 2048).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "svg";
  return null;
}

/** Decode a browser upload (data: URL). The bytes decide the type, not the claimed MIME. */
export function decodeIconUpload(dataUrl: string): IconData {
  const match = dataUrl.match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/);
  if (!match) throw new Error("The icon upload was not readable. Choose an SVG, PNG, WebP, GIF or JPEG file.");
  const data = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8");
  if (data.length === 0) throw new Error("The icon file is empty.");
  if (data.length > MAX_ICON_BYTES) throw new Error("The icon is larger than 1 MB. Use a smaller image (512×512 is plenty).");
  const ext = sniff(data);
  if (!ext) throw new Error("That file is not an SVG, PNG, WebP, GIF or JPEG image.");
  return { ext, data };
}

export function iconHash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 10);
}

export function dataUrlFor(icon: IconData): string {
  return `data:${ICON_TYPES[icon.ext]};base64,${icon.data.toString("base64")}`;
}

/** The icon file in an app folder, if there is one (svg preferred, then png, webp, gif, jpg). */
export async function findIconFile(dir: string): Promise<(IconData & { name: string }) | null> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const icons = names.filter((name) => ICON_FILE.test(name));
  const order: string[] = ["svg", "png", "webp", "gif", "jpg", "jpeg"];
  icons.sort((a, b) => order.indexOf(a.split(".")[1].toLowerCase()) - order.indexOf(b.split(".")[1].toLowerCase()));
  for (const name of icons) {
    const data = await readFile(path.join(dir, name)).catch(() => null);
    if (!data) continue;
    const ext = sniff(data);
    if (ext) return { name, ext, data };
  }
  return null;
}

/** Write icon.<ext> and remove any other icon.* so the folder has exactly one icon. */
export async function writeIconFile(dir: string, icon: IconData): Promise<string> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const name = `icon.${icon.ext}`;
  for (const other of names) {
    if (ICON_FILE.test(other) && other !== name) await rm(path.join(dir, other), { force: true });
  }
  await writeFile(path.join(dir, name), icon.data);
  return name;
}

/**
 * A browser-reachable URL for a file in a linked store's repository, so Umbrel's App Store can show it.
 * GitHub: raw.githubusercontent.com. Gitea/Forgejo: <repo>/raw/branch/<branch>/<path>.
 */
export function rawFileUrl(store: LinkedStore, filePath: string): string {
  const repo = store.url.replace(/\.git$/, "").replace(/\/+$/, "");
  const github = repo.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  if (github) return `https://raw.githubusercontent.com/${github[1]}/${github[2]}/${encodeURIComponent(store.branch)}/${encoded}`;
  return `${repo}/raw/branch/${encodeURIComponent(store.branch)}/${encoded}`;
}

/** What goes in umbrel-app.yml `icon:` for an icon file stored next to the manifest. */
export function manifestIconUrl(args: { id: string; icon: IconData; linked: LinkedStore | null; publicBaseUrl: string }): string {
  const { id, icon, linked, publicBaseUrl } = args;
  const version = `v=${iconHash(icon.data)}`;
  if (linked) return `${rawFileUrl(linked, `${id}/icon.${icon.ext}`)}?${version}`;
  if (publicBaseUrl) return `${publicBaseUrl.replace(/\/$/, "")}/media/apps/${id}/icon.${icon.ext}?${version}`;
  // No public address: embed it, so Umbrel can still show it without reaching HeilSS.
  return dataUrlFor(icon);
}

export function monogramSvg(name: string): string {
  const initials =
    name
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "A";
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="56" fill="#14161e"/>
  <rect x="18" y="18" width="220" height="220" rx="46" fill="hsl(${hue} 28% 18%)"/>
  <text x="128" y="148" text-anchor="middle" font-family="Inter, ui-sans-serif, sans-serif" font-size="92" font-weight="650" fill="#f4f4f5">${initials}</text>
</svg>
`;
}

export function monogramIcon(name: string): IconData {
  return { ext: "svg", data: Buffer.from(monogramSvg(name), "utf8") };
}

/** Look for a logo in a GitHub repository (SVG first, then PNG). */
export async function fetchRepoIcon(repoUrl: string): Promise<IconData | null> {
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?]|$)/i);
  if (!m) return null;
  const [owner, repo] = [m[1], m[2]];
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "HeilSS" };
  let branch = "main";
  try {
    const meta = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers, signal: AbortSignal.timeout(8000) });
    if (meta.ok) branch = ((await meta.json()) as { default_branch?: string }).default_branch || branch;
  } catch {
    // fall back to main
  }
  const candidates = [
    "icon.svg", "logo.svg", "public/logo.svg", "public/icon.svg", "docs/logo.svg", "assets/logo.svg",
    "icon.png", "logo.png", "public/logo.png", "assets/logo.png", "docs/logo.png", ".github/logo.png",
  ];
  for (const file of candidates) {
    try {
      const response = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file}`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) continue;
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length === 0 || data.length > MAX_ICON_BYTES) continue;
      const ext = sniff(data);
      if (ext) return { ext, data };
    } catch {
      continue;
    }
  }
  return null;
}

/** Same sniffing the upload path uses, for files already in a store. */
export function iconExtOf(data: Buffer): IconExt | null {
  return sniff(data);
}

/** Headers for serving a stored icon. Uploaded SVGs come from this origin: no scripts, no outside loads. */
export function iconHeaders(type: string): HeadersInit {
  return {
    "Content-Type": type,
    "Cache-Control": "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
    // Uploaded SVGs are served from this origin: no scripts, no outside loads.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
  };
}

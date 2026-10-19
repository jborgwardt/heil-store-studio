# HeilSS

Heil Store Studio builds and manages an [umbrelOS](https://umbrel.com) community app store. It is itself an Umbrel app: this repository is the bootstrap store that contains HeilSS, and the running app writes a second store for the apps you add.

HeilSS is not one of the apps in the store it manages. You install HeilSS from the bootstrap store, then use it to add, edit, and remove other apps.

The generated store follows [getumbrel/umbrel-community-app-store](https://github.com/getumbrel/umbrel-community-app-store):

- `umbrel-app-store.yml` with an `id` of lowercase `a-z` and dashes, and a display `name`
- one folder per app, named exactly as the app `id`
- every app id prefixed with the store id (`heil-nginx` when the store id is `heil`)
- `umbrel-app.yml` plus `docker-compose.yml`
- an `app_proxy` service whose `APP_HOST` is `<app-id>_<service>_1` and whose `APP_PORT` is the container listen port
- the manifest `port` is the separate host port Umbrel opens in the browser
- persistent data bind-mounted from `${APP_DATA_DIR}`
- `storage.dataRoot: data` so umbrelOS 2.0 can relocate app data

Manifest fields match the current `AppManifestSchema` in umbrelOS and the packaging rules in [getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps). Community listings set `icon`, because otherwise umbrelOS points at the official gallery and the icon is missing.

There is no HTTP basic auth. HeilSS never sends `WWW-Authenticate`. When it is installed on Umbrel, umbrelOS `app_proxy` is the login gate.

## Run it here

```bash
npm install
npm run dev
```

Open http://127.0.0.1:43127. The dev store is written to `./data`.

```bash
npm test
npm run build
npm run test:e2e
```

The end-to-end test starts the production server, creates an entry from `docker run nginx`, clones the store the same way umbrelOS does (`isomorphic-git`, depth 1), and checks the Umbrel layout.

## 1. Build and publish the image

The Umbrel package does not build the image on device. Publish a multi-arch image first, then point the package at it.

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/YOUR_USER/heilss:1.0.0 \
  --push .
```

Replace `ghcr.io/YOUR_USER/heilss:1.0.0` with the registry you actually push to. A local-only tag works for a machine that already has the image loaded:

```bash
docker build -t heilss:1.0.0 .
```

Then edit `heilss-heilss/docker-compose.yml` so `image:` is the reference Umbrel can pull. Umbrel needs `linux/amd64` and `linux/arm64` for the official packaging rules. Pin a digest when you have one:

```yaml
image: ghcr.io/YOUR_USER/heilss:1.0.0@sha256:…
```

The container listens on 8480 and stores the managed store, settings, and tokens in `/data`.

## 2. Host the bootstrap store

The root of this repository is the bootstrap community store:

- `umbrel-app-store.yml` — store id `heilss`, name `HeilSS`
- `heilss-heilss/` — the HeilSS app (`id: heilss-heilss`)

Push the repository somewhere Umbrel can clone. A GitHub URL is the usual choice:

```bash
git remote add origin https://github.com/YOUR_USER/heilss.git
git push -u origin main
```

Umbrel clones with smart HTTP, the same protocol HeilSS serves for the store it manages. Any git host that allows an anonymous `git clone` of that URL will work. Do not put a username or token in the URL you paste into Umbrel.

Commit the image reference from step 1 before you push. Umbrel installs whatever `image:` is in the clone.

## 3. Add the store in Umbrel and install HeilSS

On umbrelOS 1.7.4 or later, turn on the beta program under Settings → Advanced settings if you want umbrelOS 2.0. Then:

1. Open the App Store from the dock.
2. Open the menu in the top corner and choose Community App Stores.
3. Paste the bootstrap repository URL and add it.
4. Open the HeilSS store and install HeilSS.

Umbrel shows the animated lightning icon from the manifest. `icon.png` next to it is the static fallback. The app opens through `app_proxy` on port 8480. Its data lives in the Umbrel app data directory.

After HeilSS is open, the store it manages is a different git repository, served at:

```text
http://umbrel.local:8480/git/store.git
```

Use the URL shown in the app if your hostname or port differs. Add that URL as a second community store. Its default id is `heil` (name Heil), so it does not collide with the bootstrap store id `heilss`.

## What you can do in the app

- Paste a Compose file, a `docker run` command, a GitHub repository URL, or an image name.
- Preview the generated `umbrel-app.yml` and `docker-compose.yml`, then save. HeilSS commits the folder into the store.
- Upload an icon, or let HeilSS fetch one from the repository or draw a monogram.
- Turn Umbrel login off per app. Off writes `PROXY_AUTH_ADD: "false"` on `app_proxy`. On leaves Umbrel's default login in place.
- See port clashes, a missing registry image, and manifest problems before the commit. A registry timeout is a warning. A real "image not found" blocks the save.
- Edit, delete, read a diff, and roll an entry back to an older commit.
- Import apps from another community store git URL. Ids are prefixed with this store's id.
- Check whether a tracked image tag moved, then apply the new digest and bump the manifest version so Umbrel can offer an update.
- Optionally mirror the store to GitHub, upload a git bundle to Google Drive, or create a Cloudflare DNS record and a Caddyfile. Domain setup is off until you enable it, and HeilSS does not start Caddy.

Install, update, uninstall, list, and status call Umbrel's MCP server (`install_app`, `update_app`, `uninstall_app`, `list_apps`, `get_app_status`) with the bearer token from Settings → AI agents (MCP). The token needs App Store access. Umbrel has to be able to see the app in a community store it has already added. The current Umbrel MCP tools do not include a "refresh this community store" call, so if install says the app is missing, open Community App Stores so Umbrel clones again.

Tokens stay in `settings.json` on the data volume, mode `0600`. They are not returned to the browser and they are redacted if a request fails.

## Layout

```text
umbrel-app-store.yml     bootstrap store metadata (id heilss)
heilss-heilss/           HeilSS Umbrel package
  umbrel-app.yml
  docker-compose.yml
  icon.svg               animated lightning bolt
  icon.png               static fallback
Dockerfile
src/                     Next.js app
tests/unit               parser, manifest, and git store
tests/e2e                boots the server and clones the nginx entry
```

The managed store, created on first launch under the data directory, is separate from `heilss-heilss/`.

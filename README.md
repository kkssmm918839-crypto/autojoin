# VC Follow — Revenge Next (experimental)

Rebuilt from the [official Revenge Next plugin development guide](https://revenge.palmdevs.me/docs/plugin-development/getting-started/your-first-plugin/).

## What it does

- `/vcf @user` — start following a friend (experimental undocumented Discord slash-command hook).
- `/vcunf` — stop following (experimental).
- `Follow VC` / `Unfollow VC` in a user's profile **when a compatible Discord user-profile action list exists** (experimental).
- **Reliable fallback:** open this plugin's **Settings**, paste the friend's user ID, and tap **Follow VC** or **Unfollow VC**.
- Automatically move when the selected user changes voice channels **in the same server while you are already in a VC**, provided you can access the destination. No confirmation pop-up.
- Does **not** chase users into other servers, monitor disconnected/offline users, disconnect automatically, read messages, or send network requests.

**Compatibility warning:** Discord internal modules can change. The plugin's public Revenge lifecycle, settings storage, Flux subscription, and module finder interfaces follow the documentation, but the voice switch action, slash commands, and profile action list are Discord internals and **have not been tested on `1b1d297-main`**. Passing static/mock tests is not real-device validation.

## Install via Revenge's plugin source URL (suits your build)

A GitHub ZIP URL (especially `/blob/main/...zip`) is **not** a plugin source URL. Modern Revenge repositories need an HTTPS-hosted static `index.json` and a real ZIP download URL; your screenshot may show a legacy-style direct-source installer that fetches `manifest.json` at the base URL. This template publishes both formats.

1. On GitHub, create a new **public** repository (example name: `vc-follow-revenge`). Upload the files in this source project, including the hidden `.github/workflows/deploy-pages.yml` workflow.
2. In the repository, open **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push/commit to the `main` branch. The `Publish Revenge repository` workflow packages the plugin and publishes the repository index and ZIP automatically.
4. Once the GitHub Pages deployment succeeds, your source URL will look like `https://YOUR_USERNAME.github.io/vc-follow-revenge/index.json`. Replace `YOUR_USERNAME` and the repository name with yours.
5. Your screenshots show **Plugins → + → Install a plugin → Source URL**. First try the site base URL `https://YOUR_USERNAME.github.io/vc-follow-revenge/`, which serves `manifest.json` and `index.js` for direct-source clients. If your Revenge version asks for a **repository index** instead, use `https://YOUR_USERNAME.github.io/vc-follow-revenge/index.json`. The published site contains both formats; which one works depends on your app's installer.
6. Find **VC Follow**, install, and enable. Open its **Settings** for the fallback UI.

Do **not** paste example URLs before you've deployed. No public URL is created by downloading this source ZIP alone.

## Alternative: install ZIP (only if your build exposes file installation)

`dist/dev.community.vc-follow@0.2.0.zip` contains exactly `manifest.json` and the evaluated `index.js` expression at ZIP root. If your Revenge build offers **Install from file**, select it. Your screenshots did not show this option, so GitHub Pages is the recommended route for your build.

## Source/build

- `plugins/vc-follow/manifest.json` — required `format: 1` manifest.
- `plugins/vc-follow/js/index.js` — source entry point with `export default plugin({...})`.
- `tools/package.py` — standalone packer: produces expression-format JavaScript and ZIP for this dependency-free JS source. It is intentionally scoped to this one no-import source and is **not** a replacement for the official CLI for arbitrary plugins.
- `tools/generate_index.py` — creates repository `index.json`, ZIP pool and SHA-256.
- `.github/workflows/deploy-pages.yml` — publishes the hosted repository via GitHub Pages.
- `tests/run.cjs` — mock-based functionality tests (no Discord device access).

Use the [official Revenge plugin template and CLI](https://revenge.palmdevs.me/docs/plugin-development/getting-started/the-plugin-template/) when extending this into a normal TypeScript project or importing other modules.

### Run locally

```sh
python3 tools/package.py
node tests/run.cjs
python3 tools/generate_index.py --base-url https://YOUR_USERNAME.github.io/vc-follow-revenge/
```

`index.json` is only usable after publishing the files to the HTTPS URL that it declares.

## Troubleshooting

- `Failed to fetch manifest`: The link isn't a reachable hosted Revenge source, or GitHub Pages hasn't deployed successfully.
- Plugin installs but doesn't move: Open VC Follow Settings and see its Status field. The internal `selectVoiceChannel` module may not be present on this Discord build, the destination may be inaccessible, or you might not be in a VC in the same server.
- Commands/profile button don't appear: they are optional internal API integration, not supported by Revenge's documented stable plugin API. Use Settings.
- Plugin disabled by default: enable it after installation as described in the official guide.

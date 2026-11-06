# Development

For product setup, see [Getting started](getting-started.md). For runtime flows, see [Architecture](architecture.md). These guides follow [the repository source](README.md#about-these-docs).

## Setup

CI and release builds use **Node 26**. Use the lockfile and a compatible native build environment:

```sh
npm ci
npm run dev            # normally http://localhost:3000
npm run desktop:dev    # Next dev + Electron on localhost:3000
```

No key is needed to open the UI. Configure connections and the Strong/Cheap/Vision slots before model-driven use; there are no factory model selections. OpenRouter is supported, not mandatory.

```sh
npm run build          # Next production build, including standalone output
npm start              # serve the production build with Next
```

`npm run desktop:dist` is the local **signed macOS** packaging path, not a portable unsigned shortcut. Prerequisites and Windows/Linux instructions are in [Desktop builds and releases](desktop-release.md).

## Configuration

Nonsecret settings are deltas in `<data root>/settings.json`; absent values resolve through `src/core/settings.ts` and `settings-resolution.ts`. Models and role overrides are settings, not environment variables. [Prompt overrides](../src/agent/prompts/README.md) live under `<data root>/prompts/` and require explicit enable switches.

| Variable | Purpose |
| --- | --- |
| `LH_DATA_DIR` | Mutable chats/jobs/graph/settings/prompts; default repo `data/`. |
| `LH_AUTH_FILE` | Keys/custom-endpoint binding; default repo-root `auth.json`, outside `data/`. |
| Provider API-key variables | Optional, selected-provider dependent; UI names are in `src/core/auth-keys.ts`. |
| `TAVILY_API_KEY`, `BRAVE_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `OLLAMA_API_KEY` | Optional search adapters. Without a Settings pin, the first keyed engine wins: Tavily → Brave → Exa → Firecrawl → Ollama. A pinned engine requires its own key; no silent fallback. Ollama search is hosted at ollama.com, not a local model server. Page fetching is independent; research can fetch known URLs without a search key. |
| `DEEPGRAM_API_KEY` | Optional dictation token minting. |
| `CHROME_PATH` | Chrome/Chromium executable fallback for demo verification; Electron's browser helper is primary. No extra Chromium is downloaded. |

Ordinary Next development can read `.env.local`. Real environment keys take precedence over saved keys. Saved auth is restrictive-permission plaintext, not an encrypted vault. Packaged Electron sets separate data/auth locations under `userData`; it does not use the repo development profile.

Provider-specific setup and limitations: [Claude Code](claude-code.md), [custom endpoints](custom-providers.md), [context/cost accounting](compaction-accounting.md).

### Subscription connections in web/dev

`npm run dev` and `npm start` support ChatGPT, GitHub Copilot, and Grok sign-in. `desktop:dev` uses those same dev-server connections; packaged desktop has a separate main-process credential owner/private transport. Subscription routes do not fall back to API-key billing.

Web/dev writes `chatgpt-credentials.json`, `github-copilot-credentials.json`, and `xai-credentials.json` **beside `LH_AUTH_FILE`**, in the repo by default—not under `data/` or a global Pi profile. Git/build exclusions cover these files and their write temporaries. Refresh serialization is process-local: use one server per credential directory.

ChatGPT's callback listener is `127.0.0.1` on the **server's machine**; complete sign-in in a browser there. Copilot/Grok use device codes. Allow the initiating browser's sign-in tab if blocked; Electron dev opens provider pages in the system browser. Connected browsers share server credentials, background-use consent, keys, and learning data.

This is **trusted local/shared development**, not multi-user hosting. Same-origin JSON/custom-header checks and short-lived, origin-bound, one-use browser-opening actions are not user authentication or DNS-rebinding protection. Do not expose the server to untrusted users/public Internet without an independent access/host gate. Per-user isolation, remote ChatGPT callback routing, and credential import are not implemented.

## Single-workspace Docker hosting on Coolify

The root `Dockerfile` runs the existing application unchanged: **one shared workspace**, not separate user accounts. Use a browser on your computer and phone to access `website`. The upstream desktop app remains a separate local installation; it does not automatically connect or sync to this server.

### Container and persistent storage

In Coolify, select the **Dockerfile** build pack, repository-root build context, and container port **3000**. Run **one replica**; the file stores, background-job registries, and token refresh coordination assume one server process.

Mount a persistent volume at **`/var/lib/learnharness`**. The image runs as UID/GID **1000:1000**; a bind-mounted directory must be writable by that user. The image already sets:

| Variable | Container value |
|---|---|
| `LH_DATA_DIR` | `/var/lib/learnharness/data` — chats, graph, jobs, settings |
| `LH_AUTH_FILE` | `/var/lib/learnharness/auth/auth.json` — saved provider keys |
| `CHROME_PATH` | `/usr/bin/chromium` — demo verification |
| `HOSTNAME` / `PORT` | `0.0.0.0` / `3000` |

Subscription credential files live beside `auth.json`, so the same volume preserves them. The image includes Chromium and the platform-native PDF/SVG dependencies. Provider keys can be entered in Settings; environment variables still override saved values as in the upstream application. Never supply real keys as build arguments or copy `.env` files into the image.

For a local Docker smoke:

```sh
docker build -t learnharness:local .
docker volume create learnharness-state
docker run --name learnharness --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v learnharness-state:/var/lib/learnharness \
  learnharness:local
```

This publishes only to the host's loopback address. In Coolify, use its persistent-storage configuration rather than creating a second volume manually. Rebuild/redeploy without deleting that volume.

### Cloudflare Access is the authentication boundary

There is **no application login or per-user isolation** in this setup. Everyone admitted through the gateway can use the same conversations, graph, keys, and subscriptions. Restrict access to yourself or explicitly trusted people.

Recommended deployment:

1. Run Cloudflare Tunnel on a private network that can reach the application container.
3. Create a Cloudflare Access self-hosted application covering the **entire hostname**, including `/api/*`, and allow only your intended email identities.
4. Do not publish the application port or leave an alternate public Coolify/Traefik route. Coolify's dashboard login does **not** protect deployed applications.
5. Preserve the external `Host` and `X-Forwarded-Proto: https` headers. Allow streaming responses; do not add a “Cache Everything” rule for the application.

The app does not validate Access JWTs itself in this minimal setup. An unprotected origin bypasses the gateway. Keep the container isolated from sensitive host mounts and services; the existing agent tools are intended for a trusted personal workspace.

### Copy local data; never move or delete it

Stop writes in the old local application, then make a separate backup of its data **and** credentials. Keep that backup off the hosted server as well. Work from a copy, never by mounting the original local directory into the container.

Create a new staging directory on the server with this layout:

```text
learnharness-state/
  data/    copied contents of the old learning-data directory
  auth/    optional copied auth.json; subscription setup is separate below
```

With the hosted application stopped, copy the staged contents into an **empty** persistent volume. Do not merge over an already populated workspace. Set ownership to UID/GID 1000, restrict the `auth/` directory to mode 0700 and credential files to 0600, and compare file counts/checksums with the staging copy before starting the app. Confirm that the original local directory and your backup remain unchanged.

Keep the local originals after cutover. Future hosted edits do not synchronize back to them. For ongoing backups, stop the application or use a consistent volume snapshot, back up **both `data/` and `auth/`**, encrypt the backup, store it off-server, and periodically test a restore into a separate volume. Never use `docker compose down -v` or delete the Coolify volume unless you intend to delete the hosted data.

### ChatGPT subscriptions on a remote server

Docker does not change ChatGPT's loopback OAuth callback. Clicking its normal login from a phone or remote browser cannot deliver that callback to the container. API keys and the existing device-code providers remain available, but are not a substitute for ChatGPT subscription billing.

To reuse an existing desktop ChatGPT login, quit the desktop app and open **Settings → Providers → ChatGPT → Import ChatGPT connection…** in the hosted web app. Select `chatgpt-credentials.json` beside the installed profile's `data/` directory. This file contains credentials: upload it only to your protected LearnHarness instance, never to notes/data import or source control. The import requires idle lessons/jobs and no pending ChatGPT sign-in, validates the file, saves an owner-only backup of existing hosted credentials, and atomically replaces only the ChatGPT connection. Accounts/models refresh without restarting. Keep the desktop app quit while using the hosted copy: both copies share rotating refresh tokens. Expired or revoked logins must be renewed locally before reimporting. Learning-data backups intentionally exclude these credentials.

For ChatGPT, follow the provider's [self-hosted VM procedure](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms):

1. Complete authorization locally using the existing desktop application and select the intended ChatGPT registration.
2. Fully quit that application before transferring the session, so it does not compete with the server for rotating refresh tokens.
3. Open Providers on the hosted app once to initialize its own credential record and host ID, then stop the hosted app.
4. Securely transfer a **copy** of the selected registration to the server's `auth/chatgpt-credentials.json`. Preserve the server's own `hostId`; do not copy the desktop host ID over it. Preserve the selected registration's issued client ID, tokens, identity metadata, and background-use consent. Never paste credentials into chat, logs, or source control.
5. Restart the hosted app and verify the connection and model catalog. The hosted server owns subsequent refreshes. Keep the old local file, but do not reuse that transferred session concurrently; later local use may require a new authorization.

There is no new automatic credential-import feature in this minimal Docker change. This is an operator-managed transfer; live provider authorization and entitlement must be checked with the real account.

## Safe local work

Use a disposable data root and a separate empty `{}` auth file:

```sh
LH_DATA_DIR=/absolute/path/to/scratch/data \
LH_AUTH_FILE=/absolute/path/to/scratch/auth.json \
npm run dev -- --port 3001
```

These variables isolate app records/saved keys, **not every external effect**. Ambient keys still win; subscription files follow the auth directory; Claude Code can use its native profile. File tools have broad read access under the server's user, subject to the [path guard](architecture.md#file-access-and-external-services). A scratch data root is not a filesystem or credential sandbox. Use synthetic fixtures/fake providers for automated reproduction and avoid personal files or ambient credentials.

Do not commit `.env.local`, credentials, or learning records. Do not copy a personal profile into a fixture. Avoid separate writers against live profiles; store initialization and maintenance scripts can mutate data or invoke model stages. Inspect scripts before using them. See [storage and compatibility](architecture.md#storage-and-notifications) before changing formats.

Read the relevant installed Next guide under `node_modules/next/dist/docs/` before framework-facing changes. The import restrictions live in `eslint.config.mjs`; they do not enforce every architectural convention. [Architecture's code map](architecture.md#code-boundaries) and [prompt composition](../src/agent/prompts/README.md) identify the main entry points.

## Debugging

- `LH_PROVIDER_EVENTS=1` saves raw provider events under the selected data root. They may contain private lesson/provider content.
- `LH_BACKGROUND_CAPTURE=auditor` (or comma-separated roles, or `all`) captures background requests/results. Roles are `researcher`, `demoBuilder`, `extractor`, `auditor`, `visualMaker`, and `pdfReader`; foreground teaching/probing is excluded.

For example:

```sh
LH_BACKGROUND_CAPTURE=auditor npm run desktop:dev
```

The flag must reach the **Next server**; restart an existing server to change it. Captures are off by default and written to `<data root>/debug/background-captures/<role>-<run ID>.json`. Each file retains the last request and response/error/tool results, with prior conversation in that request and compact per-turn timings—not every request body.

`request.format: provider` means adapter-exposed outgoing payload after app transport restrictions; `context` means model-facing conversation, not HTTP wire (for example, CLI). Captures do not enable thinking or recover reasoning a provider did not return. Request options/auth headers are not recorded, recognized nested credential/header fields are redacted, and POSIX files are owner-only. They still contain private source/graph content, have **no automatic expiry**, and require review before sharing and manual deletion when no longer needed. Capture/serialization errors do not fail workers.

For frontend failures, inspect the actual UI, requests, console, and state. A static render alone does not establish that an interaction works.

## Checks

```sh
npm test               # node:test via tsx; injected engines, fixtures, fake transports
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint, including import restrictions
npm run build          # Next production build
```

The suite requires no paid models or real sign-in. Some tests use temporary files, native processes, or local fake endpoints: deterministic does not mean every test is pure or cannot bind a loopback port. Inspect focused-suite setup before running beside a live app.

[Golden fixtures](../tests/fixtures/golden-data/README.md) exercise saved records through production paths. Keep compatibility expectations with intentional format changes; do not hand-edit fixture content to make tests pass. [Standalone skill-reader tests](../tests/skills/README.md) run separately with Python and no app runtime.

Additional runtime gates have prerequisites:

| Check | Prerequisite / purpose |
| --- | --- |
| `node scripts/smoke-provider-runtime.mjs` | Fresh build; traced provider payload/runtime paths with fixtures. Also used during packaging. |
| `node scripts/smoke-web-subscriptions.mjs` | Build, no dev server running; isolated synthetic connection checks, external traffic blocked. Briefly changes/restores a source mtime to exercise reload. |
| Other `scripts/smoke-*.mjs` | Standalone/native renderers, image workers, demo helper, compression, file paths, opening. Read each script and the [release guide](desktop-release.md) before running. |

Run checks proportionate to the change. Offline gates prove exercised contracts, not live entitlements or model-authored lesson quality.

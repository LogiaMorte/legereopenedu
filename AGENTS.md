# AGENTS.md

## Cursor Cloud specific instructions

### What this is
Legere Open Edu — an Astro **static** site (`astro.config.mjs` → `output: 'static'`, i18n `tr`/`en`)
with a backend implemented as **Cloudflare Pages Functions** under `functions/`. All server state
lives in a single Cloudflare **KV namespace** bound as `REGISTRATIONS` (members, event registrations,
events under `config:events`, counters, audit logs).

### Running it (two separate servers — this is the key gotcha)
- `npm run dev` → `astro dev` on `http://localhost:4321`. This serves the **pages only**. The
  `/api/*` Pages Functions in `functions/` do **NOT** run under `astro dev`; frontend `fetch('/api/...')`
  calls 404 there (the UI degrades gracefully, e.g. the Events section just shows nothing).
- Full stack (pages + Functions + local KV): `npm run build` then
  `npx wrangler pages dev dist --kv REGISTRATIONS --port 8788 --ip 127.0.0.1`.
  Wrangler serves static assets from `dist/` and reads Functions live from `functions/`.
  Local KV is a Miniflare store under `.wrangler/` (gitignored). Because static assets come from
  `dist`, **re-run `npm run build`** to see page edits on this server (Functions hot-reload; pages don't).

### Lint / typecheck / build
- Canonical gate is `npm run build` (`astro build`). There is **no lint script**.
- `astro check` is not usable out of the box (`@astrojs/check` is not a dependency and the command
  prompts interactively). Plain `npx tsc --noEmit` reports **pre-existing** DOM-vs-Workers lib type
  conflicts and is not the project's intended checker — don't treat its output as a regression.

### Auth & required config (why local login can't fully complete)
- Sign-in is **Google / LinkedIn OAuth only** (no email/password). `functions/api/auth/google.ts`
  requires a real Google-signed JWT whose `aud` matches `GOOGLE_CLIENT_ID`.
- Relevant env vars (set as Cloudflare Pages env vars, or a local `.dev.vars` file for wrangler):
  `GOOGLE_CLIENT_ID`, `LINKEDIN_CLIENT_ID`, `RESEND_API_KEY`, `DISCORD_WEBHOOK_URL`, `ADMIN_EMAILS`.
  None are needed to build or to serve public pages; they are only needed to actually log in and to
  send notification emails.
- The site owner's admin email is hard-coded in `functions/_shared.ts` (`OWNER_ADMIN_EMAILS`).

### Testing authenticated / write flows locally (no OAuth needed)
Seed local KV directly (via wrangler pages dev's KV), then drive the real Functions:
- A member is `member:{email}` → JSON with a `token` matching `/^[0-9a-f]{64}$/`.
- The session cookie is `legere_token=<url-encoded-email>:<token>`.
- Events live in `config:events` (a JSON array; an event is registrable when
  `registrationOpen: true` and `dateStart` is in the future). `POST /api/register`,
  `GET /api/auth/me`, and `GET /api/events` then exercise the full member registration path.

### Node
`.node-version` pins Node 20, but the app also builds/runs fine on the VM's Node 22 (Astro 5 supports both).

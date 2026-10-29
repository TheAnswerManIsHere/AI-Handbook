<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead. -->

# Replit — how the platform works, for every product hosted on it

> **What this is.** The fleet's account of Replit as a platform: publishing,
> the two databases, secrets, rollback, Git, Agent modes, and the connector's
> own behaviour. It is true in any repo hosted on Replit. **What one Repl is
> configured as** — its deployment type, domain, databases, secrets, commands —
> is that repo's own [`replit-environment.md`](replit-environment.md), which
> this file never restates. **What I may do with the connector** — sync yes, publish
> only on David's word — is `claude-core.md`, *Connectors → Replit*; this file
> says how things work, not what is authorised.

Built 2026-10-29 from three sources, and each claim says which:

- **docs** — docs.replit.com, read 2026-10-29. Its reference pages carry no
  dates; only the changelog is dated (newest read: 2026-10-23). Where two
  pages disagree, the disagreement is named, not resolved by guessing.
- **measured** — a command run against the Overhype.me or DojoOS Repl through
  the connector, or a file read in the repo, with its output quoted.
- **Agent** — Replit Agent's own account, answering `ask_question`. That is a
  working assumption, never a fact, until a measurement or the docs back it
  (*Asking it well*, below, says why).

Anything still open is listed at the end under *Open*, with what would settle
it.

## The model: a workspace and a published deployment

Every Repl is two environments that share nothing at runtime:

| | Workspace (development) | Published deployment (production) |
|---|---|---|
| Code | the Repl's working tree, tracking `main` | a snapshot taken at the last publish |
| Database | development database (Replit's Helium, PostgreSQL 16) | production database (Neon), created at first publish |
| Secrets | the Secrets pane | Publishing → Adjust settings → *Production app secrets* (see *Secrets*) |
| Tells code which it is | `REPLIT_DEPLOYMENT` unset; `REPLIT_DEV_DOMAIN` set | `REPLIT_DEPLOYMENT=1`; `REPLIT_DEV_DOMAIN` absent |
| URL | private `*.replit.dev` preview | `<name>.replit.app`, or a custom domain |

Sources: docs (*development-and-production*, *secrets*); measured on
Overhype.me 2026-10-29, `echo "${REPLIT_DEPLOYMENT:-unset}"` → `unset` in the
workspace; production query → `neondb`.

**Nothing moves from the workspace to production except a publish.**
*"Changes in the Project Editor do not automatically replace the live
release"* (docs, *publish-your-app*), and nothing publishes on a Git push. A
merge to GitHub `main` reaches neither environment on its own: the sync is
what brings it to the workspace, and the publish is what brings the
workspace to production.

## Publishing

**What a publish takes.** *"a snapshot of your app's files and
dependencies"* (docs, *replit-deployments*). **Whether uncommitted files are
in it is not stated by the docs**; the Agent says they are and cites the docs,
which say no such thing. So the rule stays the one the fleet already runs:
**publish only from a Repl whose checked-out SHA matches `main` and whose
worktree is clean** — the close-out sync's two checks — because if the
snapshot does include the working tree, a leftover probe ships. Publishing
covers *"every artifact"* in the project together (docs, *after-you-publish*).

**Stages.** Provision → Security checks → Build → Bundle → Promote, *"usually
a minute or two"*; a publish in progress can be cancelled (docs). A security
scan always runs, and a setting decides whether a critical finding blocks the
publish (docs, *publishing/overview*). Promote *"prepares the new version
alongside the current one, then switches your URL"*, but *"Database changes
sometimes require stopping your app temporarily"* — the two pages disagree on
downtime; assume a brief one when the schema changes.

**The published filesystem is not persistent** and *"resets every time you
publish"* (docs, *troubleshooting*). Anything that must survive goes in a
database or object storage.

**Health check.** Before promoting, Replit requests the app; a homepage
slower than five seconds can fail the publish at the last step. The server
must listen on `0.0.0.0`; Autoscale and Reserved VM expose one external port,
and declaring any `[[ports]]` turns off auto-detection and requires one with
`externalPort = 80` (docs, *troubleshooting*, *ports*). An artifact can name
its own startup check — Overhype.me's API declares
`[services.production.health.startup]` `path = "/api/healthz"` (measured, in that artifact's `artifact.toml`).

**Logs** are kept 30 days, in the Publishing pane's Logs tab (docs,
*monitoring-a-deployment*).

### Deployment types

Four, and only four (docs, *deployment-types*):

| Type | Runs | Bills | Fleet use |
|---|---|---|---|
| **Autoscale** (default) | adds servers under load, scales to zero after 15 idle minutes; first request after idle is a cold start | while requests are served | Overhype.me (measured, `.replit`: `deploymentTarget = "autoscale"`) |
| **Reserved VM** | one always-on server | fixed monthly | DojoOS (measured, `.replit`: `deploymentTarget = "vm"`) |
| **Static** | files only, no backend; *"not compatible with Replit Apps created using Agent"* | data served | — |
| **Scheduled** | a command on a cron, then stops; no URL | per run | — |

Autoscale's *Max machines* caps the server count and so the maximum cost. A
Reserved VM restarts a program that exits, which is why a supervisor that
exits non-zero when a child dies is the right shape there (DojoOS's production
supervisor).

### Where the publish configuration lives

Two layers, and the second is the one an Agent-built pnpm monorepo uses:

- **`.replit`** — `[deployment]` carries `deploymentTarget`, optional `build`
  / `run`, `ignorePorts`, and `router`; `[deployment.postBuild]` runs after
  the build (both fleet Repls: `pnpm store prune`). `[[artifacts]]` entries
  name the project's artifacts (measured, both repos).
- **`artifacts/<name>/.replit-artifact/artifact.toml`** — one per artifact,
  each declaring `[[services]]` with the `paths` it serves, a
  `[services.development]` run command, and a `[services.production]` block
  with its own build, run, env and health check. With `router =
  "application"`, requests are routed by those `paths`. Measured on
  Overhype.me: `/api` → the API service (run `node --enable-source-maps
  artifacts/api-server/dist/index.mjs`, env `NODE_ENV = "production"`); `/` →
  the web artifact (`serve = "static"`, rewrite `/*` → `/index.html`);
  `/__mockup` → the design artifact, which declares no production service and
  so serves nothing when published.

**`NODE_ENV` is set by this config, not by Replit**: the docs never say
Replit sets it, and Overhype.me's API sets it in its artifact's production
env (measured). A service with no such line runs without it.

### Republishing, history, rollback

- **Republish** keeps the URL and the deployment's settings; it is the only
  way new code reaches production (docs; the connector's `publish_app`:
  *"If the app has been published before, this republishes it, reusing the
  existing deployment's settings"*).
- **Rollback of production is a redeploy of an earlier version**, from
  Publishing → History (docs, help FAQ only; retention and exact UI are
  *Open*). The Agent cannot read that list (Agent, 2026-10-29).
- **A workspace checkpoint rollback never touches production.** Code and the
  development database roll back (the database only if ticked under
  *Additional rollback options*); production stays as published. To bring
  production back too: restore its database, roll back to the matching
  checkpoint, and republish (docs, *data-recovery*).
- **Changing who can reach the app requires unpublishing first** (docs,
  *private-deployments*) — an outage, so it is David's call each time.

## The two databases, and what a publish does to production's

- **The development database is the Agent's; production is not.** *"Agent
  can't touch it"* — for writes (docs). The Agent **can run read-only queries
  against production** through a tool of its own (Agent; measured
  2026-10-29: `SELECT current_database(), now();` against production →
  `neondb,2026-10-29 21:58:06.18808+00`). That is a live read of user data,
  under the disclosure rules of
  [`live-diagnosis`](../../.claude/skills/bugfix/live-diagnosis.md) like any
  other: aggregate or redact in the request itself.
- **At publish, production's schema is brought to the development
  database's.** *"any changes you've made with Agent to the structure of
  your development database ... are applied to your production database"*
  (docs). Data is never copied, except once at creation if asked. **What the
  docs do not describe and David has measured** (Overhype.me, 2026-10-28):
  when the two schemas differ, Replit generates one migration and offers
  **Approve and publish**, **Create preview deploy** or **Cancel**, asking per
  difference only when one is ambiguous; there is no "keep production as it
  is". A repo's own migration files are not what runs there — Replit diffs
  and generates — so a repo whose app also runs guarded migrations at boot
  must tolerate a schema Replit already applied. How each product handles
  this is its own `migrations-and-backfills.md`.
- **A preview deploy** is *"a temporary, isolated copy of your production
  environment where you can test database changes and application updates
  before they affect real users"* (docs). How it is reached, how long it
  lives and what database it uses are *Open*.
- **Recovery.** Development: checkpoint rollback, up to 7 days. Production:
  point-in-time restore — 7 days on Core, up to 28 on Pro (docs,
  *data-recovery*). Production idles after five minutes without queries and
  wakes on the next one (docs).
- **Risky schema changes** at publish are the ordinary ones: dropping a
  column code still reads, adding a required column without a default,
  renaming (docs). They are what the Approve screen is for.

## Secrets and environment

**The docs contradict themselves on whether workspace secrets reach
production**: *publishing/overview* says they *"sync automatically ... when
you publish or republish"*; *troubleshooting* says they *"do not
automatically carry over"*; a 2025 changelog describes sync with per-secret
*unsync*. The Agent picked the second. **Until a screenshot of the Production
app secrets pane settles it, treat every production secret as something to
check there by name, never as inherited** — a secret added in the workspace
and assumed live is the failure this rule exists to prevent. Secrets are
unavailable to Static deployments, and an organisation member who cannot see
a value can still print it from the environment (docs, *secrets*).

## Domains and access

- Default `<name>.replit.app`; custom domains through a guided DNS flow or by
  hand: an `A` record plus a `replit-verify=` `TXT` record, **and the `TXT`
  record must stay forever** — TLS renewal re-validates through it. `www` is
  a separate domain. DNS can take 48 hours (docs, *custom-domains*).
  Overhype.me serves at `https://overhype.me`; DojoOS at
  `https://dojo-os.replit.app` (measured, `get_publish_status`, 2026-10-29).
- Access: Public, Password protected, Workspace only, Invite only; Replit puts
  its own sign-in in front, with no code change. Personal workspaces default
  to Public (docs, *private-deployments*). A machine reaching a private app
  uses an External Access Token (docs).
- **A publish locks the region**; changing it means remixing the app (docs).

## Git, and the Repl's own commits

- **Nothing syncs from GitHub to the Repl by itself.** The Git pane has
  Pull, Push and Sync Changes; one help FAQ mentions an auto-sync toggle that
  the Git pane's own page does not, and the Overhype.me Repl showed none
  (measured, 2026-08-11). So the post-merge sync is always an explicit step,
  which is why close-out asks for it every merge.
- **Every Agent checkpoint is a git commit** in the Repl's repository, and
  every checkpoint and publish is also copied to a Replit-managed remote
  named `gitsafe-backup`, which is not GitHub (docs, *disaster-recovery*).
  GitHub receives only what is committed and pushed.
- **`[postMerge]`** in `.replit` names a script the Agent runs after it
  merges one of its own tasks — not after a workspace `git pull` and not at
  publish (Agent, DojoOS, citing the project's guidance; unconfirmed by the
  docs). DojoOS's runs `pnpm install --frozen-lockfile`. It is therefore no
  substitute for installing dependencies after the close-out sync.

## Agent modes, and what a connector request costs

- **Modes are Free, Power and Max** (Economy is gone; Lite, Turbo and
  *Full build* are stale names on older pages). Free always auto-routes the
  model; Power and Max on Core or Pro can pick a model and an Effort level.
  **The mode is a setting of David's account, per message** — *"Your Agent
  settings are tied to you, not to the project"*, and they apply *"when you
  send the next message"* (docs, *agent-modes*, *model-selector*).
- **The connector cannot choose the mode.** Its `ask_question` and
  `update_app_using_prompt` both take a `policy` argument whose own schema
  reads *"Ignored. Don't waste tokens sending this."* So a connector request
  runs in whatever mode David's dropdown holds; the Agent itself cannot see
  which (Agent, 2026-10-29: *"I can't see which Free, Power, or Max tier or
  exact model handled this request"*). Every request through the connector to
  date has run free (David, 2026-10-29) — that is a property of his dropdown,
  and it changes if he changes it.
- **Billing**: paid modes are effort-priced per request, one checkpoint per
  request, and Replit asks for confirmation before a paid action starts;
  Plan Mode bills reasoning even when nothing changes; usage takes up to 30
  minutes to show (docs, *ai-billing*). Routines never run in Free.
- **Plans** that matter here: Starter allows one published app that expires
  after 30 days; Core and Pro publish without limit, run 1 and 10 background
  tasks, and Pro rolls credits over two months (docs).

## The connector

Tools, as the MCP server exposes them: `list_apps`, `search_apps`,
`resolve_app_by_name`, `create_app_from_prompt`, `ask_question`,
`update_app_using_prompt`, `publish_app`, `get_publish_status` (docs,
*mcp-server*). Two more appear in this fleet's sessions,
`list_app_files` and `read_app_file`, which do not list `*.sql` files
(measured in DojoOS's environment doc).

- **`ask_question` has a 60-second client timeout, and a reply that outlives
  it is lost.** The server's own words on the next call: *"replies that
  outlive your timeout are never delivered ... The server does not remember
  bounced questions."* The Agent keeps working on the lost question, and
  every call to that Repl until it finishes returns `phase: "busy"` with
  nothing submitted. Measured 2026-10-29: an eight-item question and two
  questions that sent the Agent to look up documentation each timed out and
  cost two to three minutes of `busy` afterwards; short questions that said
  *"Don't look anything up … in three sentences at most"* all returned
  inside the limit. **So: one short question per call, say not to look
  anything up when its own knowledge or a command is enough, and after a
  timeout wait two to three minutes before re-asking — never resend at
  once.** Each Repl's Agent is independent, so a busy one does not block
  another.
- **`phase` values seen**: `busy` (dropped, re-ask later) and `paused` (the
  answer is in `response` — the normal successful reply). `updating` belongs
  to the write channel: re-invoking it opens a brand-new Agent turn
  (`claude-core.md`).
- **`update_app_using_prompt` never returns the result**, only a status
  (`claude-core.md`); a read-back is a following `ask_question`.
- **`publish_app` takes only the `replId`.** Type, domain, access and secrets
  are whatever the deployment already has; a first publish takes defaults —
  *"Autoscale hosting, private visibility when the app belongs to a workspace
  (organization), public visibility otherwise"* — and some apps refuse a
  first publish from chat and must be published once from the website (the
  tool's own description; the docs do not mention it). It returns once the
  publish is scheduled: poll `get_publish_status` every 30 seconds until it
  reads `success`, `failed` or `suspended`. `found: false` means never
  published.
- **`get_publish_status` is free and safe**: no Agent turn, no checkpoint.
  It is the cheap way to learn an app's live URL and whether its last publish
  landed.
- **`suspended`** is not a state the docs define for a deployment; they only
  describe suspension for continued payment failure and a reached spend
  limit (docs, *about-usage-based-billing*, *managing-spend*). Read it as a
  billing stop until shown otherwise.

### Asking it well

The rule Overhype.me learned on 2026-08-11 and re-measured here: **an answer
that quotes the command it ran and that command's raw output is evidence; an
answer describing how something works is the Agent's understanding, which
can be fluent, specific and false.** On 2026-10-29 the Agent cited the docs
for a claim the docs do not make, and reported a newest log line timestamped
eleven hours in the future. So ask it to run a named command and quote the
output, ask it to say which parts of an answer are observed and which are
general knowledge, and corroborate the second kind against the docs or a
measurement before recording it anywhere.

## Contradictions inside Replit's docs

Recorded so nobody resolves them by picking the page they found first: the
secrets sync (above); the Autoscale base fee ($2 on the pricing page, $1 on
the August 2026 update); whether access controls need Pro (one older page
says so, the access page does not); US-only hosting versus selectable
regions; downtime at publish; `localPort` versus `internalPort` in the ports
page; and whether the dev-database rollback window is 7 days. The model list
on the model-selector page lags the changelog and says it is not the source
of truth — the dropdown is.

## Open

Each needs David's screen; the Agent cannot see them and the docs do not
say.

1. **Production app secrets** — whether it lists workspace secrets as synced,
   and whether a per-secret unsync exists.
2. **Publishing → History** — what it lists, how far back, and what
   redeploying an old version does to the production database's schema.
3. **Create preview deploy** — what it creates: a URL, a database, a
   lifetime, a cost.
4. **Agent settings dropdown and usage page** — which mode connector requests
   run in today, and whether they appear on the usage dashboard.
5. **Whether a publish includes uncommitted files** — settled for practice by
   the clean-tree rule above, but not as a fact.

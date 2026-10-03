# Chapter 12 · The machinery underneath

> The handful of scripts, checks and settings files that do what prose cannot:
> copy the payload into a product and take back what it stops shipping, prove
> this repository actually reaches its own payload, keep settings files
> loadable, keep the pinned models consistent, and run the review and planning
> dispatches. It is small on purpose, it has no dependencies on purpose, and
> most of its design is about **refusing loudly rather than succeeding
> quietly**.
>
> Deep rules: the repository's [`CLAUDE.md`](../../CLAUDE.md) (*Verifying*,
> *How this repo reaches its own payload*, *The guard is gone*), the CI
> workflow [`.github/workflows/check.yml`](../../.github/workflows/check.yml),
> and the header comment of each script, which is where its reasoning lives.

## What it does

Most of the handbook is prose that agents read. A small part of it is code,
and that code exists only where a rule has to be *made true* rather than
*remembered*:

- **Delivery.** One script copies the [payload](./glossary.md#payload) into a
  [consumer repo](./glossary.md#consumer-repo) and deletes what the payload no
  longer ships.
- **Self-checks.** A few checks run on every pull request to this repository
  and fail when the handbook would ship something broken — a file the
  [sync](./glossary.md#sync) could never take back, a settings file Claude
  Code would refuse, a role running on the wrong model, a payload skill this
  repository cannot itself load.
- **Process machinery that ships.** The payload's own scripts package the
  planning and review dispatches, scope a [prose
  sweep](./glossary.md#prose-sweep), mirror labels onto the tracking board,
  and guard a few document formats in each product.

None of it is a product build. There is no database here and nothing to
deploy.

## How it works

### Two sets of scripts

**`scripts/`** at the repository root belongs to the handbook alone and never
ships. **`core/scripts/`** is payload: it lands in each product at
`scripts/`, carrying the [sync banner](./glossary.md#sync-banner) like any
other payload file. Each set has its own test suite, and both suites run in CI.

### The handbook's own scripts

- **`sync.mjs` — delivery.** It copies `core/**` into a product, every file to
  the same path minus the `core/` prefix. That is the one rule, and there is
  one exception: a file named `*.template.*` is a [seed
  file](./glossary.md#seed-file), delivered once under its real name and then
  owned by the product, never overwritten. (The machinery configuration is the
  one seed that is *topped up*: keys the template has gained since the product
  was seeded are added, and nothing the product set is changed.) The sync also
  **deletes** a product's copy of a file the payload has stopped shipping — but
  only a file the product's git tracks, whose own text carries the sync banner,
  and that nothing in this run routes to. It reads committed bytes rather than
  the working tree, so an unreviewed local edit cannot ship; it writes every
  file by an atomic rename; it makes every refusal before its first write, so a
  dry run refuses exactly what a real run would. A sync is run deliberately and
  lands in the product as an ordinary pull request.
- **`check-payload-banners.mjs`** refuses any non-seed payload file that lacks
  the sync banner, because the banner is the sync's only record of what it
  manages: a file without it could be delivered and never taken back.
- **`check-root-wiring.mjs`** proves this repository reaches its own payload
  (next section), failing in both directions — a payload entry with no link,
  and a link that dangles, duplicates or points outside `core/`.
- **`check-settings-fields.mjs`** refuses any settings file carrying a
  top-level field Claude Code would not recognise (see *Settings files*,
  below).
- **`check-agent-models.mjs`** holds each Fable role's declared model and
  effort, and the seed a new product's configuration is created from, equal to
  the [machinery pin](./glossary.md#machinery-pin), and can rewrite them from
  it. Chapter 11 explains why the declaration exists.

### The payload's scripts

- **`machinery.mjs`** — the small shared module. It reads the product's
  identity and model tiers from `.agents/machinery.json` (the one place
  identity is read), validates structured answers, and holds the one copy of
  the flags that keep [Astra](./glossary.md#astra) in a read-only sandbox.
- **`plan-review.mjs`** — packages one exchange of the [plan review
  loop](./glossary.md#plan-review-loop) for Astra and keeps the open concerns
  between exchanges. It parses no verdict: what happens next is something
  Claude states.
- **`review-proxy.mjs`** — packages a [review
  round](./glossary.md#review-round) for its two assessors, Astra and the
  [Fable assessor](./glossary.md#fable-assessor), refusing to run without an
  agreed [oracle](./glossary.md#oracle) or on a working tree that is not the
  reviewed commit. Like the plan script, it decides nothing.
- **`round-translation.mjs`** — supports the [round
  translation](./glossary.md#round-translation): it composes the chat message
  David receives from the translator's own answer, verbatim, so the account is
  not Claude's rewriting of it.
- **`sweep-scope.mjs`** — the deterministic half of a prose sweep. It fixes
  the scope from git's tracked files and splits it across cold readers, each
  with the same brief. It deliberately does not search for phrases; the
  reading is the readers' job.
- **`sync-project-fields.mjs`** — mirrors a [workstream](./glossary.md#workstream)
  issue's labels onto the fields of the GitHub project board, which no
  available tool can write directly (chapter 10). A product runs it from its
  own GitHub Action.
- **`check-docs-accuracy.mjs`** and **`check-uat-format.mjs`** — guards a
  product's CI runs: every relative link and repository path in the shared
  docs must resolve, and every [UAT](./glossary.md#uat) document must have the
  shape the `/uat` skill drives.
- **`retry-on-eagain.sh`** — reruns a command only when it failed because the
  machine ran out of process slots, never on a real test failure.

### Continuous integration

One workflow, two jobs, on every pull request to `main` and every push to it:

- **Test** runs both suites — the handbook's scripts and the payload's.
- **Manifest** runs the four checks above, plus a dry-run sync into a scratch
  repository (which must write nothing) to prove the sync's entry point still
  works. The job is named after a manifest that no longer exists; the name is
  kept because it is a required status check in the branch
  [ruleset](./glossary.md#ruleset), and renaming it would block every pull
  request until the ruleset was edited.

There is **no install step**. The machinery is deliberately dependency-free —
plain Node — and the workflow says that adding a dependency is a decision to
make explicitly, not by quietly adding one.

### How this repository reaches its own payload

The handbook governs itself with the file it ships: its `CLAUDE.md` imports the
portable [core](./glossary.md#core) straight from `core/`. Everything else
under `core/` reaches this repository only through that import — except two
kinds of entry:

- **[Skills](./glossary.md#skill) and [agent
  definitions](./glossary.md#agent-definition) are live here**, through one
  symlink per entry from `.claude/skills/` and `.claude/agents/` into `core/`.
  That keeps a single copy while still letting Claude Code load them. The link
  is per entry rather than one link at the `skills` directory because a
  per-entry link is documented behaviour, and a directory-level link is not —
  and its failure would look silently like "no skills here". So **adding a
  skill to the payload is only half the change**; the root-wiring check refuses
  the other half being forgotten.

Two things are deliberately **not** links:

- **`.claude/settings.json`** is this repository's own file, adapted from the
  payload's settings template — which is a seed for the next product, not
  configuration that takes effect here.
- **A few `.gitignore` files** under `.agents/` and `docs/plans/` are real
  copies, because git does not follow a symlinked `.gitignore`; their patterns
  would never apply and ephemeral files would be committed. The root-wiring
  check compares each copy with its payload original.

### Settings files

The payload's `core/.claude/settings.template.json` is a seed: it lands once
as a product's real `.claude/settings.json`, carrying the default model, a
test database placeholder, the permission allow-list for the remote-session
tools, and a **deny list** that refuses the command which can push a database
schema straight at a live database and refuses reading environment secret
files. This repository's own copy drops what does not apply here (no
database, no Drizzle) and keeps the rest.

**Neither file may carry a field Claude Code does not recognise.** Claude
Code's validator is stricter than its published schema, and a refused settings
file applies *none* of its contents — including the deny list. Both files once
documented themselves in a comment field, which is exactly what the validator
rejects. The check reads the files instead of trusting memory, and fails on any
field outside the small set the handbook actually uses; the prose that used to
sit in those comments now lives in `CLAUDE.md` and in
[`docs/consuming-repos.md`](../consuming-repos.md).

### The machinery configuration

Each product's `.agents/machinery.json` names the repository and the two model
tiers. It is seeded from a self-documenting template whose placeholder
repository name is **refused by name** the moment any script reads it — an
unedited template fails loudly instead of quietly binding to a repository that
does not exist.

### Vendored skills

Some skills in the payload are third-party: a set from Trail of Bits and a set
from the open-source "superpowers" collection, copied in because the web
version of Claude Code cannot install plugins. Their provenance, licences and
the few local changes made to them are recorded in
[`VENDORED_SKILLS_NOTICE.md`](../../core/.claude/skills/VENDORED_SKILLS_NOTICE.md).

### What replaced the guard

Until [the #89 cut](./glossary.md#the-89-cut), three local hooks ran a
shell-command guard before Claude's tool calls: a destructive-command guard, a
review-request guard and a merge gate. All three, and the guard script, are
gone. What they protected is now covered without a parser:

- **Force pushes** are refused by server-side GitHub rulesets — on `main`, on
  Claude's branches, and on all branches.
- **Merging with an open review thread** is refused by the `main` ruleset,
  which requires conversation resolution.
- **Pushing a schema at a live database** is refused by the settings deny
  list.

## Why it works this way

- **Correct by construction beats checked.** The sync used to be described by
  a long routing manifest and policed by a larger checker; it encoded two
  rules. Now the sync routes `core/**` whole, so there is no routing table for
  a new file to fall out of — the hazard is impossible rather than checked. The
  write path follows the same idea: after filesystem edge cases kept
  surfacing in review, the sync stopped enumerating them and changed its
  primitives instead (committed bytes, atomic rename).
- **No ledger, so nothing stored can go stale.** An earlier sync that deleted
  files was reverted after one review round found four ways it deleted the
  wrong thing, every one rooted in its record of past deliveries. The
  replacement keeps no record: each file says in its own text that it is
  managed, and every input is read in the same run.
- **A control that cannot evaluate must refuse.** The fleet has paid for the
  opposite more than once. The old guard read any unexpected exit as "allow",
  so every new way of failing to produce a verdict failed open. Its one
  surviving descendant is the **entry-point lesson**: a script that compares
  its own location against a hand-built path string silently never runs when
  the checkout path contains a space or a `#`, and exits successfully having
  checked nothing. Both test suites refuse that form. The same principle shows
  up elsewhere — the banner check refuses to report a clean payload if it found
  no files to read, and the sync refuses a destination it cannot inspect.
- **A check, not a convention, wherever a rule can be forgotten silently.**
  Every check here exists because its failure was invisible: a skill missing
  from this repository looks like nothing at all; a refused settings file
  drops its deny list without saying so; a role with no model runs as the
  session.
- **Server-side protection cannot fail open.** The guard was a parser chasing
  a real shell's syntax, could be disarmed by a change of directory, and in its
  only recorded force-push event *prevented* a legitimate fix. A ruleset has
  none of those properties.
- **Less machinery, deliberately.** The #89 cut removed some twelve thousand
  lines — round budgets, receipts, an adjudicator, a merge-readiness gate —
  after measurement showed none of it had changed a decision. What remains
  either does real work or protects something that would otherwise fail
  silently.
- **Dependency-free** keeps CI to "check out and run Node", with nothing to
  install, pin or update.

## Boundaries & known limitations

- **A sync is not scheduled.** It runs when someone runs it, and its output is
  reviewed in the product like any other pull request.
- **A filesystem failure mid-sync can leave it half-applied.** Every refusal
  comes before the first write, but a full disk or a permissions error cannot
  be foreseen. Every deleted file was tracked, so git restores it and a re-run
  completes.
- **The settings check fails on a legitimately new field.** That is the
  intended trade: a loud failure at authoring time, with a message saying what
  to do, instead of a silent one at session start in somebody else's
  repository. It also checks top-level fields only.
- **The model check runs only here** (chapter 11 says why), and it compares
  declarations to the pin, not role names to either: if the pin moved to a
  different model family, the `fable-` role names would go stale and the check
  would still pass.
- **Not every payload script is exercised by this repository's CI.** The docs
  and UAT format guards are written for a product's own CI; here only their
  tests run.
- **The all-branches force-push ruleset has not been separately probed**; the
  refusal was measured on Claude's branch namespace. Nothing in Claude's own
  flows depends on the difference.
- **Required status checks are a repository setting**, not something the
  workflow file can declare — which is also why the `Manifest` job keeps its
  outdated name.

## Going deeper

- How the handbook verifies itself, and its wiring rules:
  [`CLAUDE.md`](../../CLAUDE.md).
- The CI workflow, with the reasoning for each step in its comments:
  [`.github/workflows/check.yml`](../../.github/workflows/check.yml).
- The sync, with its design rationale in its header:
  [`scripts/sync.mjs`](../../scripts/sync.mjs); what a product receives and
  how it adapts its seeds: [`docs/consuming-repos.md`](../consuming-repos.md).
- The settings seed:
  [`core/.claude/settings.template.json`](../../core/.claude/settings.template.json).
- The git constraints and rulesets Claude works under:
  [`claude-core.md`](../../core/.agents/core/claude-core.md), *This
  environment's git constraints*.

**Next:** that is the last chapter. Return to the
[manual's contents](./README.md#contents), or look a term up in the
[glossary](./glossary.md).

*Verified against `118e076` (2026-10-03).*

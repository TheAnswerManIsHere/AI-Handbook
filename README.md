# AI-Handbook

The working contract shared by every product David builds with AI agents.

One set of rules — how work is planned, reviewed, shipped and remembered —
maintained here and vendored into each product repo, so a lesson learned on one
product is not re-learned on the next.

## Why this exists

Two products (Overhype.me, DojoOS) run the same development process with the
same agents: Claude Code builds, Codex reviews, Replit hosts, David decides.
That process is substantial — review-loop stopping rules, planning ceremony, PR
discipline, close-out bars, environment gotchas the fleet has already paid to
discover. Before this repo it lived in one product's repository, which meant
the second product either started from nothing or started from a copy that
began drifting the day it was made.

A copy that drifts is worse than no copy: two files claim the same authority
and neither is wrong on its face. Hence a single source and a sync.

## How it works

```
AI-Handbook (this repo)          Consumer repo
──────────────────────           ─────────────────────────────
core/                     ──►    .agents/core/  docs/  .claude/  scripts/
  the payload                      vendored copies, overwritten by sync

scripts/sync.mjs                 CLAUDE.md   ← the repo's own overlay,
  copies core/** across                        imports the vendored core
                                 AGENTS.md   ← ditto, links to it
```

**Vendored, not linked.** Synced files land as ordinary files at their normal
paths in the consumer. Every agent — Claude, Codex, Replit — and every human
reads them exactly as if they had always been there. Nothing depends on this
repo being reachable at runtime.

**Two layers, one rule each.** The handbook owns *how we work*. Each product
repo owns *what it is*: its brief, roadmap, architecture, glossary, subsystem
docs and product-specific skills. A rule that is true for every product belongs
here; a rule that is true for one product belongs in that product's overlay.
See [`docs/consuming-repos.md`](docs/consuming-repos.md) for the composition
model and the overlay template.

**Sync will propagate through review, not silently.** The intended model: a
merge here opens a pull request in each enrolled consumer, so nothing lands in a
product repo without the same review the product's own code gets.

**One rule, and a seed exception.** Everything under `core/` lands at the same
path in the consumer, minus the `core/` prefix. The only exception is a
`*.template.*` file, which lands under its real name (`settings.template.json`
→ `.claude/settings.json`) and **only if the consumer does not already have
one** — those two files are consumer-owned once they land, and overwriting them
would clobber a repo's own permissions and identity.

**Run it with `node scripts/sync.mjs --to <consumer-repo> [--dry-run]`.** There
is no scheduled workflow yet: a sync is run deliberately and its output is
reviewed as an ordinary pull request in the consumer, so nothing reaches a
product repo without the review that repo's own code gets.

**There is no staging system, deliberately.** An earlier design gave each group
a `status`, a `requires` graph and a cohort model, to sequence a gradual
rollout. Sequencing a rollout is only worth doing when something is live to be
broken, and nothing is. It was deleted; if a staged rollout is ever genuinely
needed, the thing to build is the smallest mechanism that delivers it.

## What is in `core/`

| Group | What |
|---|---|
| `.agents/core/` | The portable halves of `CLAUDE.md` and `AGENTS.md` |
| `docs/ai-context/` | Cross-agent contracts: working rules, modes, planning, review judgment, prose sweeps, documentation, workstream tracking, failure patterns |
| `docs/engineering/` | Code review and migration practice |
| `.agents/memory/` | Environment and tooling gotchas — the harness, GitHub, the proxy, the toolchain |
| `.claude/skills/` | Process and practice skills |
| `.claude/agents/` | Subagent definitions |
| `scripts/` | Review-loop, plan-review and project-sync machinery |

Product truth is deliberately absent. If something here only makes sense for
one product, it is in the wrong repo. The agent-environment docs
(`codex-environment.md`, `replit-environment.md`) are the case worth naming,
because they sit in `docs/ai-context/` and look shared: each describes ITS
repo's setup script, packages, database and deploy path, so every consumer owns
its own. They and the rest of the consumer-owned set are listed in
[`docs/consuming-repos.md`](docs/consuming-repos.md).

## Working in this repo

Changes here reach every product, so this repo runs the **internal** review
tier, which says what is downstream and nothing about how long a review loop
runs. How long it runs is the **two-review limit**
([`working-modes.md`](core/docs/ai-context/working-modes.md#the-two-review-limit-on-autonomous-iteration-david-2026-09-19)):
the automatic pass, one coherent batch of corrections if any are warranted, a
review of that corrected head, and autonomous iteration ends there. **That is
not a property of this repository, and it is asked per change**: the limit is
scoped by consequence and recoverability, so a change that alters what the
sync publishes to every consumer, or that touches approvals, credentials or
destructive operations, is weighed on that and can sit outside the limit — while a
recoverable tweak to the same file does not. A clean automatic pass is the whole ceremony;
a round that returns findings gets two independent assessments before anything
is written for it; and anything written gets reviewed before it merges — that
last is the write-gate rule, which answers what must be reviewed rather than
how long. Whether acting on a
finding is worthwhile is judged case by case, with no target rate in either
direction. Read `CLAUDE.md` before editing — it is
short, and it imports the same core it ships.

Verify locally with:

```
node --test scripts/__tests__/*.test.mjs   # the machinery's own tests
node scripts/sync.mjs --to <repo> --dry-run   # what a consumer would receive
```

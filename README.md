# AI-Handbook

The working contract shared by every product David builds with AI agents.

One set of rules — how work is planned, reviewed, shipped and remembered —
maintained here and vendored into each product repo, so a lesson learned on one
product is not re-learned on the next.

## Why this exists

Two products (Overhype.me, DojoOS) run the same development process with the
same agents: Claude Code builds, Codex reviews, Replit hosts, David decides.
That process is substantial — review-loop budgets, planning ceremony, PR
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

sync-manifest.yml                CLAUDE.md   ← the repo's own overlay,
  what goes where                              imports the vendored core
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

**Sync propagates through review, not silently.** A merge here opens a pull
request in each enrolled consumer. Nothing lands in a product repo without the
same review the product's own code gets.

## What is in `core/`

| Group | What |
|---|---|
| `.agents/core/` | The portable halves of `CLAUDE.md` and `AGENTS.md` |
| `docs/ai-context/` | Cross-agent contracts: working rules, modes, planning, plan review, documentation, workstream tracking, failure patterns, agent environments |
| `docs/engineering/` | Code review and migration practice |
| `.agents/memory/` | Environment and tooling gotchas — the harness, GitHub, the proxy, the toolchain |
| `.claude/skills/` | Process and practice skills |
| `.claude/agents/` | Subagent definitions |
| `scripts/` | Review-loop and readiness machinery |

Product truth is deliberately absent. If something here only makes sense for
one product, it is in the wrong repo.

## Working in this repo

Changes here reach every product, so this repo runs the **internal** review
tier: a clean automatic review pass is the whole ceremony, and findings ship as
recorded gaps unless they are genuinely critical. Read `CLAUDE.md` before
editing — it is short, and it imports the same core it ships.

Verify locally with:

```
node --test scripts/__tests__/     # the machinery's own tests
node scripts/check-manifest.mjs    # every payload file is actually routed
```

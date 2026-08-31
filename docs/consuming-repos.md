# Consuming the handbook

How a product repo takes the shared contract, and what it keeps for itself.

## The composition model

Each consumer has two layers at every level: a **vendored core** the handbook
owns, and an **overlay** the repo owns. The overlay is hand-written and never
synced; the core is overwritten on every sync and never hand-edited.

| Layer | Owned by | Path in consumer | Edited where |
|---|---|---|---|
| Claude core | handbook | `.agents/core/claude-core.md` | this repo |
| Claude overlay | consumer | `CLAUDE.md` | consumer repo |
| Agents core | handbook | `.agents/core/agents-core.md` | this repo |
| Agents overlay | consumer | `AGENTS.md` | consumer repo |
| Contracts, skills, memory, machinery | handbook | normal paths | this repo |
| Product docs, product skills | consumer | normal paths | consumer repo |

### Why the two files compose differently

`CLAUDE.md` **imports** its core. Claude Code expands `@path/to/file.md` at
session start and loads it exactly as if inline, following imports up to four
hops, with relative paths resolved against the importing file. So the fleet
rules are genuinely always-on: no agent has to remember to go read them.

`AGENTS.md` **links** to its core. AGENTS.md has no import mechanism — an `@`
line in it is just text. That is not a downgrade, because AGENTS.md is already
a routing file whose entire job is sending an agent to the right document, and
Codex follows those links. It does mean `agents-core.md` must read standalone
for someone who arrived from a link with no other context, which is why it
carries its own framing header.

The practical consequence, and the one thing to get right: **a rule that must
bind Codex cannot live only in an import.** Put it in `agents-core.md`, where
the link leads, and let `claude-core.md` defer to it.

## Overlay template — `CLAUDE.md`

```markdown
# Working agreements for <Product> (Claude Code)

@.agents/core/claude-core.md

## What <Product> is

<Two or three sentences: who it serves, what it does, who the business owner
is. Enough that a cold session knows what it is building before it reads
anything else.>

## Product truth lives here

- **Brief / direction / roadmap** — docs/ai-context/product-brief.md, …
- **Architecture** — docs/ai-context/architecture-map.md
- **Glossary** — docs/ai-context/glossary.md
- **Settled decisions and why** — docs/ai-context/decisions.md
- **Subsystems** — <the product's own subsystem docs>

## Product-specific skills

<The repo's own skills: design, implementation, plan review, subsystem work.>

## Sensitive subsystems

<Which areas add the specialist review tier — the core's ceremony rules refer
to "any subsystem the overlay marks sensitive", and this is where that list
lives. Migrations, auth and payments are sensitive everywhere; name the ones
particular to this product.>

## Environment

<What is specific to this product's environment: its Repl, its database, its
external services, its network allowlist.>
```

The overlay says nothing about review loops, planning ceremony, PR discipline,
close-out or git constraints. Those are in the core. **If an overlay starts
restating a core rule, that is drift beginning** — delete it from the overlay,
and if the core is wrong, fix the core.

## Overlay template — `AGENTS.md`

```markdown
# <Product> Agent Instructions

> Routing file for AI agents. The cross-agent working contract — how to
> behave, plan, review and ship — is in
> [`.agents/core/agents-core.md`](.agents/core/agents-core.md) and applies in
> full. **Read it first.** This file covers what is specific to <Product>:
> where its truth lives and how to build and test it.

## Project context

<The reading routes: which doc to read before which kind of work.>

## Setup, verification, and the CI gate

<The repo's actual commands, and what CI requires.>
```

## Required consumer documents

Some synced files link to documents the handbook deliberately does **not**
ship, because their content is per-repo. The links resolve in a consumer and
dangle in the handbook, which is expected — payload is written for its
destination.

| Document | Why it cannot be shared |
|---|---|
| `docs/ai-context/codex-environment.md` | Describes *this* repo's Codex sandbox: its setup script, its packages, which suites run there |
| `docs/ai-context/replit-environment.md` | Describes *this* repo's Repl: its database, its session hooks, its deploy path |
| `docs/ai-context/decisions.md` | The product's settled decisions and their rationale |
| `docs/engineering/migrations-and-backfills.md` | Written as operational instruction against one product's schema layout and migration commands. Its principles are fleet-wide; its instructions are not, and an agent follows instructions |
| `docs/tests/test-run-contract.md` | What a PR's post-merge verification must contain, in terms of this repo's own test runners |
| `docs/handoff/README.md` | The cross-tool transit folder and its delete-when-addressed contract |
| `.mcp.json` | The repo's MCP server declarations. Consumer-owned because a sync that overwrote it would delete the servers this repo declares beyond Firecrawl |

A consumer needs these before or alongside its first sync. They may be started
from the corresponding file in another repo, but they are then owned locally
and diverge — that is the point.

## Enrolling a repo

1. Add it to `consumers:` in `sync-manifest.yml` with `enrolled: false`.
2. Land the repo's own overlay `CLAUDE.md` and `AGENTS.md` from the templates
   above — before the first sync, so the vendored core has something importing
   it the moment it arrives.
3. Create the required consumer documents above.
4. Run the sync, review the pull request it opens, merge.
5. Flip `enrolled: true`.

A repo is enrolled only once its overlay exists. A vendored core that nothing
imports is inert: the files are present, the rules are not loaded, and the
repo looks governed without being governed — the worst of the three states.

## Rules for changing shared content

- **Never edit a vendored file in a consumer.** The next sync overwrites it and
  the reasoning is lost. Every synced file carries a header saying so.
- **Change the handbook, let the sync carry it.** One edit, every repo, each
  through review.
- **A `staged` group does not sync.** It is in the payload with a named blocker
  saying what must land first. Check `sync-manifest.yml` before assuming a file
  has reached a consumer.
- **Seeded files diverge on purpose.** `mode: seed` writes once and never
  again; a consumer's `.claude/settings.json` is meant to differ.

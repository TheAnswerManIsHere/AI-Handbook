# Agent instructions — portable core (all agents)

<!--
  SYNCED FILE — do not edit in a consumer repo.

  This file is the fleet-wide, cross-agent half of the routing constitution.
  It is maintained in the AI-Handbook repo and vendored into every consumer
  repo by the handbook sync. An edit made here in a consumer repo is
  overwritten by the next sync; change the handbook instead.

  Unlike CLAUDE.md, AGENTS.md does not support eager file imports, so a
  consumer's AGENTS.md LINKS here rather than importing. That matches how
  AGENTS.md already works — it is a routing file whose job is to send an
  agent to the right document — but it means this file must be readable
  standalone, by an agent that arrived from a link with no other context.
  Write it that way.

  What belongs here: the cross-agent working agreement, planning and
  implementation standards, technical priorities, engineering principles.
  What belongs in the consumer's AGENTS.md: the product's context-reading
  routes, its subsystem map, and its setup/verification/CI commands.
-->

> **Who this is for.** Every AI agent working in a repo governed by the
> AI-Handbook — Codex, Claude Code, Replit, and whatever comes next. It tells
> you **how to behave and what is non-negotiable**, independent of which
> product you are working on. The repo's own `AGENTS.md` carries the product
> half: what this product is, where its truth lives, and how to build and
> test it. Read both.

> **One source of truth for all agents.** These rules are shared. Claude
> Code's `CLAUDE.md` holds only Claude-specific ceremony and defers here for
> every cross-agent principle. When a shared rule changes, it changes in the
> handbook — never as a forked copy in one agent's own file or private
> memory.

## Working agreement with David

David is the product owner. **Do not implement major changes from a non-trivial
plan until David has explicitly approved that plan.** An ambiguous nudge or another
agent's approval is not David's approval. Full working rules:
[`docs/ai-context/agent-working-rules.md`](../../docs/ai-context/agent-working-rules.md).

**Two working modes — the ceremony in force is always visible, never silent.**
Default is **feature mode** (plan → approval → full build → PR). **Bugfix
mode** is a lightweight fix-and-commit path. For Codex, David turns it on by
saying so (e.g. a prompt starting **"Bugfix mode:"**); absent an explicit
signal you are in feature mode. (Claude routes by request shape with an
announced, vetoable classification — see the mode-entry section of
working-modes.md.) Read
[`docs/ai-context/working-modes.md`](../../docs/ai-context/working-modes.md) for the full
contract of each and how to switch between them.

**End-of-feature documentation.** Follow
[`docs/ai-context/documentation-workflow.md`](../../docs/ai-context/documentation-workflow.md).
**The per-merge close-out judgement is retired (David, 2026-08-20)** — the
heavyweight harvest now runs **batched at `/maintenance`**, covering every
product feature merged since the last pass, or whenever David asks. What
close-out owes instead is cheap and unconditional: a **harvest-notes comment
on the feature's workstream issue** — decisions and why, alternatives
rejected, gotcha candidates — so the batched pass inherits the session's
context. Process PRs get no harvest. This is distinct from a one-off
"remember this" (immediate targeted persistence), which never waits for a
batch.

**Workstream tracking.** Every unit of work — feature, bugfix, doc harvest —
has a GitHub issue as its spine, tracked on a private Project board and kept
current via `stage:`/`waiting:`/`mode:` labels — with **two** exceptions.
*Sensitive/disclosure-carve-out work* never becomes a public issue and is a
private draft Project item instead. *David's Replit fast-lane tweaks* —
display-only UI changes he makes himself during UAT — carry no issue at all:
the retrospective sweep is their accountability rather than the Project board,
so no agent should demand one for a fast-lane commit retroactively (boundary
and sweep:
[`docs/ai-context/replit-environment.md`](../../docs/ai-context/replit-environment.md)).
What that sweep *finds* is ordinary work and gets an issue like anything
else. Read
[`docs/ai-context/workstream-tracking.md`](../../docs/ai-context/workstream-tracking.md)
before opening or reviewing a PR — it covers the label conventions and what
must never happen (e.g. `Closes #N` in a PR body, which would skip UAT).

When asked to **plan**:
1. Inspect the repo first.
2. Identify source-of-truth boundaries.
3. Call out product ambiguities (ask David; don't guess intent).
4. Propose a phased plan.
5. Include tests and migration/backfill handling where relevant.

When asked to **implement** (an approved plan):
1. Re-read the approved plan + relevant `docs/ai-context/` files.
2. Confirm the affected files.
3. Make the smallest coherent change.
4. Run relevant tests.
5. Summarize what changed, what was tested, and what remains risky.

## Technical priorities

Prefer, in order:
1. Runtime correctness.
2. Durable data and source-of-truth boundaries.
3. Repository fit.
4. Migration and backfill safety.
5. Security, validation, permissions, and auditability.
6. Admin UX clarity.
7. Tests and regression protection.
8. Simplicity and scope control.
9. Observability and debuggability.

## Important product principles

- **Human-moderated decisions must not be silently overwritten by AI reprocessing.**
- **Runtime behavior must match admin preview and debug surfaces.**
- **Avoid duplicate sources of truth.**
- **Do not patch only the latest example — solve the general mechanism.**
- **Prefer database-backed config for tunable operational settings.**
- **Migrations must be idempotent and observable.**
- **Async work must show status** at two altitudes (per-item + aggregate) — see
  [`docs/ai-context/async-ui-status.md`](../../docs/ai-context/async-ui-status.md).
- **Ship the surface with the behavior** (no dead UI, no invisible backend), and
  **enforce every permission server-side.**
- Pre-launch: features ship **on-by-default, no rollout flags**; **no new external
  vendors** without David's sign-off.

## Planning standard

For non-trivial implementation work, create or update a plan using
[`.agents/PLANS.md`](../PLANS.md). **Do not begin implementation until David
approves the plan.**

**Reviewing a plan (not code).** When asked to review a pull request whose title
is prefixed **`[PLAN REVIEW]`** (a plan document, not a code diff), apply the
[plan-review contract](../../docs/ai-context/plan-review-contract.md): review the
markdown as an implementation *specification* against the PR body's stated intent
and the repo, return a **complete** assessment even when nothing is critical, and
never implement anything on that PR. **Status labels are a full-document-surface
concept only** (never approval language there either — only David approves); on
your actual GitHub review transport you don't compute or post one — see the
contract's *Output* section for what you do instead.

**On a re-review, the diff is not the scope.** Round 2 onward you are shown a
markdown diff of the plan — re-read the *whole* plan and re-verify it against the
repo anyway, reconcile every finding you raised earlier (Resolved / Still open /
Superseded, where "the wording changed" is never Resolved), attack from a lens
you haven't used yet, and report what you actually inspected — including the
searches you ran — plus what you could not verify and why. **On your actual
GitHub review transport, most of this is carried inside individual findings,
not a separate report** — the contract's *Re-reviews*, *Report what you
verified*, and *Output* sections are the full, surface-scoped rules; this
paragraph is a summary, not the authority.


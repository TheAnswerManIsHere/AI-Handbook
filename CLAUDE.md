# Working agreements for AI-Handbook (Claude Code)

@core/.agents/core/claude-core.md

## What this repo is

The shared working contract for every product David builds with AI agents. It
ships no product. Its payload — `core/` — is vendored into each consumer repo
by the sync described in [`docs/consuming-repos.md`](docs/consuming-repos.md),
and `sync-manifest.yml` is the single declaration of what goes where.

This repo governs itself with the same file it ships: the import above is the
handbook's own core, read from the payload. If a rule is uncomfortable to work
under here, that is the cheapest possible signal that it is wrong everywhere.

## The one rule specific to this repo

**A change here lands in every product.** That is the whole point and the whole
risk. So:

- **Blast radius is the fleet, not the diff.** A one-line edit to
  `claude-core.md` changes how I behave in every repo, on every future session.
  Weigh it as such — the internal tier's low ceremony is about *review rounds*,
  not about care.
- **The payload is data, not this repo's own configuration.** Editing
  `core/.claude/settings.template.json` does not change this repo's settings; it
  changes what the next repo is seeded with. Same for the guard and the skills.
  Nothing under `core/` takes effect here except by import.
- **Adding a file to `core/` is only half the change.** If it is not in
  `sync-manifest.yml` it never travels, and the sync reports success anyway.
  `node scripts/check-manifest.mjs` is what makes that loud; it runs in CI and
  should be run before pushing.
- **Where a rule lives is a decision, not a formality.** Fleet rule → the core
  here. Product rule → that product's overlay. Rationale and history → the
  product's `decisions.md`. The test is in
  [`docs/porting-notes.md`](docs/porting-notes.md): would this still be true,
  unchanged, in a repo about a different product?

## Ceremony

**Internal tier**, per the core's review-loop rules: a clean automatic review
pass is the whole ceremony, and rounds 3+ findings go to the adjudicator before
anything is written. Findings that are not critical ship as recorded gaps.

Two carve-outs from the core still apply and are worth naming because this repo
is made almost entirely of them: **a change that widens my own guardrails or
authority is David's merge, not mine** — here that means `core/.claude/guard.sh`,
`core/scripts/guard-decision.mjs`, `core/.claude/settings.template.json`, and any
edit to `claude-core.md` or `agents-core.md` that grants me latitude I did not
have. I flag these David-merge-only at open. If I am unsure whether an edit
widens authority, it does.

## Verifying

```
node --test scripts/__tests__/*.test.mjs   # the machinery's own tests
node scripts/check-manifest.mjs      # every payload file is actually routed
node scripts/check-identity-sources.mjs  # every identity touchpoint classified
node scripts/check-root-wiring.mjs   # this repo actually reaches its payload
```

Both run in CI on every PR. There is no product build here and no database.

## How this repo reaches its own payload

`.claude/skills/<name>` and `.claude/agents/<name>.md` are **symlinks into
`core/`**, one per entry. That keeps one copy — duplicating the payload here to
get slash commands would create exactly the second source of truth this repo
exists to eliminate — while still letting Claude Code load them, since a
`<skill-name>` entry being a symlink is documented behaviour. A symlink at the
`skills` *directory* is not documented, and would fail silently as "no skills
here", so the wiring only uses the shape that is specified.

`node scripts/check-root-wiring.mjs` fails in both directions: a payload entry
with no root link, and a root link that dangles, duplicates, or points outside
`core/`. **Adding a skill to the payload is only half the change**, the same
way adding a file to `core/` is only half a sync change.

Two things are deliberately NOT symlinks:

- **`.claude/settings.json`** is this repo's own, adapted from
  `core/.claude/settings.template.json` — which is a seed for the next
  consumer, not configuration that takes effect here.
- **`.agents/receipts/.gitignore`** is a real file, mirrored rather than
  pointed at, because **git does not follow a symlinked `.gitignore`** — its
  patterns would never apply and every ephemeral receipt would be committed.
  The root-wiring check compares the two copies' pattern lines.

**Enrollment is not finished: `.claude/settings.json` does not exist yet**, so
none of the `PreToolUse` hooks are installed and **the merge, review-budget and
destructive-command guards are inactive in an AI-Handbook session.** The
machinery mints receipts; nothing consumes them at the hook level. The file is
David's to add — writing it is refused by the harness classifier, which is that
rule working, since it widens the agent's own guardrails. Its content is in
PR #10. Until it lands, treat every guarantee below as describing the shape the
wiring takes, not a control that is running.

When it does land, the guard hooks name `core/.claude/guard.sh` **directly**
rather than through a link at `.claude/guard.sh`. `guard.sh` finds its decision script relative to
`$BASH_SOURCE`, which is the path as invoked, not the resolved target — so
through a link it would look for `scripts/guard-decision.mjs` at the root,
`node` would exit 1, the harness would read that as a hook error, and **the
tool call would proceed**. A guard that fails open is worse than no guard.

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
node scripts/check-manifest.mjs    # every payload file is actually routed
```

Both run in CI on every PR. There is no product build here and no database.

## Known rough edge

The skills in `core/.claude/skills/` are payload, not active skills in this
repo — Claude Code loads skills from `.claude/skills/`, and duplicating them
here to get slash commands would create exactly the second source of truth this
repo exists to eliminate. So a session working *on* the handbook has the core
rules (via the import above) but not the skill commands. Live with it, or fix
it properly with a mechanism that keeps one copy.

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
- **The payload is data, with three named exceptions.** Editing
  `core/.claude/settings.template.json` does not change this repo's settings; it
  changes what the next repo is seeded with, and this repo's own
  `.claude/settings.json` is a separate file. But `core/` is no longer inert
  here, and the activation model has to be stated exactly or a reviewer will
  judge a change to it as consumer-only when it also changes this repo:
  **skills** and **agents** are live here, reached by per-entry symlink from
  `.claude/`, and **`guard.sh`** is named directly by this repo's hooks once
  those hooks are installed. Everything else under `core/` still reaches this
  repo only by import — the `@core/.agents/core/claude-core.md` line at the top
  of this file. See *How this repo reaches its own payload* below.
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
node scripts/check-settings-fields.mjs   # no settings field Claude Code would refuse
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
  consumer, not configuration that takes effect here. What was adapted:
  `env.DATABASE_URL` dropped (no database), the `drizzle-kit` deny entries
  dropped (no Drizzle) while `Read(**/.env*)` is kept because it applies
  everywhere, and `model` kept as `opus` since this repo is almost entirely
  payload code. The hook paths also differ and must: a consumer's guard lands
  at `.claude/guard.sh`, while here it stays in the payload at
  `core/.claude/guard.sh` — see above.

  **Neither settings file may carry a field Claude Code does not recognise**,
  and that is stricter than the published schema — which declares
  `"additionalProperties": {}` and would permit unknown keys. Both files once
  documented themselves in a `_comment` array; the validator refuses the file
  over exactly that, and a refused file installs no `hooks`, which means no
  guard with nothing saying so. `node scripts/check-settings-fields.mjs` is
  what makes that loud. The prose those blocks held now lives where whoever
  adapts the file will actually read it: the adaptation record above, and
  [`docs/consuming-repos.md`](docs/consuming-repos.md) step 6 for a consumer's
  copy.
- **`.agents/receipts/.gitignore`** is a real file, mirrored rather than
  pointed at, because **git does not follow a symlinked `.gitignore`** — its
  patterns would never apply and every ephemeral receipt would be committed.
  The root-wiring check compares the two copies' pattern lines.

**Enrollment is complete: `.claude/settings.json` exists**, so the three
`PreToolUse` hooks are installed and the merge, review-budget and
destructive-command guards run in an AI-Handbook session. The machinery mints
receipts *and* something consumes them.

**The condition on that is closed** (issue #11). `guard-decision.mjs` decided
whether it was invoked directly by comparing `import.meta.url` against a
hand-built `file://` string. Those differ whenever the checkout path needs
escaping — a space, a `#` — and the script then exited 0 having evaluated
nothing, which `guard.sh` reads as **allow**. It now compares
`pathToFileURL(process.argv[1]).href`, which encodes exactly as
`import.meta.url` does, and a static check in each suite refuses the old form.
Measured both ways from a directory whose name contains a space: a bare
`git push -f origin main` returned 0 before and returns 2 now.

The hooks invoke the guard as
`bash "${CLAUDE_PROJECT_DIR}/core/.claude/guard.sh"`, and **every part of that
is load-bearing.**

**Absolute, via the placeholder**, because a hook command resolves against the
*current working directory*, not the project root. A relative
`bash core/.claude/guard.sh` works only while the cwd happens to be the root:
from `core/` it resolves `core/core/.claude/guard.sh`, bash exits 127, and
`PreToolUse` treats every non-zero exit **other than 2** as non-blocking. One
`cd core` silently disarmed all three guards at once.

**Pointing at the payload** rather than a link at `.claude/guard.sh`, because
`guard.sh` finds its decision script relative to `$BASH_SOURCE` — the path as
invoked, not the resolved target — so through a link it would look for
`scripts/guard-decision.mjs` at the root, and `node` would exit 1.

Both are the same shape, and it is the shape that matters: **a guard that
cannot launch does not refuse, it waves the call through.** A guard that fails
open is worse than no guard. The escaping defect above was a third instance,
and closing it closed a route rather than the shape: `guard.sh` still reads
**any** non-2 exit as allow, so the next way a verdict fails to be produced
fails open the same way. That is issue #16, and it wants the hook protocol
changed — a sentinel on the allow path, so "ran and allowed" is
distinguishable from "never ran". It should land before the `guard` group
unstages.

# Working agreements for AI-Handbook (Claude Code)

@core/.agents/core/claude-core.md

## What this repo is

The shared working contract for every product David builds with AI agents. It
ships no product. Its payload — `core/` — is vendored into each consumer repo
by the sync described in [`docs/consuming-repos.md`](docs/consuming-repos.md),
and `scripts/sync.mjs` copies `core/**` into place, one rule with one
exception for seeded files.

This repo governs itself with the same file it ships: the import above is the
handbook's own core, read from the payload. If a rule is uncomfortable to work
under here, that is the cheapest possible signal that it is wrong everywhere.

## The one rule specific to this repo

**A change here lands in every product.** That is the whole point and the whole
risk. So:

- **Blast radius is the fleet, not the diff.** A one-line edit to
  `claude-core.md` changes how I behave in every repo, on every future session.
  Weigh it as such. The internal tier says only what is downstream, and the
  two-review limit says how long iteration runs; **neither is about care**, and
  this line used to read as though a lighter tier bought fewer rounds.
- **The payload is data, with two named exceptions.** Editing
  `core/.claude/settings.template.json` does not change this repo's settings; it
  changes what the next repo is seeded with, and this repo's own
  `.claude/settings.json` is a separate file. But `core/` is not inert here,
  and the activation model has to be stated exactly or a reviewer will judge a
  change to it as consumer-only when it also changes this repo: **skills** and
  **agents** are live here, reached by per-entry symlink from `.claude/`.
  Everything else under `core/` reaches this repo only by import — the
  `@core/.agents/core/claude-core.md` line at the top of this file. See *How
  this repo reaches its own payload* below. (There used to be a third
  exception: `guard.sh`, named directly by this repo's `PreToolUse` hooks. The
  guard, the hooks and the exception all went in the #89 cut, #94.)
- **Adding a file to `core/` ships it.** The sync routes `core/**` by
  construction, so there is no routing table a new file can fall out of — this
  used to be a real hazard guarded by a 1,176-line checker, and it is now
  impossible rather than checked. The flip side is that there is no staging
  left to hide behind: a payload file that merges here reaches every consumer
  on the next sync, so "not ready to ship" and "not ready to merge" are the
  same judgement.
- **Where a rule lives is a decision, not a formality.** Fleet rule → the core
  here. Product rule → that product's overlay. Rationale and history → the
  product's `decisions.md`. The test is in
  [`docs/porting-notes.md`](docs/porting-notes.md): would this still be true,
  unchanged, in a repo about a different product?

## Ceremony

**Internal tier**, per the core's review-loop rules: a clean automatic review
pass is the whole ceremony, and a round that returns findings gets two
independent assessments before anything is written for it. How long iteration
runs is not the tier's to say — it is the **two-review limit**
([`working-modes.md`](core/docs/ai-context/working-modes.md#the-two-review-limit-on-autonomous-iteration-david-2026-09-19)),
which this section stated nowhere until 2026-09-20 while being the section a
reader consults to learn how much loop a PR here gets. **Nor is "internal"
settled once for this repository.** The limit is scoped by consequence and
asked per change, and this repository's payload contains the machinery that
publishes to every consumer and the settings template carrying
`permissions.deny` — both outside the limit on their consequences, whatever
directory they sit in. What each finding is
worth is decided by
[`review-judgment.md`](core/docs/ai-context/review-judgment.md), which sets no
target rate in either direction; the tier says only that nobody's money or data
is downstream. (This paragraph used to say findings that are not critical ship
as recorded gaps — the decline quota #96 retired — and that #96 would rebuild
the external adjudicator the #89 cut removed. It replaced it instead, with a
shared judgement that advises rather than rules.)

The core's guardrail-and-authority carve-out is **retired** (David,
2026-09-14), and this repo is where that bites hardest, since it is made almost
entirely of such files: `core/.claude/settings.template.json`, and any edit to
`claude-core.md` or `agents-core.md` that grants me latitude, now ship under
the same bar as everything else. What survives is the naming: the PR body and
the merge report each carry one line saying what latitude the change grants me,
so a widening is read rather than clicked. The harness classifier may still
refuse an in-place edit it reads as a guardrail; that layer is the platform's,
and the change goes as a PR either way.

## Verifying

```
node --test scripts/__tests__/*.test.mjs        # the machinery's own tests
node --test core/scripts/__tests__/*.test.mjs   # the payload's tests
node scripts/sync.mjs --to <repo> --dry-run     # what a consumer would receive
node scripts/check-root-wiring.mjs              # this repo actually reaches its payload
node scripts/check-settings-fields.mjs          # no settings field Claude Code would refuse
node scripts/check-agent-models.mjs             # every role named for a model declares it (--fix)
```

Both jobs run in CI on every PR. There is no product build here and no
database. Three checks used to stand in this list and were removed by the #89
cut: `check-identity-sources.mjs` (identity now enters in one place,
`core/scripts/machinery.mjs`), `check-contract-consistency.mjs` (the
retired-phrase guard — #92 de-duplicates the rulebook instead) and
`check-claude-md-budget.mjs` (the size pin, which never once refused growth
because the commit that grew the file re-pinned it).

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
  dropped (no Drizzle) while the dotenv read-deny is kept because it applies
  everywhere, and `model` kept as `opus` since this repo is almost entirely
  payload code. The hook paths used to differ and had to; there are no hooks in
  either file now, so the two differ only in the lines above.

  **Neither settings file may carry a field Claude Code does not recognise**,
  and that is stricter than the published schema — which declares
  `"additionalProperties": {}` and would permit unknown keys. Both files once
  documented themselves in a `_comment` array; the validator refuses the file
  over exactly that, and a refused file applies none of its contents —
  including `permissions.deny`, which is where the template refuses
  `drizzle-kit push`. `node scripts/check-settings-fields.mjs` is what makes
  that loud. The prose those blocks held now lives where whoever adapts the
  file will actually read it: the adaptation record above, and
  [`docs/consuming-repos.md`](docs/consuming-repos.md) step 5 for a consumer's
  copy.
- **`.agents/receipts/.gitignore` and `.agents/reviews/.gitignore`** are real
  files, mirrored rather than pointed at, because **git does not follow a
  symlinked `.gitignore`** — their patterns would never apply and every
  ephemeral dispatch receipt and plan-round snapshot would be committed. The
  root-wiring check compares each pair's pattern lines.

## The guard is gone, and what that changed

There were three `PreToolUse` hooks here, all invoking `core/.claude/guard.sh`:
a destructive-command guard, a review-request guard and a merge gate. The #89
audit cut all three (#94, #97), and this section is what is worth keeping from
the two hundred lines that used to explain them.

**What replaced them is server-side.** A branch ruleset on `claude/**` blocks
force pushes; the `main` ruleset blocks them too and now also requires
conversation resolution, which is what makes the Merge button inert while a
review thread is open. Neither can fail open, neither can be disarmed by a
`cd`, and neither is a parser. `drizzle-kit push` is still refused by
`permissions.deny` in the template.

**Issue #16 is closed by the removal, and its lesson is not.** #16 asked for a
sentinel on the hook's allow path, because `guard.sh` read **any** non-2 exit
as allow — so every new way of failing to produce a verdict failed open the
same way. It was gating the first real sync. There is no hook to fix now, but
the shape it named outlived it: **a control that cannot evaluate must refuse,
and one that reports success having evaluated nothing is the worst available
failure.** Three instances are on file here (#11, #16, #59). The one mechanical
descendant that survives is the entry-point check — `pathToFileURL(process.argv[1]).href`
rather than a hand-built `file://` string, which differ whenever the checkout
path needs escaping (a space, a `#`), and a script that never runs exits 0.
Both suites refuse the old form: `scripts/__tests__/entry-point-comparison.test.mjs`
for this repo's scripts and `core/scripts/__tests__/entry-point-comparison.test.mjs`
for the payload's, since neither can see the other's directory.

**Enrollment is complete: `.claude/settings.json` exists**, which now means its
permissions apply rather than that its hooks are installed.

# Porting notes — the first extraction

What was taken from Overhype.me on 2026-08-31, what was left behind, what was
changed on the way, and what is knowingly unfinished. Kept as a record because
the next extraction (or the first argument about where a file belongs) will
want the reasoning, not just the result.

## The test used to split

For each file: **would this still be true, unchanged, in a repo about a
different product?**

- Yes → handbook.
- No → stays with the product.
- "Yes, but it cites the product as an example" → handbook, example intact.
  Worked examples are how these documents teach. `known-failure-patterns.md`
  says so in its own header: each pattern is stated generally, then grounded
  in something that actually happened. Stripping the grounding to make the file
  look portable would remove the half that makes a pattern recognizable.
  Cross-product examples read fine — a DojoOS session benefits from knowing an
  Overhype migration is what proved the rule.

Where the call was genuinely close, the file **stayed with the product**. A
missing generic file is a small, fixable gap; a product-specific file synced
into an unrelated repo is noise that erodes trust in everything around it.

## What came across

| Group | Count | Note |
|---|---|---|
| Skills | 36 | Everything except the six `overhype-*` skills and `domain-modeling`, which encode product knowledge |
| Contracts (`docs/ai-context/`) | 8 | Working rules, modes, planning, plan review, documentation, workstream tracking, failure patterns, web research |
| Engineering practice | 1 | `code-review.md` |
| Memory entries | 34 | Of 65 — see below |
| Machinery scripts | 11 (+9 test files) | Review loop, readiness, project sync, guard |
| Agent definitions | 3 | Including the review-loop adjudicator |

Counts are as they stand after the review corrections below — the first cut
took two agent-environment docs and a migrations doc that had to go back, and
gained one memory entry the core links to.

## What was changed on the way

Only structural couplings — references that would be *wrong* in another repo,
as opposed to merely mentioning Overhype:

- **Named product skills → the role they play.** `overhype-plan-review` →
  "the product's plan-review skill"; likewise for the design and implementation
  skills. A consumer repo has a skill in that role under its own name.
- **"Overhype.me adaptations" → "Local adaptations"**, and
  "Local calibration (Overhype.me, …)" → "(fleet, …)". These calibrations were
  never about the product — they are about how the agents behave, and they
  apply everywhere.
- **Sensitive-subsystem list → a pointer to the overlay.** The core's ceremony
  rule said "migrations/auth/payments/visual-pipeline"; the visual pipeline is
  one product's subsystem. It now reads "any subsystem the overlay marks
  sensitive", and each repo names its own.
- **Relative links repointed** for the core files' new depth
  (`.agents/core/` is two levels down from the repo root).

Everything else — every `**Overhype:**` worked example, every cited file path
inside an example, every dated measurement — was left exactly as written.

## What stayed with Overhype, and why

**Product docs** — brief, direction, roadmap, architecture map, glossary,
`decisions.md`, and every subsystem doc (visual pipeline, taxonomy, moderation,
token rendering, accounts, security model, membership, public site, admin
console, community, legal/safety, the Stripe audit pair). These are the
product.

**Product skills** — the six `overhype-*` skills, plus `domain-modeling`, which
is about sharpening one product's domain model.

**32 memory entries** whose subject is Overhype's own code or stack: the Stripe
entries, taxonomy and canvas entries, `api-zod` codegen, `lib/db` staleness,
the test-isolation quartet (they describe Overhype's specific test database
setup), the Replit-push and Repl-install entries, admin-config typing,
auth cookie fallback, the CodeQL entry (it is about *this repo's* hand-rolled
controls), and the two Manual entries (the in-app help system is Overhype's).

**Four `scripts/check-*` guards** — `check-budget-gate-thunk`,
`check-budget-gate-unconditional`, `check-record-cost-unconditional` and
`check-return-to-parity`. These look like process machinery by name but are
product-code guards: they scan `artifacts/api-server/src` or import Overhype
source directly. They would fail on any other repo.

## Knowingly unfinished

**The machinery and guard groups are `staged` — they do not sync.**

`review-budget.mjs` declares the repo identity as two hardcoded literals:

```js
export const REPO_OWNER = "TheAnswerManIsHere";
export const REPO_NAME  = "Overhypeme";
```

Six call sites across `review-budget.mjs` and `review-loop-record.mjs` use them
to verify that a snapshot, receipt or merge actually targets the expected repo
— a real check, not decoration: it is what stops a receipt minted for one repo
from authorizing an action in another. `guard-decision.mjs` carries the same
identity for the merge guard.

Making that per-repo is a **security-relevant change to the receipt and guard
machinery**, and under the internal tier's own rubric that is precisely the
category that earns a careful, separately reviewed change. It gets its own PR
rather than riding along inside a 180-file move, where nobody would see it.

Until that lands, these scripts are correct for Overhype and would be actively
wrong in DojoOS — hence `staged`, which the sync skips and the manifest check
requires a stated blocker for. The identity resolution must **fail closed**: a
guard that cannot determine which repo it is protecting has to refuse, not
default. `.agents/memory/ci-guard-must-fail-loud-on-missing-inputs.md` is the
entry that says why, and it came across in this port.

**A second coupling, found by running the payload's own tests here.** Of the
599 machinery tests, 598 pass in this repo; the one that fails is
`check-contract-consistency`'s assertion that its scanned corpus includes
`CLAUDE.md`. That guard assumes the contract sits in one file at the repo root
— true in a consumer, false the moment the contract is split into a vendored
core plus an overlay, which is the split this repo introduces. So the guard
needs to learn about both surfaces, and that belongs in the same reviewed
change as the repo identity. Recorded rather than patched here: a one-line
path tweak to a consistency guard, made in passing inside a 180-file move, is
exactly the kind of edit that gets waved through.

The other two failures seen on the first run were not findings — they were the
receipt scaffolding gap above, and they went green once it was ported and
committed. Worth noting for the shape of it: they failed while the files
existed in the working tree and passed only after the commit, because the
machinery reads that path out of a committed ref. The suite was demonstrating
the very rule the receipts README states.

## Corrected after review

Codex's first round found four real problems, three of them one problem wearing
different hats. Recorded here because the underlying mistake is easy to repeat.

**Readiness is transitive, and the first cut ignored that.** Groups were marked
ready or staged by *what the files were* rather than by *what they depend on*.
So `contracts` shipped ready while prescribing procedures that invoke the
staged machinery; `agent-definitions` shipped the adjudicator whose only
permitted input is a record the staged machinery generates; and worst,
`settings-template` shipped ready with three hooks invoking a guard from the
staged `guard` group **and** `defaultMode: bypassPermissions` — a consumer
would have been seeded with permission bypass and no guard, strictly worse than
being seeded with nothing.

Fixed as a mechanism rather than three relabelings: groups now declare
`requires:`, and the manifest check refuses a `ready` group that requires a
staged one. The relabeling then follows from the rule instead of from judgment,
and the same mistake cannot be made silently again. The honest consequence is
that 7 of 12 groups are now staged behind the machinery — which makes the
repo-portability work a **prerequisite** for the sync rather than a preference,
not a nice-to-have to schedule later.

**The two agent-environment docs were wrongly taken.** `codex-environment.md`
instructs the Codex UI to run `scripts/codex-setup.sh` — a file that was never
in the payload — and hardcodes Overhype's pnpm packages and suite counts;
`replit-environment.md` names Overhype's session hook and its `heliumdb`
database. Both were included on the strength of a low count of the string
"Overhype", which measured the wrong thing: **product coupling is not the same
as product mentions.** They are now consumer-owned, listed as required consumer
documents in `consuming-repos.md`, and the synced files that link to them
resolve in a consumer.

**The destination-uniqueness check did not check what it claimed.** It compared
declared roots, so `dest/` and `dest/x.md` looked distinct while both wrote
`dest/x.md`; the sync would have let copy order pick a winner under a gate
asserting uniqueness. It now resolves and compares per-file destinations.

One more, self-inflicted while fixing the above and worth the same treatment:
the manifest reader took `requires: [machinery]` as the *string* `"[machinery]"`
and iterated it character by character, producing eleven confident, wrong
problems. It now refuses flow syntax outright. The test that was supposed to
cover this had been passing on a bad indent in its fixture rather than on the
flow sequence — a reminder that a passing test proves nothing until you know
which assertion carried it.

## The second round, and what it says about the first

Round 2 returned nine findings. Two were my own round-1 fixes being incomplete;
five were more payload files with the same portability problem round 1 had
already found once. That repetition is the finding worth recording.

**The portability pass was shallow, and iterating through review rounds is an
expensive way to discover that.** So the response was an audit rather than five
more edits: every payload file was grepped for references to paths, packages
and commands that do not exist in the payload, and each hit judged by one
question — **does this file tell the reader to DO something with that path, or
cite it as evidence of something that happened?** Evidence stays; instruction
does not, because an agent follows instructions.

That test would have caught all of them the first time, and it is the test to
use on the next extraction. What it removed:
`docs/engineering/migrations-and-backfills.md`, whose opening lines say schema
lives in `lib/db/src/schema/*.ts` and to apply it with
`pnpm --filter @workspace/db push-force`. What it left alone: the memory
entries citing `artifacts/api-server/src/...` in a write-up of something that
went wrong, which are grounding, not orders.

Three more files had **normative** text naming the product rather than
prescriptive commands, which is the same error in a quieter register:
`plan-review-contract.md` said the contract applies when reviewing a plan "for
Overhype.me" — read literally in DojoOS, that says the plan-review procedure
does not apply there; `workstream-tracking.md` hardcoded one product's Project
board; `documentation-workflow.md` defined the harvest as writing the
Overhype.me Manual. All three now name the consuming repo's product.

**The ownership banner is now real.** `consuming-repos.md` promised that every
synced file carries a header warning that local edits are lost. Two files had
one. 140 now do, inserted after YAML front matter where skills have it, so a
skill's `name`/`description` still parse. A promise in documentation that the
artifacts do not keep is worse than no promise: it is what an agent relies on
before editing.

## The decision that ended the loop (David, 2026-09-01)

Three review rounds returned 5, then 9, then 7 findings, with the
portability class holding at 3, 5, 5. Each pass caught a *category* and the
next round found a different one — first product names, then paths and
commands, then normative scope clauses and unconditional environment
assertions buried in retrospective notes. Two pre-registered flip conditions
tripped, and the loop stopped rather than attempting a fourth sweep.

**David's call: merge the structure with every group staged, then unstage
group by group.** Nothing syncs to any consumer on this merge. What lands is
the repo, the manifest, the check, and the payload — parked, with each group
naming the portability work that has to happen before it can travel.

The reasoning, kept because it generalizes: **179 files of prose written for
one product over months do not become portable by sweeping them.** A sweep
finds the category it was designed to find. Each file becomes portable by
being read and rewritten with one question in mind, and that is per-file work
with a finish line — not a pass over a corpus. Staging converts an
open-ended review loop into discrete, reviewable units.

### How a group gets unstaged

One PR per group. It does three things:

1. **Applies the instruction-vs-evidence test to every file in the group** —
   does this file tell an agent to DO something with a path, command, package,
   board, workflow or subsystem that may not exist in the consuming repo, or
   does it cite one as evidence of something that happened? Evidence stays.
   Instruction is rewritten to name the consuming repo's equivalent, made
   conditional, or moved out of the payload entirely.
2. **Clears the group's `blocker:` in the manifest and flips it to `ready`** —
   the check refuses `ready` while a required group is staged, so the
   dependency order enforces itself.
3. **States what was inspected**, so the next group's PR is not re-deriving
   the test.

The blockers in `sync-manifest.yml` are the queue. They are written to be
actionable: each names the specific files and the specific problem, not a
category.

### The order that falls out of the dependencies

**Corrected again after round 7, and this time derived rather than written.**
The order below is no longer maintained by hand: `check-manifest` reads the
links in every payload file, maps each target to the group that delivers it,
and fails when a group references another group it does not require. Three
rounds had corrected this graph by hand and the check found five more edges
none of them had — including `guard` → `machinery`, which the previous version
of this section got exactly backwards.

**What the derived graph says, and it is not what the plan assumed:** five
groups — `contracts`, `engineering`, `memory`, `planning`, `skills` — form a
single dependency cycle. They are not a sequence and cannot be unstaged one at
a time. That is 3 contract files, 1 engineering doc, 34 memory entries,
`PLANS.md` and 36 skills flipping in one PR, because each of the five carries
mandatory references into the others. The corpus is densely cross-linked, and
the per-group decomposition the staging plan assumed does not exist for its
middle. Whether to flip all five at once or to cut some of the cross-links
first is a real decision, and it belongs to whoever takes the next PR.

The remainder still decomposes cleanly:

1. **`machinery`** — depends on nothing.
2. **`guard`** — requires `machinery`, which was wrong in every earlier version
   of this document. `guard-decision.mjs` statically imports `pr-ready.mjs` and
   `review-budget.mjs`; delivered without them the hook exits
   `ERR_MODULE_NOT_FOUND` before evaluating any command, so it fails instead of
   guarding. Reproduced by assembling a consumer layout with the guard payload
   alone.
3. **The five-group cycle**, in one PR.
4. **`agents-core`**, `receipt-scaffolding`, `agent-definitions`,
   `settings-template` — each waits on one of the above.
5. **`claude-core` last**, requiring seven groups.

The superseded prose is kept below because the reason it was wrong is the
lesson, not the order itself.

---

**Written after round 5** — this replaced an earlier version that
called `planning` and `engineering` independent. They are not, and the reason
is worth keeping: the earlier order was written from what each group *is*
rather than from what its files *route to*, which is the same mistake the
`requires:` mechanism was added to prevent. Reading the links instead of the
labels produces a different shape.

1. **`machinery` and `guard`.** No dependencies. They carry the hardcoded repo
   identity, they block six other groups, and they are the only groups whose
   blocker is code rather than prose.
2. **`memory`.** Independent — an entry-by-entry audit, nothing else.
3. **`contracts` + `planning` + `engineering`, in ONE PR.** These three are a
   dependency cycle, not a sequence: `engineering`'s code-review.md delegates
   its oracle and stopping rule to `contracts`; `contracts` routes to
   `.agents/PLANS.md` in `planning` from three separate files; and `planning`
   cites both of the others in its own preflight. No ordering of three separate
   PRs satisfies it, because each one would ship with a mandatory reference to
   a group still staged. The check evaluates the manifest's final state, so
   flipping all three in one commit passes and any subset fails — which is the
   cycle behaving as a constraint rather than as a bug.
4. **`agents-core`** (needs contracts + planning) and **`skills`** (needs
   machinery + contracts) follow, plus `agent-definitions`,
   `receipt-scaffolding` and `settings-template` once their single dependency
   has landed.
5. **`claude-core` last.** It requires seven groups, which is every other group
   except `agent-definitions`, `receipt-scaffolding` and `settings-template`.

A cycle here is not a modelling failure. It is what a genuinely interdependent
contract looks like, and the honest encoding is the one that refuses to let any
member ship alone.

## Not yet built

- **The sync workflow itself.** This PR establishes the payload and the
  manifest that describes it; the automation that reads the manifest and opens
  pull requests in consumers is the next PR.
- **Repo-portable machinery.** As above.
- **Consumer overlays.** DojoOS's `CLAUDE.md`/`AGENTS.md` overlay, and
  Overhype's migration from local copies to vendored ones. Overhype goes last
  deliberately: it is the running contract, and its diff has to be provably
  content-identical before its local copies are deleted.

## The third round of the same lesson (round 5, 2026-09-01)

Round 5 returned fourteen findings on a head that rounds 1–4 had already
worked over. Every one was verified against the files before being acted on,
and every one was correct. They fell into four groups, and the split is the
useful part of the record:

- **Five findings on the manifest's dependency graph.** `planning` needed
  `contracts` and `engineering`; `contracts` needed `planning`; `engineering`
  needed `contracts`; `agents-core` needed `planning`; `skills` needed
  `contracts`. These were not hardening — they were the load-bearing content of
  this PR being wrong, and they rewrote the unstaging order above.
- **Four on the check.** `posix.normalize("..")` is `".."`, which never matched
  the `"../"` prefix test the escape guard was built around. A key on a list
  item's dash line was invisible to the duplicate-key guard, so `- id: original`
  followed by an indented `id: overwritten` merged silently — on the one field
  that decides group identity. Emptiness was measured before exclusions, so a
  group excluding every leaf could be marked ready and satisfy a `requires`
  while delivering nothing. And a misspelled `requires` was kept by the reader
  and ignored by the gate.
- **Four on this repo's own docs**, all the same shape: describing the intended
  system as though it were the running one. The README advertised agent
  environments as shared payload and the sync as current behaviour; the
  enrolment steps ran the sync before the flip that makes a repo a sync target.
- **One on CI**, which was the largest gap: 599 payload tests existed and none
  of them ran. 581 now run on every PR. The one genuinely unrunnable file is
  excluded by name with a step that fails when the exclusion stops being
  earned, so the carve-out cannot outlive its reason.

**The pattern across five rounds, which is the thing to carry forward:** each
round found a *new category* rather than more of the last one — product names,
then paths and commands, then normative scope clauses, then unconditional
environment assertions, then a dependency graph inferred from labels instead of
links. A sweep finds the category it is looking for. What actually closed each
one was a mechanical check that could not be talked out of its answer, which is
why four of round 5's findings became parser rules and tests rather than a note
saying to be careful.

## Round 6, and the sweep that recurred one level up (2026-09-01)

Eight findings on `0a5236a`. Four were recorded against blockers rather than
fixed — payload content, staged, not shipping — and four were fixed here. Two
of the fixes are worth the record because both were defects in the *previous
round's* fixes:

- **The expiry guard did not verify what it claimed to.** Round 5 added a CI
  step that runs the one excluded payload test and fails if it *passes*, so the
  carve-out could not outlive its reason. But it branched on the exit code
  alone, and a nonzero exit proves only that something failed — an unrelated
  regression in that file would take the same branch and the step would report
  the exclusion as earned. Demonstrated with a throwaway failing test before
  fixing. It now asserts the exact shape: one failure, carrying the documented
  `not scanned: CLAUDE.md` assertion.
- **The required-consumer-documents table was a sweep.** Round 5 added three
  missing entries and I wrote that the sweep "found no fourth missing target."
  Round 6 named three more. A mechanical pass over the payload's outbound
  references finds more still. The claim was false because the oracle behind it
  was three greps for three named files — a completeness claim resting on a
  check that could only ever confirm what it was handed.

The second is the round-5 lesson recurring one level up. Rounds 1–5 established
that *payload portability* does not yield to sweeps. Round 6 shows that the
*inventory of what a consumer must own* does not either — and for the same
reason, which is that both grow as the corpus does. The fix was therefore not a
longer table but a stated rule ("any path the payload references that `core/`
does not ship is consumer-owned"), the table demoted to examples of it, and a
link-resolution check recorded as an unstaging requirement on the two groups
whose files carry the references.

**Generalised, since it has now cost six rounds:** when a finding's fix is "add
the missing entries," the next round finds more entries. The disposition that
converges is to state the invariant and queue the check that enforces it. A
list is a snapshot of a sweep; a check is the sweep run continuously.

## Round 7: deriving the graph instead of correcting it (2026-09-01)

Three findings, all on this repo's own artifact rather than the payload — the
first round with none of the payload-portability class.

Two were undeclared dependency edges (`contracts` → `skills`, `guard` →
`machinery`), which is the third consecutive round correcting this graph by
hand. Round 6's recorded lesson said what to do about that: when the fix is
"add the missing entries," state the rule and build the check. So the check got
built. It resolves every markdown link and static import in the payload, maps
each target to the group that delivers it, and fails when a group references
another it does not require, treating transitive edges as satisfied and cycles
as legitimate.

It found five undeclared edges. Two were the ones reported; three —
`contracts` → `memory`, `engineering` → `memory`, `memory` → `contracts` — had
survived every round to that point.

**And it changed the plan.** With the full graph declared, `contracts`,
`engineering`, `memory`, `planning` and `skills` are one strongly-connected
component: five groups, ~75 files, that can only go ready together. The
staging design assumed the corpus decomposed into independently shippable
units; for its middle, it does not. That is a fact about the corpus which no
amount of care in writing the manifest would have surfaced, because the
manifest is where the assumption lived.

The third finding was that `check()` validated `groups` and never `consumers`
— so a misspelled `enroled: true` would leave every consumer un-targeted, the
sync silently delivering nothing, and the build green. Now validated: known
keys, `owner/name` shape, boolean `enrolled`, no duplicates, non-empty.

**The self-inflicted bug worth recording**, because it is the same shape as the
false completeness claim in round 6: the derivation's first version skipped any
link containing `#`, and the single reference proving `planning` depends on
`engineering` carries a heading anchor. A check written to find missing edges
was silently dropping one — caught only because the prototype's output was
compared against what the rounds had already established by hand. **A new check
is not evidence until something independent agrees with it.**

## Round 8, and what a blocker is for (2026-09-01)

Seven findings. Four fixed, three recorded — and the split is now stable enough
to name as a rule rather than a per-round judgement.

**The fixes were all self-inflicted, and one of them is the useful lesson.**
Round 6 moved the enrollment flip earlier, to fix a deadlock where the sync
skipped a repo still marked `enrolled: false`. Round 7 then added two steps —
verify the branch ruleset, merge the guard hooks into an existing settings file
— and placed them *after* the flip, because that is where new steps naturally
go. The result was worse than the original bug: a repo eligible for a
merge-triggered sync before the controls constraining it existed, able to
receive `bypassPermissions` without the ruleset and an inert guard without its
hooks. Neither change was wrong on its own; the ordering invariant was
invisible because nothing stated it. It is stated now — **the flip is what
makes the sync fire, so anything that must be true before delivery goes above
it, and a step added later belongs above it too.**

The other three: the derived-dependency check read only double-quoted static
imports, so the gate's answer depended on the author's formatting; consumer
slugs were compared by raw spelling while the payload compares them
case-insensitively; and `receipt-scaffolding` carries a non-Markdown file
without owing the ownership warning its sibling groups owe.

**The three recorded findings prompted a change to the manifest's header**,
because rounds 5, 6 and 8 have each read the blockers as exhaustive inventories
and reported that a group's blocker "does not name" some further non-portable
passage. That reading is wrong, and leaving it uncorrected would grow the
blockers without bound while the payload stayed exactly as unportable as it is.
A blocker names the **category** of work with enough specificity to start from.
The payload is 179 files; enumerating every instance in the manifest would be
the sweep that staging exists to replace with per-file work.

So the rule, now in the manifest itself: **an instance is worth adding only
when it names a different category, or fails in a different way than what is
already listed.** All three of this round's were kept on exactly that test —
`working-modes.md` is normative where the recorded item was illustrative; the
lock sweeper is a script that silently never runs where the recorded items are
prose that misleads; the two skill identities fail in code, and the Sentry one
fails by *succeeding* against another product's data, which is the worst
failure shape in the set.

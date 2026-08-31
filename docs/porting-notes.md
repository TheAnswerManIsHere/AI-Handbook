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
| Contracts (`docs/ai-context/`) | 10 | Working rules, modes, planning, plan review, documentation, workstream tracking, failure patterns, web research, and both agent-environment docs |
| Engineering practice | 2 | `code-review.md`, `migrations-and-backfills.md` |
| Memory entries | 33 | Of 65 — see below |
| Machinery scripts | 11 (+9 test files) | Review loop, readiness, project sync, guard |
| Agent definitions | 3 | Including the review-loop adjudicator |

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

## Not yet built

- **The sync workflow itself.** This PR establishes the payload and the
  manifest that describes it; the automation that reads the manifest and opens
  pull requests in consumers is the next PR.
- **Repo-portable machinery.** As above.
- **Consumer overlays.** DojoOS's `CLAUDE.md`/`AGENTS.md` overlay, and
  Overhype's migration from local copies to vendored ones. Overhype goes last
  deliberately: it is the running contract, and its diff has to be provably
  content-identical before its local copies are deleted.

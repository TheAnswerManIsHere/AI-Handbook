<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead. -->

# Fable roles — a third set of eyes

> **The premise, in David's words:** he cannot review code at all, and has no
> way to know whether what is being built is good. So every bit of model
> intelligence that can be brought to bear must be — and it must reach him **in
> plain English, before he agrees, pushes, merges or closes**, not as a code
> review he cannot read.

**Codex keeps its full fix-or-decline force. Nothing here weakens it.**

## The seven roles

| | Role | Fires | Who decides |
|---|---|---|---|
| **B1** | Conformance triage | after every review round that returned findings | advisory rounds 1–2, **binding from round 3** |
| **B2** | Delta review | **before** every review re-request | advisory; a `no` saves a round |
| **B3** | Check synthesis | once, at close-out | proposes only; never blocks |
| **D1** | Plan opinion | before plan approval | **David** |
| **D2** | Merge opinion | before a carve-out merge, and in every merge report | **David** |
| **D3** | Gaps translation | when a loop stops `ship-with-gaps-recorded` | **David** |
| **D4** | Scope framing | beside every now/next/never banner and every blocking ask offering options | **David** |

## The four rules that make this different from the attempt that was retired

Per-finding Fable dispatches were retired on 2026-08-20 at **zero-for-fifteen**,
because they judged the builder's *classifications* — which is judging the
builder's prose, so a persuasive builder got a compliant judge.

1. **Every dispatch is script-assembled**, by
   [`fable-brief.mjs`](../../scripts/fable-brief.mjs), from inputs the builder
   cannot slant mid-loop: git over a pinned range, a document read with
   `git show` at a named commit, and a provenance-checked snapshot. **No text
   the session writes reaches a role**, with one declared exception: **D4**,
   whose subject *is* the builder's framing, and which receives it quoted and
   labelled as the object under review. The script refuses that input for every
   other role.
2. **A role reads the reviewer's raw finding bodies, never the builder's account
   of them.** Only a thread's first comment reaches a brief; every later comment
   is the builder replying.
3. **A touchpoint role never decides, and never reads the builder's banner
   first.** David gets two independent framings and **their disagreement is the
   signal he is paying for.** Each carries a one-line `Recommendation:`.
4. **The model is pinned in the definition and stamped into the brief** as
   `modelRequested`. An alias is refused: "it ran on 5.1" would otherwise be
   probably-true and not established. What was *served* is a separate fact the
   brief cannot know, which is why the field is not called `model`.

## The decline rule this enables

The builder may decline a Codex finding on a B1 classification **only when that
classification cites a settled decision or a threat-model entry.** No citation,
no decline — a bare reclassification would launder a decline that has no
grounds.

## Retirement is the point, not a risk

Every role is measured at `/maintenance`: findings pre-empted by B1,
self-inflicted defects caught by B2, checks synthesised by B3, and David
decisions changed by a D-role. **Any role at zero-for-fifteen is retired**, the
same way the last attempt was. A role that always finds something is padding
and will read as zero.

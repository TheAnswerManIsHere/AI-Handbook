## Bind stamps to the definition the harness actually loads
**  Bind stamps to the definition the harness actually loads**

Fresh evidence beyond the earlier stamp finding is the supported stale-checkout path: this reads `dispatch` from `snapshot.pr.head.sha`, while the named agent is loaded from the active checkout and decision 5 deliberately passes no per-invocation override. When the implementation PR changes the frontmatter but the generator is run from `main`, the record stamps `best`/`xhigh` while this repository's working-tree symlink still loads `fable` with inherited effort; a receipt copying the record then passes both validators despite the different declaration actually used. Require a pre-dispatch equality check or invoke a head-materialized definition, and test this exact stale-checkout case.

AGENTS.md reference: [AGENTS.md:L25-L34](https://github.com/TheAnswerManIsHere/AI-Handbook/blob/972b60d406acf9cbd7671b87420652c5fc06628c/AGENTS.md#L25-L34)

Useful? React with 👍 / 👎.

## Require the plan-review title before selecting the head oracle
**  Require the plan-review title before selecting the head oracle**

Detecting this mode solely from the body lets a malformed PR select an unapproved, mutable head plan as its oracle. I inspected `plan-review-loop/SKILL.md:131-141`: the repository defines plan review through both the `[PLAN REVIEW] … — DO NOT MERGE` title and this body declaration, and the snapshot already carries `pr.title`. If the title is removed or an implementation PR retains the boilerplate, decision 10's approved-plan-source check is bypassed; require both signals and refuse when they disagree. [core/.agents/core/agents-core.mdL39-L42](https://github.com/TheAnswerManIsHere/AI-Handbook/blob/972b60d406acf9cbd7671b87420652c5fc06628c/core/.agents/core/agents-core.md#L39-L42)

Useful? React with 👍 / 👎.

## Make the producer oracle find the refusal recipes
**  Make the producer oracle find the refusal recipes**

The proposed class-5 regex does not match the two `review-budget.mjs` producers it claims to cover: running it on `639266f` returns the README examples plus validator expressions, but neither recipe at lines 1580-1593 or 1607-1611 because their `kind`, `adjudication`, and `verdict` wording is split or absent. Consequently the promised grep-based test can pass while a current or future live recipe omits the stamps. Define an oracle that actually identifies all receipt-writing instructions and add a fixture proving both existing refusal branches are discovered. [core/.agents/core/agents-core.mdL109-L114](https://github.com/TheAnswerManIsHere/AI-Handbook/blob/972b60d406acf9cbd7671b87420652c5fc06628c/core/.agents/core/agents-core.md#L109-L114)

Useful? React with 👍 / 👎.

## Accept legitimate empty diffs with distinct endpoint commits
**  Accept legitimate empty diffs with distinct endpoint commits**

A head can legitimately differ from the base commit while having an empty net diff—for example, when every branch change has been reverted—whereas `base === head` is not the usual representation of an empty PR. In that state the new numstat and patch sources agree correctly that the artifact is empty, but this rule refuses record generation, so a tripwire or direct-stop flow cannot produce the record and receipt needed to close the loop. Accept a consistently empty numstat-plus-patch result with an explicit marker, and add a branch-that-reverts-to-base fixture.

Useful? React with 👍 / 👎.

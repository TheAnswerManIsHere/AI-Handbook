import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The handbook's own hygiene for the judge's dispatch declaration.
 *
 * These live HERE rather than beside the machinery's tests deliberately.
 * They read payload from several sync groups (`skills`, `claude-core`,
 * `receipt-scaffolding`, `memory`), which a consumer taking only `machinery`
 * would not have — so shipping them as payload would hand that consumer a
 * suite that fails on files it was never given. The properties they assert
 * are about THIS repository keeping one declaration in one place, which is a
 * handbook obligation, not a consumer's.
 *
 * Written as executable oracles because the affected-surface sweeps that
 * produced them were wrong three times in one review loop: a `model:`-only
 * grep, a `===`-only grep, and a producer grep that matched only what I had
 * already found by reading. A grep re-run by hand is a grep nobody re-runs.
 */

const root = new URL("../../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");

/** The leading `---` frontmatter of a markdown file, as `key: value` pairs. */
function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) return null;
  return Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .map((line) => /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line))
      .filter(Boolean)
      .map((kv) => [kv[1], kv[2].trim().replace(/^["']|["']$/g, "")]),
  );
}

test("the adjudicator's own definition declares its model and its effort", () => {
  // The single source. `best` resolves to the strongest model the account has,
  // so the judge follows the strongest tier without anyone editing a file when
  // that changes; `xhigh` is declared rather than inherited, because a judge
  // whose thinking depth tracked whatever session dispatched it is an unpinned
  // variable in a decision that gets audited.
  const front = frontmatter(read("core/.claude/agents/review-loop-adjudicator.md"));
  assert.equal(front.model, "best");
  assert.equal(front.effort, "xhigh");
});

test("no live dispatch instruction re-pins the judge's model", () => {
  // A per-invocation model outranks frontmatter, so an instruction to pass one
  // would undo exactly what the declaration above is for. Historical entries
  // that describe the retired arrangement are fine and are not matched here:
  // the pattern is the imperative form only.
  for (const rel of [
    "core/scripts/review-budget.mjs",
    "core/.claude/skills/pr-watch/SKILL.md",
    "core/.claude/skills/plan-review-loop/SKILL.md",
    "core/.claude/skills/model-routing/SKILL.md",
    "core/.agents/core/claude-core.md",
  ]) {
    assert.doesNotMatch(
      read(rel),
      /pass(ing)?\s+`?model:\s*"?fable/i,
      `${rel} still tells a dispatch to pin the judge's model`,
    );
  }
});

test("no live operator message asserts the judge's model tier", () => {
  // Rounds 1, 2 and 3 each found another instance of this, each in a file the
  // previous sweep had not reached: a message telling a person which judge
  // decided their gate, naming a tier no code pins any more. `best` resolves
  // to Opus wherever the latest Fable model is unavailable, so these
  // misreport — to David — in the artifact whose job is telling him what
  // decided his gate. A test, so the next instance is a CI failure rather
  // than a fourth review round. (#39 gap 4.)
  //
  // ENUMERATED PHRASINGS, not "any mention of the tier near the word judge".
  // Two weaker rules were tried against the real corpus first and both
  // false-positived on SESSION routing — "Fable to explore, Opus to build",
  // "staying on Fable needs a real reason" — which is a different subject
  // this test has no business policing. The known limit of enumeration is
  // that a NEW phrasing evades it; the limit of the semantic version was
  // that it flags correct prose, which is worse, because a test that cries
  // wolf gets loosened until it says nothing.
  const forbidden = [
    // "on Fable" only when the same line also names what is being routed --
    // "staying on Fable to build" is the session rule and must not match.
    /(?:dispatch\w*|adjudicat\w*|judge|subagent|review-loop-adjudicator)[^\n]{0,80}\bon Fable\b/i,
    /\bon Fable\b[^\n]{0,80}(?:dispatch\w*|adjudicat\w*|judge|subagent|review-loop-adjudicator)/i,
    /\bmodel:\s*"?fable/i,
    /\bFable[- ](?:adjudicat|recommendation|verdict)/i,
    /\bfresh Fable\b/i,
    /\bFable (?:adjudicator|adjudication|recommendation|judge)\b/i,
    /\bdispatch(?:es|ed)? on Fable\b/i,
  ];
  const operatorFacing = [
    "core/scripts/review-budget.mjs",
    "core/scripts/pr-ready.mjs",
    "core/scripts/check-contract-consistency.mjs",
    "core/.agents/receipts/README.md",
    "core/.claude/skills/pr-watch/SKILL.md",
    "core/.claude/skills/plan-review-loop/SKILL.md",
    "core/.claude/skills/model-routing/SKILL.md",
    "core/.agents/core/claude-core.md",
  ];
  // The historical exemption is judged over a CONTEXT WINDOW, not one line:
  // prose wraps, and "RETIRED (2026-08-20)" routinely sits two lines above
  // the sentence it governs. A dated record of a superseded arrangement is
  // evidence; rewriting it to match present configuration is how a decision
  // log stops being one.
  const historical = /retired|superseded|used to|deleted|no longer|2026-0[678]-\d\d/i;
  const WINDOW = 4;
  for (const rel of operatorFacing) {
    const lines = read(rel).split(/\r?\n/);
    const offending = lines
      .map((line, i) => ({ line, n: i + 1, i }))
      .filter(({ line, i }) => {
        if (!forbidden.some((re) => re.test(line))) return false;
        const context = lines.slice(Math.max(0, i - WINDOW), i + WINDOW + 1).join("\n");
        return !historical.test(context);
      })
      .map(({ n, line }) => `${rel}:${n}: ${line.trim()}`);
    assert.deepEqual(offending, [], "a live message still asserts the judge's tier");
  }
});

test("every live receipt-writing recipe teaches the stamps it will be validated against", () => {
  // The producers, not just the validators. Making the fields mandatory while
  // the repository's own examples omit them would teach consumers to write
  // receipts that fail validation — a trap, not a check.
  for (const rel of ["core/.agents/receipts/README.md", "core/scripts/review-budget.mjs"]) {
    const text = read(rel);
    assert.match(text, /modelRequested/, `${rel} must teach modelRequested`);
    assert.match(text, /effortRequested/, `${rel} must teach effortRequested`);
  }
});

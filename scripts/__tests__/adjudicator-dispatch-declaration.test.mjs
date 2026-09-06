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

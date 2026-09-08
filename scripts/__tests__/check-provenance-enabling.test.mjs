import { test } from "node:test";
import assert from "node:assert/strict";

import { check, teachesTheForm, PARSER_FILE, FORMAT_FILE } from "../check-provenance-enabling.mjs";

const manifest = (statuses) => ({
  groups: Object.entries(statuses).map(([id, status]) => ({
    id,
    status,
    paths: [{ from: `core/${id}/`, to: `${id}/` }],
  })),
});

// `ownersOf` maps a payload file to the group whose declared root covers it,
// so the fixture files below sit under the root their group declares.
const FILES = {
  "core/machinery/scripts/review-loop-record.mjs": "machinery",
  "core/contracts/plan-provenance.md": "contracts",
  "core/skills/bugfix.md": "skills",
};

function run(statuses, overrides = {}) {
  const text = {
    "core/machinery/scripts/review-loop-record.mjs": "the parser",
    "core/contracts/plan-provenance.md": "# the format\n```plan-provenance\nkind: trivial\n```",
    "core/skills/bugfix.md": "write **Tier rationale:** here",
    ...overrides,
  };
  return check(manifest(statuses), Object.keys(FILES), (file) => text[file] ?? "", {
    parserFile: "core/machinery/scripts/review-loop-record.mjs",
    formatFile: "core/contracts/plan-provenance.md",
  });
}

test("teachesTheForm recognises a producer by what it says, never by a list", () => {
  assert.equal(teachesTheForm("```plan-provenance\nkind: trivial\n```"), true);
  assert.equal(teachesTheForm("see docs/ai-context/plan-provenance.md"), true);
  assert.equal(teachesTheForm("**Tier rationale:** because Q1 fired"), true);
  // A file that merely says provenance exists is not a producer -- otherwise
  // every mention drags another group into the sequencing.
  assert.equal(teachesTheForm("the record carries the approved plan's provenance"), false);
});

test("a ready parser with a staged producer group is the refused state", () => {
  // The exact shape the manifest permits and `requires` does not catch:
  // `machinery` requires only `machinery-config`, so it can ship while the
  // skills that teach the form are still staged -- and the consumer's own PRs
  // are then refused by the parser it just received.
  const { problems, lagging } = run({ machinery: "ready", contracts: "ready", skills: "staged" });
  assert.deepEqual(lagging, ["skills"]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"machinery" is ready/);
  assert.match(problems[0], /"skills"/);
  assert.match(problems[0], /core\/skills\/bugfix\.md/);
});

test("everything ready together passes, and everything staged together passes", () => {
  assert.deepEqual(run({ machinery: "ready", contracts: "ready", skills: "ready" }).problems, []);
  // Nothing has shipped yet, which is the current state: staged is not a
  // violation, it is the window in which the form is still ours to change.
  assert.deepEqual(run({ machinery: "staged", contracts: "staged", skills: "staged" }).problems, []);
});

test("a staged parser with ready producers passes -- the documents may lead", () => {
  // Sequencing runs one way only. Teaching the form before the parser arrives
  // costs an author a block nothing reads yet; the reverse costs them a
  // refused PR.
  assert.deepEqual(run({ machinery: "staged", contracts: "ready", skills: "ready" }).problems, []);
});

test("losing the format document is itself a failure", () => {
  // Without it every producer restates the key sets, which is the
  // duplicate-source-of-truth pattern the block exists to remove.
  const { problems } = run({ machinery: "staged", contracts: "staged", skills: "staged" }, {
    "core/contracts/plan-provenance.md": "a page that no longer states the format",
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /is the one place the key sets and grammars are written/);
});

test("an uncovered parser file is a refusal, not a silent pass", () => {
  const { problems } = check(manifest({ skills: "ready" }), [PARSER_FILE, FORMAT_FILE], () => "");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /covered by no manifest group/);
});

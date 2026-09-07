import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DECLARATION_GRAMMARS,
  DECLARATION_INFO,
  DECLARATION_KINDS,
  planProvenanceDeclaration,
} from "../../core/scripts/review-loop-record.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * WHY THIS TEST EXISTS.
 *
 * The declaration's format is shared between producer documents -- the files
 * that tell an author what to write -- and one parser. Nothing else compares
 * the two, so both sides can be self-consistently wrong: a skill can teach
 * `fix_reason` while the parser expects `Tier rationale`, every test on each
 * side passes, and the first real PR refuses. #40 §2.2 requires a matcher's
 * fixture to come from the document that defines the format; this is the
 * check that the documents and the matcher have not parted.
 *
 * It reads the real files. A test that transcribed their templates would be a
 * third statement of the format and would drift from both.
 */

/** Every `plan-provenance` block in a document, as its lines. */
function declarationBlocks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let open = null;
  for (const raw of lines) {
    const line = raw.replace(/^\s+/, "");
    if (open) {
      if (/^`{3,}\s*$/.test(line)) {
        blocks.push(open);
        open = null;
        continue;
      }
      open.push(line);
      continue;
    }
    if (line === "```" + DECLARATION_INFO) open = [];
  }
  return blocks;
}

// Every document that teaches an author to write the block. A producer added
// without a row here is a producer nothing compares against the parser, so the
// list is asserted non-empty per file below rather than merely iterated.
const PRODUCERS = [
  "core/docs/ai-context/plan-provenance.md",
  "core/.claude/skills/bugfix/SKILL.md",
  "core/.claude/skills/plan-review-loop/SKILL.md",
];

test("every producer document actually carries a plan-provenance template", () => {
  for (const file of PRODUCERS) {
    const blocks = declarationBlocks(fs.readFileSync(path.join(ROOT, file), "utf8"));
    assert.ok(blocks.length > 0, `${file} teaches the declaration but shows no ${DECLARATION_INFO} block`);
  }
});

test("every key a producer teaches is one the parser knows, for the kind it teaches", () => {
  // Placeholders (`<A or B>`) are what a template SHOULD carry, so values are
  // not checked here -- only the kind and the key set, which is where producer
  // and parser can silently disagree.
  for (const file of PRODUCERS) {
    for (const block of declarationBlocks(fs.readFileSync(path.join(ROOT, file), "utf8"))) {
      const pairs = block.filter((l) => l.trim() !== "").map((l) => /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(l));
      assert.ok(
        pairs.every(Boolean),
        `${file}: a ${DECLARATION_INFO} line is not \`key: value\`: ${JSON.stringify(block)}`,
      );
      const keys = pairs.map((m) => m[1]);
      assert.equal(keys[0], "kind", `${file}: a ${DECLARATION_INFO} block does not open with \`kind\``);
      const kind = pairs[0][2].trim();
      const required = DECLARATION_KINDS[kind];
      assert.ok(required, `${file} teaches \`kind: ${kind}\`, which the parser does not define`);
      assert.deepEqual(
        [...keys.slice(1)].sort(),
        [...required].sort(),
        `${file}: the \`${kind}\` template's keys are not exactly what the parser requires`,
      );
    }
  }
});

test("the format document's own canonical example parses", () => {
  // The example a fixture gets copied FROM must itself be valid -- otherwise
  // copying it, which #40 §2.2 requires, produces a body that refuses. The
  // canonical approved-plan example shipped without `plan_file` in the plan
  // this implements, which the round-4 review caught and the approval recorded
  // as a gap; this test is what stops it recurring.
  const doc = fs.readFileSync(path.join(ROOT, "core/docs/ai-context/plan-provenance.md"), "utf8");
  const canonical = declarationBlocks(doc).find((b) => /^kind:\s*approved-plan\s*$/.test(b[0]));
  assert.ok(canonical, "plan-provenance.md shows no canonical approved-plan example");
  const parsed = planProvenanceDeclaration(["```" + DECLARATION_INFO, ...canonical, "```"].join("\n"));
  assert.equal(parsed?.refuse, undefined, `the canonical example refuses: ${parsed?.refuse}`);
  assert.equal(parsed.kind, "approved-plan");
});

test("the format document states a grammar for every key the parser validates", () => {
  // A key with no published grammar is a key an author has to guess at, and
  // guessing is what the block exists to remove.
  const doc = fs.readFileSync(path.join(ROOT, "core/docs/ai-context/plan-provenance.md"), "utf8");
  const missing = Object.keys(DECLARATION_GRAMMARS).filter((key) => !new RegExp(`\`${key}\``).test(doc));
  assert.deepEqual(missing, [], "keys the parser validates but the format document never names");
});

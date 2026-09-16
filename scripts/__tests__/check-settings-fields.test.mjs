import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ACCEPTED_TOP_LEVEL,
  SETTINGS_FILES,
  unrecognisedFields,
  checkFile,
  run,
} from "../check-settings-fields.mjs";

// ---------------------------------------------------------------------------
// The rule itself
// ---------------------------------------------------------------------------

test("a settings object using only accepted fields is clean", () => {
  assert.deepEqual(
    unrecognisedFields({ model: "opus", permissions: {}, env: {} }),
    [],
  );
});

test("_comment is caught — the field that actually shipped", () => {
  // Not a hypothetical. Both this repo's settings file and the payload template
  // carried a `_comment` array, and Claude Code refuses the file over it:
  //   "Settings validation failed: - : Unrecognized field: _comment"
  assert.deepEqual(
    unrecognisedFields({ _comment: ["notes"], model: "opus" }),
    ["_comment"],
  );
});

test("every unrecognised field is reported, not just the first", () => {
  // A caller fixing one and re-running should not discover the next one by
  // surprise; that turns a single failure into several rounds.
  assert.deepEqual(
    unrecognisedFields({ _comment: [], model: "opus", _notes: "x", README: "y" }),
    ["_comment", "_notes", "README"],
  );
});

test("$schema is accepted — it is a real settings key, not documentation", () => {
  assert.deepEqual(unrecognisedFields({ $schema: "https://example/schema.json" }), []);
});

test("a non-object settings body is rejected rather than passed as clean", () => {
  // An array or a bare string parses as JSON and has no own keys, so a naive
  // Object.keys() check would call it clean. It is not a settings file.
  for (const bad of [[], "text", 42, null]) {
    assert.throws(() => unrecognisedFields(bad), /must be a JSON object/);
  }
});

// ---------------------------------------------------------------------------
// The file walk
// ---------------------------------------------------------------------------

const withTree = (files, fn) => {
  const dir = mkdtempSync(join(tmpdir(), "settings-fields-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(dir, rel.split("/").slice(0, -1).join("/")), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("checkFile reports the offending field with its file", () => {
  withTree({ ".claude/settings.json": JSON.stringify({ _comment: [], model: "opus" }) }, (dir) => {
    const r = checkFile(".claude/settings.json", dir);
    // Assert the fields that carry meaning, not the whole object: an exact
    // deepEqual here broke the moment a field was added to the result, which
    // is a test coupled to the result's shape rather than to its behaviour.
    assert.equal(r.file, ".claude/settings.json");
    assert.deepEqual(r.bad, ["_comment"]);
    assert.ok(!r.missing && !r.parseError);
  });
});

test("a missing file is a failure, not a skip", () => {
  // Both listed files must exist: this repo's own settings file applies its
  // permissions, and the template seeds a consumer's. An earlier version
  // excluded a missing file from `problems`, so deleting or renaming
  // .claude/settings.json printed OK while every local permission had
  // vanished — and nothing else in CI covers that, since check-root-wiring
  // explicitly excludes this file.
  withTree({}, (dir) => {
    const r = checkFile("core/.claude/settings.template.json", dir);
    assert.equal(r.missing, true, "absence must be recorded");
  });
});

test("main() treats absence as a problem — regression on the OK path", () => {
  // The bug was not in checkFile, which always reported `missing`. It was that
  // main() filtered on `parseError || bad.length`, so `missing` never reached
  // the problem list. Assert on the predicate main() actually uses.
  withTree({}, (dir) => {
    const results = run(dir);
    const problems = results.filter((r) => r.missing || r.parseError || r.bad.length > 0);
    assert.equal(problems.length, results.length, "every absent file must be a problem");
  });
});

test("unparseable JSON is surfaced rather than swallowed", () => {
  // A settings file Claude Code cannot parse fails exactly as hard as one it
  // refuses, so this check must not treat a syntax error as "no bad fields".
  withTree({ ".claude/settings.json": "{ not json" }, (dir) => {
    const r = checkFile(".claude/settings.json", dir);
    assert.ok(r.parseError, "a parse failure must be reported");
    assert.deepEqual(r.bad, []);
  });
});

// ---------------------------------------------------------------------------
// The real files
// ---------------------------------------------------------------------------

test("both real settings files are clean", () => {
  for (const r of run()) {
    assert.ok(!r.parseError, `${r.file}: ${r.parseError}`);
    assert.deepEqual(r.bad, [], `${r.file} carries unrecognised field(s): ${r.bad.join(", ")}`);
  }
});

test("the check actually covers the file that ships", () => {
  // Regression insurance for the list itself. The template is `mode: seed` and
  // lands as a consumer's real .claude/settings.json, so it is the file whose
  // rejection costs a consumer their permissions. A check that silently stopped
  // covering it would pass forever.
  assert.ok(SETTINGS_FILES.includes("core/.claude/settings.template.json"));
  assert.ok(SETTINGS_FILES.includes(".claude/settings.json"));
});

test("the accepted set stays small and deliberate", () => {
  // It is a curated list of what the handbook uses, NOT a copy of Claude Code's
  // ~100-key schema — a copy would drift into a second wrong answer. If this
  // grows past a handful, the design decision has been quietly reversed.
  assert.ok(
    ACCEPTED_TOP_LEVEL.size <= 10,
    `accepted set has grown to ${ACCEPTED_TOP_LEVEL.size}; it is meant to be the keys this repo uses`,
  );
  for (const key of ["model", "permissions", "env"]) {
    assert.ok(ACCEPTED_TOP_LEVEL.has(key), `${key} must stay accepted — the files use it`);
  }
});

test("`hooks` is refused, so the retired guards cannot come back silently", () => {
  // The three PreToolUse guards were removed in the #89 cut (#94) in favour of
  // server-side rulesets, which no local file can switch off. Dropping `hooks`
  // from the accepted set is what makes a reappearance a visible decision:
  // a settings file that grows one fails here, in the same diff that adds it.
  assert.ok(!ACCEPTED_TOP_LEVEL.has("hooks"));
  assert.deepEqual(unrecognisedFields({ model: "opus", hooks: {} }), ["hooks"]);
});

test("neither real settings file still carries a hooks block", () => {
  // The removal itself, asserted on the files that ship rather than on the
  // rule. A template that kept its hooks would seed every future consumer with
  // three PreToolUse entries pointing at a guard script that no longer exists
  // -- and a hook whose script is missing exits 127, which PreToolUse reads as
  // allow. Removing the guard and leaving the hook is worse than either.
  for (const r of run()) assert.ok(!r.bad.includes("hooks"), `${r.file} still declares hooks`);
});

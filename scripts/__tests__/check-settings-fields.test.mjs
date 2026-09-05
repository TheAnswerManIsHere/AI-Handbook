import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

import {
  ACCEPTED_TOP_LEVEL,
  SETTINGS_FILES,
  unrecognisedFields,
  checkFile,
  run,
  relativeHookCommands,
  scriptPaths,
  missingGuardHooks,
  REQUIRED_GUARD_MATCHERS,
} from "../check-settings-fields.mjs";

// ---------------------------------------------------------------------------
// The rule itself
// ---------------------------------------------------------------------------

test("a settings object using only accepted fields is clean", () => {
  assert.deepEqual(
    unrecognisedFields({ model: "opus", permissions: {}, hooks: {} }),
    [],
  );
});

test("_comment is caught — the field that actually shipped", () => {
  // Not a hypothetical. Both this repo's settings file and the payload template
  // carried a `_comment` array, and Claude Code refuses the file over it:
  //   "Settings validation failed: - : Unrecognized field: _comment"
  assert.deepEqual(
    unrecognisedFields({ _comment: ["notes"], model: "opus", hooks: {} }),
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
    // deepEqual here broke the moment `relativeHooks` was added, which is a
    // test coupled to the result's shape rather than to its behaviour.
    assert.equal(r.file, ".claude/settings.json");
    assert.deepEqual(r.bad, ["_comment"]);
    assert.ok(!r.missing && !r.parseError);
  });
});

test("a missing file is a failure, not a skip", () => {
  // Both listed files must exist: this repo's own settings file installs its
  // three guard hooks, and the template seeds a consumer's. An earlier version
  // excluded a missing file from `problems`, so deleting or renaming
  // .claude/settings.json printed OK while every local guard had vanished —
  // and nothing else in CI covers that, since check-root-wiring explicitly
  // excludes this file and check-manifest only sees the payload.
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
  // rejection costs a consumer their guard. A check that silently stopped
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
  for (const key of ["model", "permissions", "hooks"]) {
    assert.ok(ACCEPTED_TOP_LEVEL.has(key), `${key} must stay accepted — the files use it`);
  }
});

// ---------------------------------------------------------------------------
// Hook commands must be able to launch (#23 round 1, P1)
// ---------------------------------------------------------------------------

const hooksWith = (command) => ({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ command }] }] } });

// Assert on WHICH PATH was rejected, not on how the failure is printed. The
// first version of these tests compared formatted strings, which couples them
// to the message rather than to the rule.
const unrooted = (parsed) => relativeHookCommands(parsed).map((b) => `${b.event}:${b.path}`);

test("a relative hook command is caught — the form that shipped in the template", () => {
  // Not hypothetical: core/.claude/settings.template.json carried exactly this
  // on all three PreToolUse entries, while this repo's own file had been fixed
  // in #10 and Overhype.me's in #611. The template is the one that seeds every
  // consumer, so it is the one place the mistake ships.
  assert.deepEqual(unrooted(hooksWith("bash .claude/guard.sh")), ["PreToolUse:.claude/guard.sh"]);
});

test("the rooted form is accepted", () => {
  assert.deepEqual(unrooted(hooksWith('bash "${CLAUDE_PROJECT_DIR}/.claude/guard.sh"')), []);
  // The handbook's own shape — the script lives in the payload, one level down.
  assert.deepEqual(unrooted(hooksWith('bash "${CLAUDE_PROJECT_DIR}/core/.claude/guard.sh"')), []);
  // An absolute path needs no placeholder; it already cannot be re-resolved.
  assert.deepEqual(unrooted(hooksWith("bash /opt/tools/lint.sh")), []);
});

test("a command naming no script is not flagged", () => {
  // A hook that shells something off PATH has no path to root, so demanding a
  // placeholder there would be noise.
  assert.deepEqual(unrooted(hooksWith("echo hello")), []);
  assert.deepEqual(unrooted(hooksWith("npm test")), []);
});

test("every hook event is walked, not just PreToolUse", () => {
  // SessionStart hooks resolve the same way and fail the same way; a walk that
  // only knew about PreToolUse would pass a broken SessionStart silently.
  const parsed = {
    hooks: {
      PreToolUse: [{ hooks: [{ command: 'bash "${CLAUDE_PROJECT_DIR}/.claude/guard.sh"' }] }],
      SessionStart: [{ hooks: [{ command: "bash scripts/setup-test-db.sh" }] }],
    },
  };
  assert.deepEqual(unrooted(parsed), ["SessionStart:scripts/setup-test-db.sh"]);
});

test("each script path in a compound command is judged on its own", () => {
  // #23 round 2. The check tested the whole command for the placeholder, so one
  // rooted path vouched for every other path beside it — and the unrooted one
  // still stops resolving after a persisted `cd`.
  const cmd = 'bash "${CLAUDE_PROJECT_DIR}/first.sh" && bash scripts/second.sh';
  assert.deepEqual(unrooted(hooksWith(cmd)), ["PreToolUse:scripts/second.sh"]);
});

test("scriptPaths bounds a token at the shell delimiters around it", () => {
  // The placeholder has to stay part of the path it roots, and a quote or `&&`
  // has to end the token — otherwise the two scripts above read as one.
  assert.deepEqual(scriptPaths('bash "${CLAUDE_PROJECT_DIR}/.claude/guard.sh"'), [
    "${CLAUDE_PROJECT_DIR}/.claude/guard.sh",
  ]);
  assert.deepEqual(scriptPaths("bash a.sh && bash b.mjs; python c.py"), [
    "a.sh",
    "b.mjs",
    "c.py",
  ]);
});

test("both real settings files root every hook path", () => {
  for (const r of run()) {
    assert.deepEqual(
      (r.relativeHooks ?? []).map((b) => b.path),
      [],
      `${r.file} has a hook path that cannot launch from a subdirectory`,
    );
  }
});

// ---------------------------------------------------------------------------
// The guards must actually be installed (#23 round 2)
// ---------------------------------------------------------------------------

const realHooks = () =>
  JSON.parse(JSON.stringify(JSON.parse(readFileSync(join(REPO, ".claude/settings.json"), "utf8"))));

test("a settings file with no hooks at all is a failure, not a clean walk", () => {
  // This is the whole point. The path check walks the hooks that are PRESENT,
  // so deleting the `hooks` object walks nothing and reports nothing — a file
  // that loads perfectly and guards nothing. Same end state as the refused
  // file this check was written for.
  assert.deepEqual(
    missingGuardHooks({ model: "opus" }),
    REQUIRED_GUARD_MATCHERS.map((r) => r.name),
  );
  assert.deepEqual(
    missingGuardHooks({ hooks: {} }),
    REQUIRED_GUARD_MATCHERS.map((r) => r.name),
  );
});

test("losing one of the three guards is caught, not just losing all of them", () => {
  const parsed = realHooks();
  parsed.hooks.PreToolUse = parsed.hooks.PreToolUse.filter(
    (e) => !e.matcher.includes("merge_pull_request"),
  );
  assert.deepEqual(missingGuardHooks(parsed), ["merge"]);
});

test("a matcher that no longer invokes the guard does not count as installed", () => {
  // A guard entry is a matcher AND a command. Keeping the matcher while the
  // command is repointed leaves a file that looks fully guarded in a diff.
  const parsed = realHooks();
  const bash = parsed.hooks.PreToolUse.find((e) => e.matcher === "Bash");
  bash.hooks[0].command = "echo ok";
  assert.deepEqual(missingGuardHooks(parsed), ["Bash"]);
});

test("both real settings files install all three guards", () => {
  for (const r of run()) {
    assert.deepEqual(r.missingGuards ?? [], [], `${r.file} does not install every guard`);
  }
});

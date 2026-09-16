#!/usr/bin/env node
/**
 * check-settings-fields — every shipped settings file is one Claude Code will
 * actually load.
 *
 * ONE RULE: no unrecognised top-level field. A file carrying one is refused
 * outright, and a refused file applies none of its contents — which is why
 * this check outlived the guard hooks it used to police.
 *
 * WHY THIS EXISTS. Both this repo's `.claude/settings.json` and the payload
 * template carried a `_comment` array holding their own documentation. Claude
 * Code's settings validator rejects it:
 *
 *     Settings validation failed:
 *     - : Unrecognized field: _comment
 *
 * That is stricter than the published schema, which declares
 * `"additionalProperties": {}` at the top level and would permit unknown keys.
 * So reading the schema is not enough to know what is accepted, and a field
 * that looks harmless can be refused.
 *
 * The template is `mode: seed` and lands as a consumer's real
 * `.claude/settings.json`, so an unacceptable field there ships. The template
 * even instructed the reader to delete its own comment block after adapting —
 * which asks them to fix the file from inside a session whose settings that
 * same block may be preventing from loading.
 *
 * WHAT THE REFUSAL COSTS NOW THAT THE HOOKS ARE GONE (#89 cut, #94). The
 * three `PreToolUse` guards were the loudest thing a refused file dropped, and
 * they were replaced by GitHub rulesets, which no local file can switch off.
 * What a refused file still drops is `permissions.deny` — where
 * `drizzle-kit push` is refused in the template, and the dotenv read-deny in both.
 * That is the reason this check is kept and slimmed rather than cut with the
 * hooks it also covered.
 *
 * WHAT IS DELIBERATELY NOT ENCODED HERE: Claude Code's full accepted field set.
 * It runs to about a hundred keys and drifts with every release, so a copy
 * would rot into a second wrong answer. This checks against the much smaller
 * set the handbook actually uses, and fails on anything else.
 *
 * That means a LEGITIMATELY NEW field fails this check. That is the intended
 * trade and not an oversight: the failure is loud, immediate, at authoring
 * time, and the message says exactly what to do. The failure it replaces was
 * silent, deferred to session start in someone else's repository.
 *
 * Scope: top-level keys only, which is the shape that was actually observed to
 * fail. Nested validation is Claude Code's own job and duplicating it here
 * would be the same rotting-copy mistake at a lower level.
 *
 * USAGE
 *   node scripts/check-settings-fields.mjs
 *
 * Exit 0 when every file is clean, 1 when a file is missing, unparseable, or
 * carries an unrecognised field.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Top-level keys the handbook's settings files are allowed to use.
 *
 * Every entry is a real Claude Code setting AND one this repo or its template
 * actually needs. Adding a key here is a deliberate act: confirm Claude Code
 * accepts it (the validator refuses the file otherwise, which is the whole
 * reason for this check) and that a settings file here genuinely needs it.
 *
 * `hooks` is NOT on the list, and its absence is the record of a decision.
 * The three `PreToolUse` guards were removed in the #89 cut (#94) in favour
 * of server-side rulesets; a `hooks` block reappearing here is a return to a
 * mechanism that was measured and dropped, so it fails this check and the
 * person adding it has to say why in the same diff.
 */
export const ACCEPTED_TOP_LEVEL = new Set([
  "$schema",
  "model",
  "env",
  "permissions",
]);

/** Settings files this repo ships or runs under. */
export const SETTINGS_FILES = [
  ".claude/settings.json",
  "core/.claude/settings.template.json",
];

/**
 * Unrecognised top-level keys in one parsed settings object. Pure, so the
 * tests exercise the rule rather than the filesystem.
 */
export function unrecognisedFields(parsed, accepted = ACCEPTED_TOP_LEVEL) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("settings must be a JSON object");
  }
  return Object.keys(parsed).filter((k) => !accepted.has(k));
}

export function checkFile(relPath, root = ROOT) {
  const full = join(root, relPath);
  // ABSENCE IS A FAILURE, not a skip. Both listed files must exist: this
  // repo's own settings file is what applies its permissions, and the template
  // is what seeds a consumer's. Treating a missing file as "nothing to
  // validate" meant a deleted or renamed `.claude/settings.json` printed OK
  // while every local permission had silently disappeared -- and nothing else
  // in CI covers it, since `check-root-wiring` explicitly excludes this file.
  // A check that reports success when its subject is gone is the failure mode
  // this whole workstream is about. (Codex, #23 round 1.)
  if (!existsSync(full)) return { file: relPath, missing: true, bad: [] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(full, "utf8"));
  } catch (error) {
    return { file: relPath, parseError: error.message, bad: [] };
  }
  return { file: relPath, bad: unrecognisedFields(parsed) };
}

export function run(root = ROOT, files = SETTINGS_FILES) {
  return files.map((f) => checkFile(f, root));
}

function main() {
  const results = run();
  const problems = results.filter((r) => r.missing || r.parseError || r.bad.length > 0);

  if (problems.length === 0) {
    console.log(
      `check-settings-fields: OK — ${results.length} settings file(s), no unrecognised top-level fields ` +
        `(${ACCEPTED_TOP_LEVEL.size} accepted).`,
    );
    return;
  }

  console.error(`\n✗ ${problems.length} settings file(s) Claude Code would refuse or could not read.\n`);
  for (const p of problems) {
    if (p.missing) {
      console.error(`  - ${p.file}: MISSING. This file must exist — it is what applies this repo's permissions.`);
      continue;
    }
    if (p.parseError) {
      console.error(`  - ${p.file}: not valid JSON — ${p.parseError}`);
      continue;
    }
    console.error(`  - ${p.file}: unrecognised top-level field(s): ${p.bad.join(", ")}`);
  }
  if (problems.some((p) => (p.bad ?? []).length > 0)) {
    console.error(
      "\nClaude Code refuses a settings file carrying an unrecognised top-level field, and it is\n" +
      "stricter than its own published schema — so a key can be valid JSON, permitted by the\n" +
      'schema\'s "additionalProperties", and still rejected. A refused file applies none of its\n' +
        "contents, including permissions.deny, with nothing saying so.\n\n" +
        "Fix one of two ways:\n" +
        "  - The field is documentation or a stray key: remove it. Prose belongs in\n" +
        "    docs/consuming-repos.md or CLAUDE.md, which are read by whoever adapts the file.\n" +
        "  - The field is a real Claude Code setting this repo needs: add it to\n" +
        "    ACCEPTED_TOP_LEVEL in scripts/check-settings-fields.mjs, having confirmed the\n" +
        "    validator accepts it.\n",
    );
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

#!/usr/bin/env node
/**
 * check-settings-fields — every shipped settings file uses only top-level
 * fields Claude Code will accept.
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
 * `.claude/settings.json`, so an unacceptable field there ships. The failure
 * mode is the one this workstream keeps meeting: a settings file that does not
 * load installs no `hooks` block, and a consumer gets no guard with nothing
 * saying so. The template even instructed the reader to delete its own comment
 * block after adapting — which asks them to fix the file from inside a session
 * whose settings that same block may be preventing from loading.
 *
 * WHAT IS DELIBERATELY NOT ENCODED HERE: Claude Code's full accepted field set.
 * It runs to about a hundred keys and drifts with every release, so a copy
 * would rot into a second wrong answer. This checks against the much smaller
 * set the handbook actually uses, and fails on anything else.
 *
 * That means a LEGITIMATELY NEW field fails this check. That is the intended
 * trade and not an oversight: the failure is loud, immediate, at authoring
 * time, and the message says exactly what to do. The failure it replaces was
 * silent, deferred to session start in someone else's repository, and
 * indistinguishable from having no guard configured at all.
 *
 * Scope: top-level keys only, which is the shape that was actually observed to
 * fail. Nested validation is Claude Code's own job and duplicating it here
 * would be the same rotting-copy mistake at a lower level.
 *
 * USAGE
 *   node scripts/check-settings-fields.mjs
 *
 * Exit 0 when every file is clean, 1 when any field is unrecognised.
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
 */
export const ACCEPTED_TOP_LEVEL = new Set([
  "$schema",
  "model",
  "env",
  "permissions",
  "hooks",
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
  const problems = results.filter((r) => r.parseError || r.bad.length > 0);

  if (problems.length === 0) {
    const checked = results.filter((r) => !r.missing).length;
    console.log(
      `check-settings-fields: OK — ${checked} settings file(s), no unrecognised top-level fields ` +
        `(${ACCEPTED_TOP_LEVEL.size} accepted).`,
    );
    return;
  }

  console.error(`\n✗ ${problems.length} settings file(s) Claude Code would refuse.\n`);
  for (const p of problems) {
    if (p.parseError) {
      console.error(`  - ${p.file}: not valid JSON — ${p.parseError}`);
      continue;
    }
    console.error(`  - ${p.file}: unrecognised top-level field(s): ${p.bad.join(", ")}`);
  }
  console.error(
    "\nClaude Code refuses a settings file carrying an unrecognised top-level field, and it is\n" +
      "stricter than its own published schema — so a key can be valid JSON, permitted by the\n" +
      'schema\'s "additionalProperties", and still rejected. A refused file installs no hooks,\n' +
      "which means no guard, with nothing saying so.\n\n" +
      "Fix one of two ways:\n" +
      "  - The field is documentation or a stray key: remove it. Prose belongs in\n" +
      "    docs/consuming-repos.md or CLAUDE.md, which are read by whoever adapts the file.\n" +
      "  - The field is a real Claude Code setting this repo needs: add it to\n" +
      "    ACCEPTED_TOP_LEVEL in scripts/check-settings-fields.mjs, having confirmed the\n" +
      "    validator accepts it.\n",
  );
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

#!/usr/bin/env node
/**
 * check-settings-fields — every shipped settings file is one Claude Code will
 * actually load, and whose hooks will actually launch.
 *
 * Three rules, each learned the hard way, and all three failing the same way:
 * no unrecognised top-level field (the file is refused outright), every hook
 * script path rooted at ${CLAUDE_PROJECT_DIR} (a relative one cannot launch),
 * and all three guards actually installed (a `hooks` block that lost them
 * loads fine and guards nothing). Every one of them ends with a session that
 * looks configured and has no guard.
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
 * Exit 0 when every file is clean, 1 when a file is missing, unparseable,
 * carries an unrecognised field, names a hook script path that is not rooted,
 * or fails to install one of the three guards.
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

/**
 * Every script path a hook command names, one entry per path.
 *
 * PER PATH, NOT PER COMMAND. A command-wide substring test for the placeholder
 * calls `bash "${CLAUDE_PROJECT_DIR}/first.sh" && bash scripts/second.sh`
 * clean, because the placeholder occurs *somewhere*. The second script still
 * stops resolving after a persisted `cd`, so a single rooted path was enough
 * to vouch for an unrooted one. (Codex, #23 round 2.)
 *
 * The token runs to the first shell delimiter, so quotes and `&&` bound it and
 * the placeholder stays part of the path it roots.
 */
const SCRIPT_TOKEN = /[^\s"'`;|&()]*\.(?:sh|mjs|js|py)\b/g;

export function scriptPaths(command) {
  // Only commands that actually name a script file. A hook that shells
  // something off PATH has no path to root.
  return String(command).match(SCRIPT_TOKEN) ?? [];
}

/**
 * Hook script paths that are neither rooted at ${CLAUDE_PROJECT_DIR} nor
 * absolute. Returns `{ event, path, command }` rather than a formatted string,
 * so a test asserts on which path was rejected and not on how it is printed.
 *
 * FIFTH INSTANCE OF ONE SHAPE, which is why this is a check and not a note. A
 * hook command resolves against the CURRENT WORKING DIRECTORY, not the project
 * root, so a relative path works only while the cwd happens to be the root.
 * From anywhere else bash exits 127 — and `PreToolUse` treats every non-zero
 * exit OTHER than 2 as non-blocking, so the guard waves the call through.
 *
 * Fixed in this repo (#10), fixed in Overhype.me (#611), and still wrong in
 * the template until Codex caught it on #23 — the one file that seeds every
 * future consumer, and the one place the mistake ships. Three fixes by hand,
 * each verified, and the fourth copy was still broken. That is the point at
 * which the repo's own doctrine says stop relying on remembering.
 */
export function relativeHookCommands(parsed) {
  const bad = [];
  for (const [event, entries] of Object.entries(parsed?.hooks ?? {})) {
    for (const entry of entries ?? []) {
      for (const hook of entry?.hooks ?? []) {
        const cmd = hook?.command;
        if (typeof cmd !== "string") continue;
        for (const path of scriptPaths(cmd)) {
          if (path.includes("${CLAUDE_PROJECT_DIR}")) continue;
          if (path.startsWith("/")) continue; // already absolute
          bad.push({ event, path, command: cmd });
        }
      }
    }
  }
  return bad;
}

/**
 * The three `PreToolUse` guards every handbook settings file must install.
 *
 * Matched by substring against the entry's `matcher`, because the matcher for
 * two of them is a long alternation of MCP tool names and pinning it exactly
 * would fail on an addition rather than on a removal.
 */
export const REQUIRED_GUARD_MATCHERS = [
  { name: "Bash", needle: "Bash", covers: "destructive commands and force pushes" },
  {
    name: "GitHub comment/review writes",
    needle: "add_issue_comment",
    covers: "the review-request and thread-reply guards",
  },
  { name: "merge", needle: "merge_pull_request", covers: "the merge readiness gate" },
];

/**
 * Required guards a settings file does not actually install.
 *
 * WHY THIS IS NOT COVERED BY THE PATH CHECK ABOVE. That one walks the hooks
 * that are present, so a file whose `hooks` object was deleted outright — or
 * which kept two of the three entries, or kept an entry whose command no
 * longer names the guard — walks an empty or partial collection and reports
 * nothing. The end state is identical to the one the missing-file branch
 * exists to prevent: the settings file loads, and no guard runs. Reporting OK
 * there is the same fail-open this whole check was written against. (Codex,
 * #23 round 2.)
 *
 * An entry counts only when it BOTH matches and invokes `guard.sh` — a matcher
 * pointing at something else is not a guard, however well-named.
 *
 * This does deliberately hard-code a policy, unlike the accepted-field set,
 * which refuses to mirror Claude Code's schema. The difference is ownership:
 * the accepted fields are Claude Code's and drift out from under a copy, while
 * the guard set is this repo's own. Adding a fourth guard does not fail this;
 * REMOVING one does, and that friction is the point.
 */
export function missingGuardHooks(parsed) {
  const covered = new Set();
  for (const entry of parsed?.hooks?.PreToolUse ?? []) {
    const matcher = typeof entry?.matcher === "string" ? entry.matcher : "";
    const invokesGuard = (entry?.hooks ?? []).some(
      (h) => typeof h?.command === "string" && /\bguard\.sh\b/.test(h.command),
    );
    if (!invokesGuard) continue;
    for (const req of REQUIRED_GUARD_MATCHERS) {
      if (matcher.includes(req.needle)) covered.add(req.name);
    }
  }
  return REQUIRED_GUARD_MATCHERS.filter((r) => !covered.has(r.name)).map((r) => r.name);
}

export function checkFile(relPath, root = ROOT) {
  const full = join(root, relPath);
  // ABSENCE IS A FAILURE, not a skip. Both listed files must exist: this
  // repo's own settings file is what installs its three guard hooks, and the
  // template is what seeds a consumer's. Treating a missing file as "nothing
  // to validate" meant a deleted or renamed `.claude/settings.json` printed
  // OK while every local guard had silently disappeared -- and nothing else in
  // CI covers it, since `check-root-wiring` explicitly excludes this file and
  // `check-manifest` only sees the payload. A check that reports success when
  // its subject is gone is the failure mode this whole workstream is about.
  // (Codex, #23 round 1.)
  if (!existsSync(full)) return { file: relPath, missing: true, bad: [] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(full, "utf8"));
  } catch (error) {
    return { file: relPath, parseError: error.message, bad: [] };
  }
  return {
    file: relPath,
    bad: unrecognisedFields(parsed),
    relativeHooks: relativeHookCommands(parsed),
    missingGuards: missingGuardHooks(parsed),
  };
}

export function run(root = ROOT, files = SETTINGS_FILES) {
  return files.map((f) => checkFile(f, root));
}

function main() {
  const results = run();
  const problems = results.filter(
    (r) =>
      r.missing ||
      r.parseError ||
      r.bad.length > 0 ||
      (r.relativeHooks ?? []).length > 0 ||
      (r.missingGuards ?? []).length > 0,
  );

  if (problems.length === 0) {
    console.log(
      `check-settings-fields: OK — ${results.length} settings file(s), no unrecognised top-level fields ` +
        `(${ACCEPTED_TOP_LEVEL.size} accepted), all hook paths rooted, ` +
        `all ${REQUIRED_GUARD_MATCHERS.length} guards installed.`,
    );
    return;
  }

  console.error(`\n✗ ${problems.length} settings file(s) Claude Code would refuse or could not read.\n`);
  for (const p of problems) {
    if (p.missing) {
      console.error(`  - ${p.file}: MISSING. This file must exist — it is what installs the guard hooks.`);
      continue;
    }
    if (p.parseError) {
      console.error(`  - ${p.file}: not valid JSON — ${p.parseError}`);
      continue;
    }
    if (p.bad.length > 0) {
      console.error(`  - ${p.file}: unrecognised top-level field(s): ${p.bad.join(", ")}`);
    }
    for (const h of p.relativeHooks ?? []) {
      console.error(
        `  - ${p.file}: ${h.event} hook path is not rooted at \${CLAUDE_PROJECT_DIR} — ${h.path}\n` +
          `      in: ${h.command}`,
      );
    }
    for (const g of p.missingGuards ?? []) {
      const req = REQUIRED_GUARD_MATCHERS.find((r) => r.name === g);
      console.error(
        `  - ${p.file}: no PreToolUse hook installs the ${g} guard (covers ${req?.covers}).`,
      );
    }
  }
  if (problems.some((p) => (p.missingGuards ?? []).length > 0)) {
    console.error(
      "\nA settings file that loads but installs no guard is the same end state as one Claude Code\n" +
        "refuses: the file is present, and nothing invokes ${CLAUDE_PROJECT_DIR}/.claude/guard.sh.\n" +
        "Each of the three PreToolUse entries must both match and run the guard. If a guard is being\n" +
        "removed on purpose, remove it from REQUIRED_GUARD_MATCHERS in the same change, where the\n" +
        "removal is visible in the diff.\n",
    );
  }
  // Each explainer prints only for the rule that actually failed. Printing all
  // three every time buries the one that applies in advice about two problems
  // the file does not have.
  if (problems.some((p) => (p.relativeHooks ?? []).length > 0)) {
    console.error(
      "\nA hook command resolves against the CURRENT WORKING DIRECTORY, not the project root, so a\n" +
        "relative path works only while the cwd happens to be the root. From anywhere else bash exits\n" +
        "127, and PreToolUse treats every non-zero exit other than 2 as non-blocking — the guard waves\n" +
        "the call through. Root every hook script at ${CLAUDE_PROJECT_DIR}.\n",
    );
  }
  if (problems.some((p) => (p.bad ?? []).length > 0)) {
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
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

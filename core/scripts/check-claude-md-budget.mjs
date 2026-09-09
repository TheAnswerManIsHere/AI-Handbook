#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * Size budget for the contract files loaded into every Claude Code session.
 *
 * WHY A BUDGET AT ALL. Every byte of these files is read on every session, in
 * every repository that receives them. Nothing in the ordinary flow of work
 * pushes back on growth: each lesson arrives as one more paragraph, each
 * paragraph is individually justified, and a prune with no lock behind it is
 * measured in weeks. This check is the push-back — the file may not exceed its
 * budget, so an addition has to displace something rather than extend it.
 *
 * THE BUDGET IS THE FILE'S EXACT SIZE, AND THAT IS THE WHOLE MECHANISM. A
 * budget with room left is satisfied by exactly the state the mechanism exists
 * to prevent: slack someone can grow into without anyone deciding to allow it.
 * So this refuses a file that is UNDER its budget as loudly as one that is
 * over. Re-pinning is a visible one-line diff in a pull request, which makes
 * growth an explicit decision instead of a silent one.
 *
 * (The consequence, stated so it is not a surprise: a commit that changes a
 * budgeted file also re-pins its numbers. That is the cost, and it is the
 * point. Where this rule came from, it drifted twice in one afternoon --
 * first by two bytes, then by forty -- because a later commit shrank the file
 * and the numbers were left where an earlier raise had put them.)
 *
 * BOTH LINES AND BYTES, because either alone is gameable: lines by writing
 * longer lines, bytes by nothing that matters much -- but the line count is
 * what a reader actually experiences, and the byte count is what a model
 * actually pays for.
 *
 * WHY THE NUMBERS LIVE IN `machinery.json` RATHER THAN HERE. This file is
 * payload: it is delivered to every consumer, and a constant compiled into it
 * would carry one repository's size into all of them. Each repo declares its
 * own budgeted files under `contractBudgets`, which is consumer-owned from the
 * moment it lands. That also lets a repo budget however many files its
 * contract is split across -- the handbook's own contract is an overlay plus a
 * vendored core, where the repo this rule came from had a single file.
 *
 * NO DECLARATION IS A REFUSAL, NOT A SKIP. A missing `contractBudgets` makes
 * this exit non-zero and name the file to edit. The alternative -- passing
 * quietly -- would mean a consumer receives the lock, runs it in CI, and is
 * protected by nothing, with a green check saying otherwise. A guard that
 * cannot find its configuration must not report success.
 *
 * Dependency-free. Run locally:  node scripts/check-claude-md-budget.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ONE root resolver and ONE config-file name, imported rather than restated.
// The first draft of this file carried its own copy of the walk, and the copy
// omitted the `.git` bound -- so a checkout nested under a configured parent
// silently adopted the parent's configuration and reported success over the
// wrong contract (Codex, #60 round 1). A second implementation of "where is
// the repository" is the second source of truth this repository exists to
// remove, and it drifted immediately, in the way duplicates do.
import { MACHINERY_CONFIG_FILE, findRepoRoot } from "./review-budget.mjs";

export const CONFIG = MACHINERY_CONFIG_FILE;
export { findRepoRoot };

/** Count lines the way `wc -l` does: one per newline, plus one for a trailing partial line. */
export function countLines(text) {
  if (text.length === 0) return 0;
  const newlines = text.split("\n").length - 1;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

/** UTF-8 byte length, the way `wc -c` counts it. */
export function countBytes(text) {
  return Buffer.byteLength(text, "utf8");
}

/**
 * The declared budgets, or a throw naming what is wrong with the declaration.
 *
 * Every field is required rather than defaulted. A budget defaulted to some
 * number is a budget nobody chose, and this file's entire value is that the
 * number was chosen.
 */
export function readBudgets(repoRoot) {
  const path = resolve(repoRoot, CONFIG);
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`cannot read ${CONFIG}: ${e.message}`);
  }
  const declared = config.contractBudgets;
  if (declared === undefined) {
    throw new Error(
      `${CONFIG} declares no \`contractBudgets\`, so there is nothing to enforce and this check ` +
        `would pass while protecting nothing. Add an entry per contract file loaded into every ` +
        `session, each with its EXACT current size:\n` +
        `  "contractBudgets": [{ "path": "CLAUDE.md", "lines": 0, "bytes": 0 }]\n` +
        `Run this check to be told the real numbers.`,
    );
  }
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error(`${CONFIG}: \`contractBudgets\` must be a non-empty array`);
  }
  for (const entry of declared) {
    const bad =
      !entry || typeof entry.path !== "string" || !entry.path ||
      !Number.isInteger(entry.lines) || entry.lines < 0 ||
      !Number.isInteger(entry.bytes) || entry.bytes < 0;
    if (bad) {
      throw new Error(
        `${CONFIG}: every \`contractBudgets\` entry needs a non-empty \`path\` and integer ` +
          `\`lines\` and \`bytes\`; got ${JSON.stringify(entry)}`,
      );
    }
  }
  return declared;
}

/**
 * Compare one file's actual size against its declared budget.
 *
 * Returns null when they match EXACTLY, else the failure message. Over and
 * under are different failures with different fixes, so they read differently.
 */
export function checkOne({ path, lines, bytes }, text) {
  const actualLines = countLines(text);
  const actualBytes = countBytes(text);
  if (actualLines === lines && actualBytes === bytes) return null;

  const over = actualLines > lines || actualBytes > bytes;
  const size = `${actualLines} lines / ${actualBytes} bytes against a budget of ${lines} / ${bytes}`;
  if (over) {
    return (
      `${path} is over budget: ${size}. Every byte of this file loads into every session, so an ` +
      `addition displaces something rather than extending it. Move rationale to the repo's ` +
      `decisions.md, mechanics to a skill, or cut. If the growth is deliberate, re-pin the ` +
      `numbers in ${CONFIG} — that diff is the decision.`
    );
  }
  return (
    `${path} is UNDER budget: ${size}. That is slack the next addition can grow into without ` +
    `anyone deciding to allow it, which is the state this check exists to prevent. Re-pin the ` +
    `numbers in ${CONFIG} to the file's actual size, in the same commit that changed it.`
  );
}

/**
 * Is `target` the repository root or inside it?
 *
 * Compared as locations, not string prefixes: `/a/bc` is not inside `/a/b`.
 */
export function isInside(root, target) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel));
}

/** Every declared file, checked. Returns the failure messages, empty when all match. */
export function checkAll(repoRoot, budgets = readBudgets(repoRoot)) {
  const failures = [];
  for (const budget of budgets) {
    // `resolve` honours `..` and discards the root for an absolute path, so a
    // declaration can name a file OUTSIDE the repository -- and one pinned to
    // that file's size passes, leaving the repository's real contract
    // unchecked behind a green board. Refuse rather than read.
    const target = resolve(repoRoot, budget.path);
    if (!isInside(repoRoot, target)) {
      failures.push(
        `${budget.path} resolves to ${target}, which is outside the repository. A budget may only ` +
          `name a file inside it — otherwise this check passes while the real contract is never read.`,
      );
      continue;
    }
    let text;
    try {
      text = readFileSync(target, "utf8");
    } catch (e) {
      failures.push(`${budget.path} is declared in ${CONFIG} but cannot be read: ${e.message}`);
      continue;
    }
    const failure = checkOne(budget, text);
    if (failure) failures.push(failure);
  }
  return failures;
}

function main() {
  // Resolved from this script's own location, not the cwd: a check that only
  // works when run from the root is a check that silently passes elsewhere.
  const here = dirname(fileURLToPath(import.meta.url));
  const root = findRepoRoot(here);
  if (root === null) {
    throw new Error(
      `no ${CONFIG} in any directory from ${here} up to the enclosing repository. This check ` +
        `reads its budgets from that file; without it there is nothing to enforce.`,
    );
  }

  const budgets = readBudgets(root);
  const failures = checkAll(root, budgets);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`✗ ${failure}`);
    process.exit(1);
  }
  for (const b of budgets) console.log(`✓ ${b.path}: ${b.lines} lines, ${b.bytes} bytes — pinned exactly.`);
}

// Compare as a URL: a hand-built `file://` string differs from `import.meta.url`
// on any path needing escaping, and a script that never runs exits 0.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}

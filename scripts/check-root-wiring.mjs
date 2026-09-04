#!/usr/bin/env node
/**
 * Does this repository actually reach its own payload?
 *
 * THE PROBLEM THIS CLOSES. `core/.claude/skills/` is payload: files written to
 * be vendored into a consumer, where they land at `.claude/skills/` and Claude
 * Code loads them. In the handbook they sit one directory too deep, so a
 * session working ON the handbook had the core rules (CLAUDE.md imports them)
 * but none of the skills those rules invoke. The fix is a per-entry symlink
 * from the root into the payload -- ONE copy, which is what the contract
 * requires: "duplicating them here to get slash commands would create exactly
 * the second source of truth this repo exists to eliminate."
 *
 * WHY PER-ENTRY AND NOT ONE LINK AT `.claude/skills`. A `<skill-name>` entry
 * being a symlink is documented behaviour -- Claude Code follows it and reads
 * SKILL.md from the target. A symlink at the `skills` DIRECTORY itself is not
 * documented either way, and a loader that lists entries with `withFileTypes`
 * and filters on `isDirectory()` would skip it silently. Silently is the
 * problem: the failure would look like "no skills here", which is the state
 * this is fixing. So the wiring uses only the shape that is specified.
 *
 * WHY A CHECK AND NOT A CONVENTION. Adding a skill to the payload is then only
 * half the change -- exactly the failure `check-manifest.mjs` exists for on the
 * sync side. Without this, a new skill is invisible in the handbook and nothing
 * says so. Both directions fail: an unlinked payload entry, and a root link
 * that dangles or points outside the payload.
 *
 * NOT IN SCOPE: `.claude/settings.json`. Whether this repo installs the guard
 * hooks is an enrolment step and a change to the agent's own guardrails, which
 * is David's to merge rather than a check's to enforce -- and a check that
 * failed until it existed could not be merged to begin with.
 *
 * Run:  node scripts/check-root-wiring.mjs
 */

import { readFileSync, readdirSync, existsSync, lstatSync, readlinkSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Payload dir -> root dir, and what counts as an entry in it. */
const WIRED = [
  {
    label: "skills",
    payload: "core/.claude/skills",
    root: ".claude/skills",
    entries: (abs) => readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory()),
  },
  {
    label: "agents",
    payload: "core/.claude/agents",
    root: ".claude/agents",
    entries: (abs) =>
      readdirSync(abs, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".md")),
  },
];

/** The `.gitignore` that cannot be a pointer: git does not follow a symlinked one. */
const MIRRORED_GITIGNORE = {
  payload: "core/.agents/receipts/.gitignore",
  root: ".agents/receipts/.gitignore",
};

const patternLines = (text) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));

function checkWiring(problems, ROOT) {
  for (const { label, payload, root, entries } of WIRED) {
    const payloadAbs = join(ROOT, payload);
    const rootAbs = join(ROOT, root);

    if (!existsSync(payloadAbs)) {
      problems.push(`${payload} does not exist -- the payload moved and this check was not updated.`);
      continue;
    }
    if (!existsSync(rootAbs)) {
      problems.push(
        `${root} does not exist, so this repo loads none of its own ${label}. ` +
          `Link each entry: ln -s ../../${payload}/<name> ${root}/<name>`,
      );
      continue;
    }

    const wanted = entries(payloadAbs).map((e) => e.name);
    for (const name of wanted) {
      const linkPath = join(rootAbs, name);
      if (!existsSync(linkPath)) {
        problems.push(
          `${payload}/${name} is payload but ${root}/${name} does not exist, so this repo cannot load it. ` +
            `Add it: ln -s ../../${payload}/${name} ${root}/${name}`,
        );
        continue;
      }
      if (!lstatSync(linkPath).isSymbolicLink()) {
        problems.push(
          `${root}/${name} is a real file or directory, not a link into the payload. ` +
            `That is a second copy of ${payload}/${name}, which is the drift this repo exists to prevent.`,
        );
        continue;
      }
      const target = resolve(dirname(linkPath), readlinkSync(linkPath));
      const expected = join(payloadAbs, name);
      if (target !== expected) {
        problems.push(
          `${root}/${name} points at ${relative(ROOT, target)}, not ${payload}/${name}.`,
        );
      }
    }

    // The other direction: a root entry that dangles, or that points somewhere
    // other than the payload. A stale link is worse than a missing one -- it
    // reads as wired.
    for (const e of readdirSync(rootAbs, { withFileTypes: true })) {
      const linkPath = join(rootAbs, e.name);
      if (!lstatSync(linkPath).isSymbolicLink()) continue;
      const target = resolve(dirname(linkPath), readlinkSync(linkPath));
      if (!existsSync(target)) {
        problems.push(`${root}/${e.name} is a DANGLING link to ${relative(ROOT, target)}.`);
        continue;
      }
      if (!wanted.includes(e.name)) {
        problems.push(
          `${root}/${e.name} links to ${relative(ROOT, target)}, which is not an entry in ${payload}. ` +
            `Delete it, or move its target into the payload.`,
        );
      }
    }
  }
}

function checkMirroredGitignore(problems, ROOT) {
  const { payload, root } = MIRRORED_GITIGNORE;
  const payloadAbs = join(ROOT, payload);
  const rootAbs = join(ROOT, root);

  if (!existsSync(payloadAbs) || !existsSync(rootAbs)) {
    problems.push(`${payload} and ${root} must BOTH exist; one of them does not.`);
    return;
  }
  // A symlink here would be staged as an ordinary file and its patterns never
  // applied, so every ephemeral receipt would be committed. Verified, not
  // assumed -- which is why the mirror is checked instead of pointed at.
  if (lstatSync(rootAbs).isSymbolicLink()) {
    problems.push(
      `${root} is a symlink. Git does not follow a symlinked .gitignore, so its patterns would ` +
        `never apply and every ephemeral receipt would be committed. It must be a real file.`,
    );
    return;
  }
  const a = patternLines(readFileSync(payloadAbs, "utf8"));
  const b = patternLines(readFileSync(rootAbs, "utf8"));
  if (a.join("\n") !== b.join("\n")) {
    problems.push(
      `${root} has drifted from ${payload}.\n` +
        `    payload: ${JSON.stringify(a)}\n` +
        `    root:    ${JSON.stringify(b)}\n` +
        `    Edit the payload copy; this one mirrors it.`,
    );
  }
}

/**
 * `root` is injected so the failure directions can be tested against fixture
 * trees. A check only ever exercised on a passing repo is a check nobody knows
 * the shape of.
 */
export function run(root = ROOT) {
  const problems = [];
  checkWiring(problems, root);
  checkMirroredGitignore(problems, root);
  return problems;
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const problems = run();
  if (problems.length) {
    console.error(`check-root-wiring: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  - ${p}\n`);
    process.exit(1);
  }
  const skills = readdirSync(join(ROOT, ".claude/skills")).length;
  const agents = readdirSync(join(ROOT, ".claude/agents")).length;
  console.log(
    `check-root-wiring: OK -- ${skills} skills and ${agents} agents reach the payload by link, ` +
      `and the receipts .gitignore mirrors it`,
  );
}

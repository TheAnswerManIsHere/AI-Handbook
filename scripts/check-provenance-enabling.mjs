#!/usr/bin/env node
/**
 * The sequencing gate for the declared `plan-provenance` block.
 *
 * WHY. The parser refuses a PR body that carries a legacy selector alongside a
 * declaration, and refuses a body whose declaration is malformed. So a
 * consumer that receives the PARSER before it receives the DOCUMENTS that
 * teach the form gets its own PRs refused — the machinery arrives and the
 * instructions do not.
 *
 * `requires` does not prevent that, and deliberately so: `machinery` requires
 * only `machinery-config`, and its references to `skills` and `claude-core`
 * are recorded as `mentions` — evidence, not dependencies, because the
 * generator opens the PR body and never opens a skill. That classification is
 * right, and it is exactly why this gate is separate. (Codex, #43 round 4,
 * recorded at approval as an open gap and closed here.)
 *
 * The producer set is DERIVED, never listed. A hand-maintained list of which
 * files teach the form is the same defect the block exists to remove: the plan
 * loop named one inert construct in round 1, two in round 2, and was still
 * wrong in round 3. A file that teaches the format says so in its text, and
 * that is what this reads.
 *
 * WHAT IT CANNOT CHECK. Each consuming repository owns its own
 * `.github/pull_request_template.md` (`docs/consuming-repos.md`), which is
 * outside this repository. No search run here can establish that the producer
 * inventory is exhaustive. That is stated as an uncheckable precondition
 * rather than quietly assumed — the gate bounds the uncertainty, it does not
 * dissolve it.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseManifestYaml, walk, ownersOf } from "./check-manifest.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(REPO_ROOT, "sync-manifest.yml");
const PAYLOAD_DIR = "core";

/** The file that refuses a body it cannot parse. What must arrive last. */
export const PARSER_FILE = "core/scripts/review-loop-record.mjs";

/** The document that defines the wire format. */
export const FORMAT_FILE = "core/docs/ai-context/plan-provenance.md";

/**
 * Does this file TEACH the declared form -- as opposed to merely mentioning
 * that one exists? Three positive signals, each of which only appears in a
 * file an author is meant to write from:
 *
 *   - it shows a ```plan-provenance block;
 *   - it names the format document, which is how a producer points at the
 *     grammar instead of restating it;
 *   - it names `Tier rationale`, the field that exists only because the tier
 *     letter moved into the block.
 *
 * The parser itself matches, and is excluded by name: it is the thing being
 * sequenced, not a producer.
 */
export function teachesTheForm(text) {
  return /```plan-provenance/.test(text) || /plan-provenance\.md/.test(text) || /Tier rationale/.test(text);
}

export function check(manifest, payloadFiles, readFile, { parserFile = PARSER_FILE, formatFile = FORMAT_FILE } = {}) {
  const problems = [];
  const owner = ownersOf(manifest, payloadFiles);
  const statusOf = new Map(manifest.groups.map((g) => [g.id, g.status]));

  const parserGroup = owner.get(parserFile);
  if (!parserGroup) {
    return { problems: [`${parserFile} is covered by no manifest group, so nothing can be sequenced against it`], producers: [] };
  }

  const producers = [];
  for (const file of payloadFiles) {
    if (file === parserFile) continue;
    let text;
    try {
      text = readFile(file);
    } catch {
      continue; // a binary or unreadable payload file teaches nothing
    }
    if (teachesTheForm(text)) producers.push({ file, group: owner.get(file) });
  }

  if (!producers.some((p) => p.file === formatFile)) {
    problems.push(
      `${formatFile} is missing or no longer states the format. It is the one place the key sets and ` +
        `grammars are written; without it every producer restates them and they drift`,
    );
  }

  const parserReady = statusOf.get(parserGroup) === "ready";
  const lagging = [...new Set(producers.filter((p) => statusOf.get(p.group) !== "ready").map((p) => p.group))].sort();
  if (parserReady && lagging.length) {
    problems.push(
      `"${parserGroup}" is ready, so consumers receive the parser -- but ${lagging.map((g) => `"${g}"`).join(", ")} ` +
        `${lagging.length === 1 ? "is" : "are"} still staged, and ${lagging.length === 1 ? "it carries" : "they carry"} ` +
        `documents that teach the declared form (${producers
          .filter((p) => lagging.includes(p.group))
          .map((p) => p.file)
          .join(", ")}). A consumer whose producers lag gets its own PRs refused by the parser it just received. ` +
        `Unstage every producer-bearing group first`,
    );
  }
  return { problems, producers, parserGroup, parserReady, lagging };
}

export function main() {
  const manifest = parseManifestYaml(readFileSync(MANIFEST, "utf8"));
  const payloadFiles = walk(join(REPO_ROOT, PAYLOAD_DIR), REPO_ROOT);
  const readFile = (file) => readFileSync(join(REPO_ROOT, file), "utf8");
  const { problems, producers, parserGroup, parserReady } = check(manifest, payloadFiles, readFile);

  if (problems.length) {
    for (const p of problems) console.error(`check-provenance-enabling: ${p}`);
    process.exitCode = 1;
    return;
  }
  const groups = [...new Set(producers.map((p) => p.group))].sort();
  console.log(
    `check-provenance-enabling: OK -- ${producers.length} producer file(s) across ${groups.length} group(s) ` +
      `(${groups.join(", ")}); parser in "${parserGroup}" is ${parserReady ? "ready" : "staged"}.`,
  );
  console.log(
    "  UNCHECKABLE HERE: each consuming repo owns .github/pull_request_template.md. Confirm that repo's " +
      "template emits the block before unstaging the parser for it.",
  );
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();

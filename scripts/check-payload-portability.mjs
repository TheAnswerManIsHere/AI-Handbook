#!/usr/bin/env node
/**
 * Does every reference in the payload resolve in a repository that is not this
 * one?
 *
 * WHY THIS EXISTS. `core/` came out of one product's repository. While it was
 * staged, the parts that only made sense there never mattered — the files only
 * ever ran in the repository they were written for. Syncing them makes those
 * parts **wrong instructions in a new place**: a consumer's agent follows a
 * link and finds nothing.
 *
 * Three review rounds on #54 each found one instance, and **not one of them
 * was found by a check** — every one was a reviewer reading files. "We fixed
 * the three we found" says nothing about how many remain. This is the class,
 * made mechanical.
 *
 * THIS CHECK IS NOT PAYLOAD, DELIBERATELY. It lives at `scripts/`, not
 * `core/scripts/`, because a consumer has no `core/` to check — shipping it
 * would be exactly the mistake it exists to catch. It is the handbook's own
 * check, like `check-root-wiring.mjs`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS AS A REFERENCE, AND WHY THE ANSWER IS NARROW
 *
 * A first pass over the payload reported 119 dangling references. 45 of them
 * were not references at all, and shipping a check with that much noise would
 * have meant "fixing" correct documentation:
 *
 *   - **Fenced code is not prose.** `writing-skills/anthropic-best-practices.md`
 *     illustrates skill layout with a fictional `pdf/` skill whose FORMS.md and
 *     REFERENCE.md are examples inside ```` fences. Twelve of them. Correct
 *     documentation, every one flagged.
 *   - **Placeholders are not paths.** `{baseDir}/references/foo.md` is a
 *     template; `.agents/memory/<path>` is prose. Neither names a file.
 *   - **Inline code is not a link.** A path inside backticks is being talked
 *     about, not linked to.
 *
 * So this reads MARKDOWN LINKS ONLY, outside fenced blocks and inline code.
 * A check that cries wolf gets suppressed wholesale, and then it protects
 * nothing — which is the same failure as not having it.
 *
 * WHAT IT DOES NOT CHECK. Product names in prose. A worked example naming one
 * product is explicitly blessed by the fleet contract — `known-failure-patterns.md`
 * grounds each pattern in a real case, which is the file working as designed.
 * A *link* to that product's document is different: the prose survives a move,
 * the link does not. Instructional dependence on a product's modules is real
 * and is handled by reading, not by this check.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { payloadFiles, routeOf } from "./sync.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Paths a consumer owns, which the payload may reference even though it never
 * ships them.
 *
 * Each entry is a promise: `docs/consuming-repos.md` tells a consumer to
 * create it, and enrollment is not complete until it exists. This list is the
 * machine-readable form of that table — the document already admitted nothing
 * in CI proved the table complete, and this is what proves it.
 *
 * Adding an entry here is a decision that a consumer must produce that file.
 * It is not a way to silence a broken link.
 */
export const CONSUMER_OWNED = new Set([
  "CLAUDE.md",                              // the repo's own overlay
  "AGENTS.md",                              // the repo's own routing constitution
  "docs/ai-context/decisions.md",           // settled decisions + rationale, per product
  "docs/ai-context/replit-environment.md",  // that repo's environment and its boundaries
  ".github/pull_request_template.md",       // outside this repo's reach entirely
  "docs/manual/README.md",                  // the product Manual, per product by definition
  "docs/ai-context",                        // the overlay's context directory
  "docs/engineering",                       // the overlay's engineering directory

  // These four are consumer-owned for a structural reason worth stating, because
  // the obvious move is to ship them and it is wrong. The payload and a consumer
  // share ONE path per file. A document that a consumer must specialise cannot
  // also live in the payload: abstracting it into `core/` strips the specifics
  // from the repo that wrote them on the very next sync -- the reverse-drift
  // damage #56 exists to prevent, self-inflicted.
  //
  // Each of these is substantially product-bound where it lives today (measured:
  // test-run-contract 4% of lines, migrations-and-backfills 10% plus a whole
  // tooling section, and both name concrete commands, schema paths and migration
  // numbers). Shipping them verbatim would hand every consumer another product's
  // commands as instructions; shipping them abstracted would delete that
  // product's hard-won specifics. So the repo that needs one writes its own, and
  // the payload refers to it without pretending to provide it.
  //
  // Whether the handbook should own FLEET-LEVEL testing and migration principles
  // as separate documents -- a different path, so nothing is overwritten -- is a
  // real question and deliberately not settled inside a portability pass.
  "docs/tests/test-run-contract.md",        // per-repo: its own commands and gates
  "docs/tests/TESTING.md",                  // per-repo: how ITS tests are run
  "docs/engineering/migrations-and-backfills.md", // per-repo: its schema tooling
  "docs/engineering/deferred-work.md",      // per-repo: its own deferred register
]);

/** A `{placeholder}`, a `<placeholder>`, or prose elision — not a path. */
const isPlaceholder = (t) => /[{}<>]/.test(t) || t.includes("...");

/**
 * Markdown link targets in `text`, ignoring fenced blocks and inline code.
 *
 * Fence handling follows CommonMark rather than toggling on ``` : a fence
 * closes only on a run of the SAME character at least as long as the opener.
 * The best-practices file nests ``` inside ````, and a naive toggle reads the
 * whole rest of that file as prose.
 */
export function linkTargets(text) {
  const targets = [];
  let fence = null;
  for (const line of text.split("\n")) {
    const opener = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (opener && opener[1][0] === fence[0] && opener[1].length >= fence.length) fence = null;
      continue;
    }
    if (opener) {
      fence = opener[1];
      continue;
    }
    for (const m of line.replace(/`[^`]*`/g, "").matchAll(/\]\(([^)]+)\)/g)) {
      const target = m[1].split("#")[0].trim();
      if (target) targets.push(target);
    }
  }
  return targets;
}

/** Resolve a link target against the file's DESTINATION path, `/`-separated. */
export function resolveFrom(fromDest, target) {
  const parts = fromDest.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

/**
 * Every payload reference that would not resolve in a consumer.
 *
 * Returns `{ from, target, resolved }` rows — `from` and `resolved` are
 * DESTINATION paths, because a consumer is where the breakage happens and
 * naming `core/…` there would describe a layout the reader does not have.
 */
export function danglingReferences(payloadRoot = resolve(REPO_ROOT, "core")) {
  const files = payloadFiles(payloadRoot);
  const shipped = new Set(files.map((f) => routeOf(f).to));
  const rows = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const dest = routeOf(file).to;
    const text = readFileSync(resolve(payloadRoot, file), "utf8");
    for (const target of linkTargets(text)) {
      if (/^(https?:|mailto:|#)/.test(target) || isPlaceholder(target)) continue;
      const resolved = resolveFrom(dest, target);
      if (shipped.has(resolved) || CONSUMER_OWNED.has(resolved)) continue;
      rows.push({ from: dest, target, resolved });
    }
  }
  return rows;
}

function main() {
  const rows = danglingReferences();
  if (rows.length === 0) {
    console.log("✓ payload portability: every reference resolves in a consumer.");
    return;
  }
  const byTarget = new Map();
  for (const row of rows) {
    if (!byTarget.has(row.resolved)) byTarget.set(row.resolved, []);
    byTarget.get(row.resolved).push(row.from);
  }
  console.error(
    `✗ ${rows.length} payload reference(s) to ${byTarget.size} path(s) a consumer will not have.\n` +
      `  A consumer's agent following one of these finds nothing.\n` +
      `  Fix each by: shipping the target in core/, adding it to CONSUMER_OWNED in this\n` +
      `  file if a consumer is genuinely required to create it, or removing the link and\n` +
      `  keeping the prose — an example may NAME a product's document, it may not LINK to it.\n`,
  );
  for (const [target, froms] of [...byTarget.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.error(`  ${String(froms.length).padStart(3)}  ${target}`);
    for (const from of [...new Set(froms)].sort()) console.error(`       from ${from}`);
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(`check-payload-portability: ${e.message}`);
    process.exit(1);
  }
}

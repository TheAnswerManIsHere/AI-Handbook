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
 * SO THIS USES A REAL MARKDOWN PARSER, AND THAT IS THE SECOND DESIGN, NOT THE
 * FIRST. The first read links by hand with regular expressions, and across
 * three review rounds that reader was wrong EIGHT times: it could not see
 * reference definitions, it left angle brackets on one of its two branches,
 * it swallowed a link title into the destination, it mistook a footnote for a
 * definition, it broke on multi-backtick code spans, it accepted four-space
 * indentation as a fence opener, and its scheme allowlist knew only lowercase
 * http(s) and mailto.
 *
 * Each of those was individually a small fix. Taking them one at a time is
 * precisely the trap: after two rounds of patching I twice said the class was
 * closed and was twice wrong, which is the same shape as #54's path defects —
 * ended there by changing the primitive rather than by a better audit.
 *
 * `marked` is CommonMark-compliant and, checked before adopting it, has ZERO
 * transitive dependencies. It gives fenced code, indented code, inline code
 * spans of any delimiter length, link titles, angle-bracketed destinations and
 * reference definitions correctly **by construction** — a code span is simply
 * a different token type, so a link inside one never exists to be found.
 *
 * WHY A DEPENDENCY IS ACCEPTABLE HERE AND NOT IN THE PAYLOAD. The rule that
 * kept this repository dependency-free protects `core/`, which is vendored
 * into consumers that must run it with no install step. **This file ships
 * nowhere.** It is the handbook's own check, so its cost is one devDependency
 * and one CI install step, and it buys the elimination of a defect class
 * rather than of eight defects. (David, 2026-09-09, choosing this over
 * patching the six or narrowing what the check claims.)
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

import { marked } from "marked";

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

  // These two were SHIPPED in this PR's first draft and un-shipped in round 1,
  // and the reason is worth keeping. I measured them "0% product-bound" with a
  // grep for one product's module names, and shipped them. But
  // `docs/consuming-repos.md` already listed both as consumer-owned, with
  // better reasoning than my measurement: uat-doc-format "names this repo's own
  // surfaces" -- product-bound in a way a token grep cannot see -- and
  // handoff/README documents a folder holding a repo's LIVE transit documents.
  // Reproduced: a consumer customising either had its edit silently overwritten
  // by the next sync. The measurement was of a token list, not of portability,
  // and the document that already answered the question went unread.
  "docs/handoff/README.md",                 // per-repo: its own transit folder
  "docs/tests/uat-doc-format.md",           // per-repo: names this repo's surfaces

  // The remaining rows of the enrollment table. Nothing in the payload links
  // to these today, so they are not load-bearing yet -- they are here because
  // the table and this set are two hand-maintained lists of one thing, and a
  // test below now refuses any table row this set lacks. That direction is the
  // one that breaks: a future link to a legitimately consumer-owned document
  // would otherwise fail CI and invite someone to "fix" a correct reference.
  "docs/ai-context/codex-environment.md",   // that repo's Codex sandbox
  "docs/ai-context/product-direction.md",   // product truth by definition
  "docs/ai-context/current-roadmap.md",     // per-product, read by several skills
  ".mcp.json",                              // the repo's own MCP server declarations
]);

/** A `{placeholder}`, a `<placeholder>`, or prose elision — not a path. */
const isPlaceholder = (t) => /[{}<>]/.test(t) || t.includes("...");

/**
 * Any URI scheme, or a protocol-relative URL — not a file in this repository.
 *
 * Matched GENERICALLY rather than by allowlist. The allowlist knew `http`,
 * `https` and `mailto` in lowercase, so `tel:`, `data:`, `ftp:` and even
 * `HTTPS:` were resolved as local paths and reported as missing files —
 * failing a required check over correct documentation. Schemes are
 * case-insensitive and open-ended, so enumerating them is the wrong shape.
 * (Codex, #62 round 3.)
 */
const isExternal = (t) => /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t) || t.startsWith("//");

/**
 * Every token that can hold children, walked without enumerating token types.
 *
 * Enumerating them is how a link inside a table cell or a nested list gets
 * missed silently — the failure mode this whole file exists to prevent, so it
 * is not reintroduced in the walker.
 */
function collectLinks(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectLinks(item, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  if ((node.type === "link" || node.type === "image") && typeof node.href === "string") {
    out.push(node.href);
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") collectLinks(value, out);
  }
}

/**
 * Markdown link destinations in `text`: inline links, images, and reference
 * definitions — whether or not a definition is ever used.
 *
 * Code spans and code blocks are absent by construction rather than stripped:
 * the parser gives them their own token types, so a link inside one is never a
 * link token at all.
 */
export function linkTargets(text) {
  const lexer = new marked.Lexer();
  const tokens = lexer.lex(text);
  const out = [];
  collectLinks(tokens, out);
  // A definition nothing references still names a file that has to exist.
  for (const def of Object.values(lexer.tokens?.links ?? {})) {
    if (def && typeof def.href === "string") out.push(def.href);
  }
  // The FILE is what has to exist, so a fragment is dropped: `./a.md#section`
  // and `./a.md` ask the same question. A bare `#section` drops to the empty
  // string and falls out below -- a same-document link names no file at all,
  // which is why this needs no separate anchor case downstream.
  const files = out.map((href) => href.split("#")[0].trim());
  return [...new Set(files.filter(Boolean))];
}

/**
 * Resolve a link target against the file's DESTINATION path, `/`-separated.
 *
 * Returns `null` when the target climbs ABOVE the repository root, because
 * there is no path to return and normalising it away is worse than useless:
 * `docs/a.md -> ../../CLAUDE.md` popped an empty array to no effect and came
 * back as `CLAUDE.md`, which is in CONSUMER_OWNED — so a link that escapes the
 * repository entirely was reported as fine. A broken reference laundered into
 * a pass is the exact failure this check exists to prevent. (Codex, #62
 * round 3.)
 *
 * A leading `/` is root-absolute and resets to the root rather than being
 * skipped as an empty segment, which had `/docs/a.md` resolving under the
 * linking file's own directory.
 */
export function resolveFrom(fromDest, target) {
  const parts = target.startsWith("/") ? [] : fromDest.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
}

/**
 * Every payload reference that would not resolve in a consumer.
 *
 * Returns `{ from, target, resolved }` rows — `from` and `resolved` are
 * DESTINATION paths, because a consumer is where the breakage happens and
 * naming `core/…` there would describe a layout the reader does not have.
 * `resolved` is `null` for a target that climbs above the repository root:
 * there is no such path, and reporting it is the point.
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
      if (isExternal(target) || isPlaceholder(target)) continue;
      const resolved = resolveFrom(dest, target);
      if (resolved !== null && (shipped.has(resolved) || CONSUMER_OWNED.has(resolved))) continue;
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
    const key = row.resolved ?? `${row.target}  ← climbs above the repository root`;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(row.from);
  }
  console.error(
    `✗ ${rows.length} payload reference(s) to ${byTarget.size} path(s) a consumer will not have.\n` +
      `  A consumer's agent following one of these finds nothing.\n` +
      `  Fix each by: shipping the target in core/, adding it to CONSUMER_OWNED in this\n` +
      `  file if a consumer is genuinely required to create it, or removing the link and\n` +
      `  keeping the prose — an example may NAME a product's document, it may not LINK to it.\n` +
      `  A target marked as climbing above the root has too many \`..\` segments to name\n` +
      `  anything inside the repository; fix the depth.\n`,
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

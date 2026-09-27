#!/usr/bin/env node
/**
 * check-payload-banners — every payload file the sync manages says so in its
 * own text.
 *
 * ONE RULE: every tracked file under `core/` that is not a seed carries the
 * `SYNCED FROM AI-Handbook` header within the window `sync.mjs` reads.
 *
 * WHY THIS EXISTS. The sync deletes a consumer file when that file carries the
 * header and the payload no longer routes anything to its path (#55). It keeps
 * no ledger of what it delivered -- the ledger was the root of all four ways
 * the first removing sync deleted the wrong thing -- so the header IS the
 * record. A payload file without one is a file the sync can deliver and never
 * take back: remove or rename it in the handbook and every consumer keeps the
 * old copy, loaded and obeyed. This check makes that impossible to merge
 * rather than something to remember.
 *
 * Seeds are exempt, and must be: a seed lands as a consumer-owned file
 * (`settings.json`, `machinery.json`) that the sync never replaces and never
 * deletes -- `machinery.json` only gains keys it lacks -- and `settings.json`
 * cannot carry a header at all -- Claude Code
 * refuses a settings file over any unrecognised key.
 *
 * The predicate and the reader are `sync.mjs`'s own (`carriesBanner`,
 * `headOf`), so the file this check accepts is exactly the file the sync will
 * recognise.
 */
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { carriesBanner, headOf, routeOf, BANNER_WINDOW } from "./sync.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Non-seed payload files lacking the header, as paths relative to the repo root. */
export function missingBanners(repoRoot = REPO_ROOT) {
  const tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "-z", "core"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  if (!tracked.length) {
    // A check that found nothing to check has not passed.
    throw new Error(`no tracked files under ${repoRoot}/core -- refusing to report a clean payload having read none`);
  }
  return tracked.filter((rel) => {
    if (routeOf(rel.slice("core/".length)).seed) return false;
    return !carriesBanner(headOf(join(repoRoot, rel)));
  });
}

function main() {
  const missing = missingBanners();
  if (!missing.length) {
    console.log("✓ payload-banners: every non-seed payload file carries the sync header.");
    return;
  }
  console.error(`✗ payload-banners: ${missing.length} payload file(s) lack the sync header:`);
  for (const f of missing) console.error(`  - ${f}`);
  console.error(
    "\nThe sync deletes a consumer's copy of a file the payload stops shipping only if that\n" +
      "copy carries the header, so a file without one can be delivered and never taken back.\n\n" +
      `Add the header as a whole comment line within the first ${BANNER_WINDOW} lines, in the\n` +
      "file's own comment syntax -- after a shebang or front matter is fine:\n" +
      "  <!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. … -->   (Markdown, HTML)\n" +
      "  // SYNCED FROM AI-Handbook — do not edit in a consumer repo. …        (JS, TS, DOT)\n" +
      "  # SYNCED FROM AI-Handbook — do not edit in a consumer repo. …         (shell, Python, .gitignore)\n" +
      '  "$comment": "SYNCED FROM AI-Handbook — do not edit in a consumer repo. …",  (JSON)\n',
  );
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

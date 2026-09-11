#!/usr/bin/env node
/**
 * Copy the payload into a consuming repository.
 *
 * WHAT THIS REPLACED, AND WHY. This sync was described in 1,325 lines of
 * `sync-manifest.yml` and validated by 1,176 lines of `check-manifest.mjs`,
 * and it had never been written. Of the 20 routes that manifest declared, 18
 * were exactly `core/X -> X` and the 2 exceptions were `*.template.*` files
 * landing under their real name, so the whole of it encoded two rules.
 *
 * There is no staging. `status: staged|ready`, the `requires` graph, cohorts
 * and `flipsWith` sequenced a rollout to consumers that do not exist yet.
 *
 * THIS SYNC ONLY ADDS. It never deletes, so a file removed from the payload
 * stays in a consumer that already has it. That gap is #55, deliberately not
 * fixed here: a removing sync was written and reverted after one review round
 * found four ways it deleted the wrong thing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE WRITE PATH LOOKS LIKE THIS, AND WHY IT IS NOT A PILE OF GUARDS
 *
 * Six defects in this file came from treating a path as a string rather than
 * as the thing it names, across four review rounds:
 *
 *   1. a seed marker matched against the wrong part of a filename
 *   2. a self-sync refusal defeated by a symlinked checkout
 *   3. a stored path compared against a recomputed one across platforms
 *   4. a write that followed a SYMLINK at its destination, out of the
 *      consumer, overwriting an unrelated file and reporting success
 *   5. a write that truncated a HARD-LINKED inode, doing the same thing
 *      while passing the symlink check -- a hard link is not a link, it is a
 *      second name, and `lstat` reports an ordinary file
 *   6. `git ls-files` output parsed by line, which Git quotes for unusual
 *      names and `trim()` mutates for leading or trailing whitespace
 *
 * After 4 I audited every path in the file and called the class closed. Round
 * 4 then produced 5 and 6. Enumerating filesystem edge cases by inspection
 * had failed twice, so this version stops enumerating and changes the
 * primitives instead:
 *
 *   BYTES COME FROM THE COMMITTED TREE, not the working tree. `git archive`
 *   materializes exactly what is committed, so a dirty checkout cannot ship
 *   an unreviewed edit, filenames arrive as Git actually recorded them
 *   rather than as a line parser guessed, and ignored runtime evidence
 *   (`core/.agents/receipts/pr-*.json` are live readiness receipts) cannot
 *   be swept in.
 *
 *   EVERY WRITE IS A TEMPORARY FILE PLUS AN ATOMIC RENAME. A rename replaces
 *   a directory entry. It cannot follow a symlink, cannot truncate a
 *   hard-linked inode, and cannot leave a half-written file -- whether or
 *   not those cases were foreseen. That is the difference that matters here:
 *   correct by construction rather than by my enumeration.
 *
 * The directory-component check below remains, because rename protects the
 * final entry and a symlinked PARENT would still put the whole write
 * somewhere else.
 *
 * Usage:
 *   node scripts/sync.mjs --to <consumer-repo-path> [--dry-run]
 */
import { execFileSync } from "node:child_process";
import {
  lstatSync, mkdirSync, mkdtempSync, copyFileSync, renameSync, rmSync,
  existsSync, realpathSync, readdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Same as, or inside? Both must already be REAL paths. */
export function isInside(parent, child) {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * Extract the committed payload tree to a temporary directory and return it.
 *
 * REFUSES A DIRTY PAYLOAD rather than silently shipping something other than
 * the working tree in front of you. Reading committed bytes is the correct
 * behaviour -- an unreviewed local edit must not reach a consumer -- but
 * doing that quietly while `core/` differs would be its own surprise.
 */
export function materializePayload(repoRoot = REPO_ROOT) {
  const dirty = execFileSync("git", ["-C", repoRoot, "status", "--porcelain", "--", "core"], {
    encoding: "utf8",
  }).trim();
  if (dirty) {
    throw new Error(
      `the payload has uncommitted changes, and this sync ships COMMITTED bytes:\n${dirty}\n` +
        `Commit or stash them, so what a consumer receives is what was reviewed`,
    );
  }
  const out = mkdtempSync(join(tmpdir(), "handbook-payload-"));
  const tar = execFileSync("git", ["-C", repoRoot, "archive", "HEAD:core"], {
    maxBuffer: 256 * 1024 * 1024,
    encoding: "buffer",
  });
  execFileSync("tar", ["-x", "-C", out], { input: tar, maxBuffer: 256 * 1024 * 1024 });
  return out;
}

/** Every file in a materialized payload, as `/`-separated relative paths. */
export function payloadFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      // lstat, never stat: describe the tree, not what a link points at.
      if (lstatSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

/**
 * The one seed a sync may add absent keys to.
 *
 * NOT EVERY JSON SEED, which is where this landed first and was wrong.
 * `machinery.json` is a REGISTRY: the payload's own scripts read it, and a key
 * absent from it means the consumer was seeded before that key existed --
 * there is no other reading. `settings.json` is CONFIGURATION: its absent keys
 * are decisions. This very repository is the proof, and its `CLAUDE.md` says
 * so in as many words -- the handbook's own `.claude/settings.json` carries no
 * `env` block because it has no database, and a top-up would have restored the
 * template's placeholder `DATABASE_URL` on the next sync, silently, in the
 * file that also carries permissions and hooks. (Codex, #79 round 2, on a
 * round-1 fix of mine that sized the mechanism instead of the need.)
 *
 * So the list is a list, and a second entry needs the same argument made
 * again: absent means never-seeded, not deliberately-removed.
 */
export const TOPPED_UP_SEEDS = new Set([".agents/machinery.json"]);

/**
 * Where one payload file lands, whether it is a seed, and whether an existing
 * copy may be topped up with keys it lacks.
 *
 * A SEED is copied under its real name and ONLY when absent.
 * `settings.json` and `machinery.json` are consumer-owned from the moment
 * they land -- a repo edits its own permissions and identity.
 */
export function routeOf(rel) {
  const parts = rel.split("/");
  const name = parts[parts.length - 1];
  // `.template` sits immediately before the final extension
  // (`machinery.template.json`), NOT at the end of the stem.
  const seeded = name.replace(/\.template(?=\.[^.]+$)/, "");
  if (seeded !== name) {
    const to = [...parts.slice(0, -1), seeded].join("/");
    return { to, seed: true, topUp: TOPPED_UP_SEEDS.has(to) };
  }
  return { to: rel, seed: false, topUp: false };
}

/**
 * The top-level keys a JSON seed declares that the consumer's own copy lacks.
 *
 * WHY A SEED IS NOT SIMPLY LEFT ALONE FOREVER. `machinery.json` is
 * consumer-owned from the moment it lands, and the sync has always respected
 * that by skipping it. But the payload's REQUIREMENTS grow: Phase 1 of
 * AI-Handbook #36 made a `models` block required, and every consumer seeded
 * before it would have received the new scripts and then refused every
 * dispatch and every plan-review round at `modelTier()` until a human edited
 * the file by hand -- the review machinery disabled fleet-wide by a sync that
 * reported success (Codex, #79 round 1).
 *
 * So `machinery.json` -- and only the seeds in `TOPPED_UP_SEEDS`, for the
 * reason stated there -- is topped up: keys the template declares and the
 * consumer's copy does not get added, with the template's values. Nothing the
 * consumer already has is touched -- not its identity, not its required
 * checks, not a `models` block it has already tuned.
 *
 * A copy that is not parseable JSON is left entirely alone and reported: the
 * sync does not get to guess at a file it cannot read.
 */
export function topUpKeys(templatePath, targetPath) {
  let template;
  let current;
  try {
    template = JSON.parse(readFileSync(templatePath, "utf8"));
    current = JSON.parse(readFileSync(targetPath, "utf8"));
  } catch {
    return [];
  }
  if (!template || typeof template !== "object" || Array.isArray(template)) return [];
  if (!current || typeof current !== "object" || Array.isArray(current)) return [];
  // REAL KEYS ONLY, plus the doc entry that belongs to one being added.
  // `_README`, `_repo` and their kin are prose the template carries to explain
  // a field; restoring one a consumer deliberately stripped would be the sync
  // editorialising in a file it does not own. But a field arriving for the
  // first time should arrive with its explanation, or a consumer meets a key
  // it has no way to understand.
  const added = Object.keys(template).filter((k) => !k.startsWith("_") && !Object.hasOwn(current, k));
  const docs = added.map((k) => `_${k}`).filter((k) => Object.hasOwn(template, k) && !Object.hasOwn(current, k));
  return [...added, ...docs];
}

/** Apply `topUpKeys`, preserving every value the consumer already declared. */
export function topUpSeed(templatePath, targetPath) {
  const added = topUpKeys(templatePath, targetPath);
  if (!added.length) return added;
  const template = JSON.parse(readFileSync(templatePath, "utf8"));
  const current = JSON.parse(readFileSync(targetPath, "utf8"));
  for (const key of added) current[key] = template[key];
  writeFileSync(targetPath, `${JSON.stringify(current, null, 2)}\n`);
  return added;
}

/**
 * Refuse a symlink among a destination path's DIRECTORY components.
 *
 * The final entry is handled by the atomic rename, which replaces it rather
 * than writing through it. A linked parent is the case rename cannot help
 * with: `mkdirSync(..., {recursive:true})` traverses it without complaint,
 * and then the temporary file and its rename both happen outside.
 */
export function assertNoSymlinkOnPath(destReal, to) {
  const parts = to.split("/");
  let cur = destReal;
  for (const segment of parts.slice(0, -1)) {
    cur = join(cur, segment);
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      return; // nothing here yet
    }
    if (st.isSymbolicLink()) {
      throw new Error(
        `refusing to write through a symlink: ${cur} is a link, so the copy would land outside ` +
          `the consumer. Remove the link, or the sync would silently modify whatever it points at`,
      );
    }
  }
}

/**
 * Place one file at `target` atomically.
 *
 * The temporary lives in the destination's own directory so the rename stays
 * within one filesystem, which is what makes it atomic.
 */
function placeAtomically(src, target) {
  const tmp = `${target}.handbook-sync-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;
  try {
    copyFileSync(src, tmp);
    renameSync(tmp, target);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export function sync(dest, { dryRun = false, log = console.log, payloadRoot = null } = {}) {
  const owned = payloadRoot === null;
  const root = owned ? materializePayload() : payloadRoot;
  const destReal = realpathSync(dest);
  const counts = { copied: 0, seeded: 0, seedKept: 0, toppedUp: 0 };

  try {
    for (const rel of payloadFiles(root)) {
      const { to, seed, topUp } = routeOf(rel);
      assertNoSymlinkOnPath(destReal, to);
      const target = join(destReal, to);

      // A seed the consumer already has is theirs. `lstatSync` rather than
      // `existsSync` so a dangling link still counts as present -- it is
      // something the consumer put there either way.
      let present = true;
      try { lstatSync(target); } catch { present = false; }
      if (seed && present) {
        const added = !topUp ? [] : dryRun ? topUpKeys(join(root, rel), target) : topUpSeed(join(root, rel), target);
        if (added.length) {
          counts.toppedUp += 1;
          log(`  top up ${to}  (seed, consumer owns it -- added absent key(s): ${added.join(", ")})`);
        } else {
          counts.seedKept += 1;
          log(`  keep   ${to}  (seed, already present -- consumer owns it)`);
        }
        continue;
      }

      if (!dryRun) {
        mkdirSync(dirname(target), { recursive: true });
        // Prove the directory we are about to write into is still inside the
        // consumer AFTER creating it.
        const parentReal = realpathSync(dirname(target));
        if (!isInside(destReal, parentReal)) {
          throw new Error(`refusing to write outside the consumer: ${parentReal} is not inside ${destReal}`);
        }
        placeAtomically(join(root, rel), target);
      }

      if (seed) {
        counts.seeded += 1;
        log(`  seed   ${rel}  ->  ${to}`);
      } else {
        counts.copied += 1;
        log(`  copy   ${to}`);
      }
    }
  } finally {
    if (owned) rmSync(root, { recursive: true, force: true });
  }
  return counts;
}

function main(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--to") flags.to = argv[++i];
    else if (argv[i] === "--dry-run") flags.dryRun = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!flags.to) throw new Error("usage: node scripts/sync.mjs --to <consumer-repo-path> [--dry-run]");
  const dest = resolve(flags.to);
  if (!existsSync(dest)) throw new Error(`destination ${dest} does not exist`);
  // Canonical paths: `resolve` does not follow symlinks, so a symlinked
  // checkout reaches this repo under a different string and the equality
  // fails -- writing core/ over the handbook's own root, which is the one
  // destination this refusal exists to prevent.
  if (realpathSync(dest) === realpathSync(REPO_ROOT)) {
    throw new Error("refusing to sync the handbook onto itself");
  }

  console.log(`sync: ${REPO_ROOT}/core (committed) -> ${dest}${flags.dryRun ? "  (dry run)" : ""}`);
  const c = sync(dest, { dryRun: flags.dryRun });
  console.log(
    `sync: ${c.copied} file(s) copied, ${c.seeded} seeded, ${c.seedKept} seed(s) left alone` +
      (c.toppedUp ? `, ${c.toppedUp} seed(s) topped up with new keys` : "") +
      `${flags.dryRun ? " -- nothing written" : ""}`,
  );
}

// Compare as a URL: a checkout path needing escaping (a space, a `#`) makes a
// hand-built `file://` string differ from `import.meta.url`. Same defect as
// #11. And `process.argv[1]` is undefined when this module is imported by a
// runtime with no script path, where `pathToFileURL(undefined)` THROWS -- so
// the guard that decides "am I the entry point?" crashed the importer instead
// of answering no.
const invokedAs = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedAs && import.meta.url === invokedAs) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`sync: ${e.message}`);
    process.exit(1);
  }
}

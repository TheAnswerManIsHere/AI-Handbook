#!/usr/bin/env node
/**
 * Copy the payload into a consuming repository.
 *
 * WHAT THIS REPLACED, AND WHY. This sync was described in 1,325 lines of
 * `sync-manifest.yml` and validated by 1,176 lines of `check-manifest.mjs`,
 * and it had never been written. Measured against the manifest before it was
 * deleted: of the 20 routes it declared, 18 were exactly `core/X -> X`, and
 * the 2 exceptions were both `*.template.*` files landing under their real
 * name. Every `exclude:` in it existed only because one tree had been split
 * into thirteen groups; each excluded file was carried by another group, so
 * the net effect was that every file under `core/` shipped.
 *
 * So the manifest encoded two rules, and this file is those two rules.
 *
 * THE STAGING APPARATUS IS GONE ON PURPOSE. `status: staged|ready`, the
 * `requires` graph, cohorts and `flipsWith` existed to sequence a rollout to
 * live consumers. Nothing is launched and no consumer depends on this payload,
 * so there is no rollout risk to sequence -- the machinery was managing a
 * hazard that does not yet exist.
 *
 * THIS SYNC ONLY ADDS. IT NEVER DELETES, AND THAT IS DELIBERATE.
 *
 * A file removed from the payload is therefore NOT removed from a consumer
 * that already has it. That is a real gap, tracked as #55 rather than fixed
 * here. A removing sync was written and then reverted: one review round found
 * four distinct ways it deleted the wrong thing, and it was solving nothing
 * yet, since no consumer has ever been synced and no stale file can exist.
 *
 * EVERY PATH IS TREATED AS A THING, NOT A STRING. That rule is written here
 * because breaking it produced four separate defects in this one file: a
 * seed marker matched against the wrong part of a name; a self-sync refusal
 * defeated by a symlinked checkout; a stored path compared against a
 * recomputed one across platforms that spell paths differently; and a write
 * that followed a symlink at its destination out of the consumer entirely,
 * overwriting an unrelated file and reporting success. The fifth was in the
 * entry-point check below, which is the same defect this file's own
 * `pathToFileURL` comment was written about. Anything here that computes,
 * compares or writes to a path is therefore explicit about which it is doing.
 *
 * Usage:
 *   node scripts/sync.mjs --to <consumer-repo-path> [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, copyFileSync, existsSync, realpathSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD = join(REPO_ROOT, "core");

/**
 * Is `child` the same as, or inside, `parent`? Both must already be real
 * paths -- this compares resolved locations, never the strings that named
 * them.
 */
export function isInside(parent, child) {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * Every payload file, as `/`-separated paths relative to `core/`.
 *
 * FROM GIT, NOT FROM THE FILESYSTEM. A directory walk also finds ignored
 * runtime evidence -- `core/.agents/receipts/pr-*.json` are live readiness
 * receipts, gitignored here and gitignored again at the destination -- and
 * copying one into a consumer would overwrite its current receipt and make
 * its merge guard refuse, with nothing saying why. What ships is what is
 * committed; `git ls-files` is the only enumeration that says so.
 *
 * SEPARATORS ARE NORMALIZED HERE, once. `git ls-files` already emits `/` on
 * every platform, which is why this is the enumeration that makes the rest of
 * the file safe: `routeOf` splits on `/`, and feeding it `path.relative`
 * output would have reintroduced the platform-separator defect that the
 * reverted removal path was withdrawn for.
 */
export function payloadFiles() {
  const out = execFileSync("git", ["-C", REPO_ROOT, "ls-files", "--cached", "--", "core"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^core\//, ""))
    .sort();
}

/**
 * Where one payload file lands, and whether it is a seed.
 *
 * A SEED is copied under its real name and ONLY when absent.
 * `settings.json` and `machinery.json` are consumer-owned from the moment
 * they land -- a consumer edits its own permissions and its own repo
 * identity. Overwriting them on every sync would clobber that.
 *
 * Exported and pure so the rule can be tested directly, rather than by
 * copying files and looking at a directory afterwards.
 */
export function routeOf(rel) {
  const parts = rel.split("/");
  const name = parts[parts.length - 1];
  // `.template` sits immediately before the final extension
  // (`machinery.template.json`), NOT at the end of the stem -- reading it as
  // a stem suffix matched nothing and silently shipped the template under its
  // own name. Caught by the equivalence oracle, not by review.
  const seeded = name.replace(/\.template(?=\.[^.]+$)/, "");
  if (seeded !== name) return { to: [...parts.slice(0, -1), seeded].join("/"), seed: true };
  return { to: rel, seed: false };
}

/**
 * Refuse to write through a symlink anywhere on a destination path.
 *
 * WHY EVERY COMPONENT, NOT JUST THE LAST. `copyFileSync` follows a symlink at
 * the destination and writes to its target, so a link at
 * `docs/engineering/code-review.md` sends the copy wherever it points --
 * measured, and it overwrote a file outside the consumer entirely while the
 * run reported success. A link at an intermediate DIRECTORY does the same
 * thing more quietly: `mkdirSync(..., {recursive: true})` traverses it
 * without complaint, and then every file beneath lands outside too.
 *
 * A consumer legitimately owning a symlink at a payload path is not a case
 * worth supporting: the payload's whole claim is that these paths are the
 * handbook's, and silently replacing someone's link would be its own
 * destruction. Refusing is the only option that neither writes outside the
 * consumer nor destroys a structure the consumer built on purpose.
 */
export function assertNoSymlinkOnPath(destReal, to) {
  let cur = destReal;
  for (const segment of to.split("/")) {
    cur = join(cur, segment);
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      return; // nothing here yet, so nothing to follow
    }
    if (st.isSymbolicLink()) {
      throw new Error(
        `refusing to write through a symlink: ${cur} is a link, and copying would write to its ` +
          `target instead of to the consumer. Remove the link, or the sync would silently modify ` +
          `whatever it points at`,
      );
    }
  }
}

export function sync(dest, { dryRun = false, log = console.log } = {}) {
  const destReal = realpathSync(dest);
  const counts = { copied: 0, seeded: 0, seedKept: 0 };

  for (const rel of payloadFiles()) {
    const { to, seed } = routeOf(rel);
    assertNoSymlinkOnPath(destReal, to);
    const target = join(destReal, to);

    // `existsSync` follows links; the check above has already established
    // there is no link on this path, so a true here means a real file.
    if (seed && existsSync(target)) {
      counts.seedKept += 1;
      log(`  keep   ${to}  (seed, already present -- consumer owns it)`);
      continue;
    }
    if (!dryRun) {
      mkdirSync(dirname(target), { recursive: true });
      // Belt and braces: prove the directory we are about to write into is
      // still inside the consumer AFTER creating it. The component walk above
      // is the primary defence; this catches anything it could not see,
      // and costs one syscall per file.
      const parentReal = realpathSync(dirname(target));
      if (!isInside(destReal, parentReal)) {
        throw new Error(`refusing to write outside the consumer: ${parentReal} is not inside ${destReal}`);
      }
      copyFileSync(join(PAYLOAD, rel), target);
    }
    if (seed) {
      counts.seeded += 1;
      log(`  seed   ${rel}  ->  ${to}`);
    } else {
      counts.copied += 1;
      log(`  copy   ${to}`);
    }
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
  // Compare CANONICAL paths. `resolve` normalises `..` and makes a path
  // absolute but does not follow symlinks, so a symlinked checkout reaches
  // this repo under a different string, the equality fails, and the sync
  // then writes core/ over the handbook's own root -- the one destination
  // this refusal exists to prevent, arriving through the alias.
  if (realpathSync(dest) === realpathSync(REPO_ROOT)) {
    throw new Error("refusing to sync the handbook onto itself");
  }

  console.log(`sync: ${PAYLOAD} -> ${dest}${flags.dryRun ? "  (dry run)" : ""}`);
  const c = sync(dest, { dryRun: flags.dryRun });
  console.log(
    `sync: ${c.copied} file(s) copied, ${c.seeded} seeded, ${c.seedKept} seed(s) left alone` +
      `${flags.dryRun ? " -- nothing written" : ""}`,
  );
}

// Compare as a URL: a checkout path needing escaping (a space, a `#`) makes a
// hand-built `file://` string differ from `import.meta.url`, and this would
// then silently do nothing. Same defect as #11, same fix.
//
// `process.argv[1]` is undefined when this module is imported by a runtime
// that has no script path (`node --input-type=module -e '…'`), and
// `pathToFileURL(undefined)` THROWS -- so the guard that exists to decide
// "am I the entry point?" crashed the importer instead of answering no.
// Found while verifying an unrelated finding, and it is the same family as
// the four above: a path used without asking whether there is one.
const invokedAs = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedAs && import.meta.url === invokedAs) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`sync: ${e.message}`);
    process.exit(1);
  }
}

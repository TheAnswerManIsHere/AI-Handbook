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
 * hazard that does not yet exist. When a consumer is live and a staged
 * rollout is genuinely needed, the thing to add is the smallest mechanism
 * that delivers it, not this one back.
 *
 * Usage:
 *   node scripts/sync.mjs --to <consumer-repo-path> [--dry-run]
 */
import { readdirSync, statSync, mkdirSync, copyFileSync, existsSync, realpathSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD = join(REPO_ROOT, "core");

/**
 * THIS SYNC ONLY ADDS. IT NEVER DELETES, AND THAT IS DELIBERATE.
 *
 * A file removed from the payload is therefore NOT removed from a consumer
 * that already has it. That is a real gap, and it is tracked rather than
 * fixed here.
 *
 * WHY IT IS NOT FIXED HERE. A removing sync was written and then reverted.
 * One review round found four distinct ways it deleted the wrong thing: a
 * ledger entry containing `..` escaped the destination; a file converting to
 * a seed was deleted instead of preserved; Windows path separators made every
 * prior entry look removed, deleting everything just copied; and a
 * file-to-directory change aborted mid-copy. Every one of those destroys
 * consumer work, which is the only thing this script must never do.
 *
 * And it was solving nothing yet: no consumer has ever been synced, so no
 * stale file can exist to remove. It was speculative machinery guarding a
 * hazard with no instances -- the same mistake as the staging system this
 * change deletes, at smaller scale. Build it when the first consumer is real
 * and the deletion can be tested against an actual tree.
 */


/** Every file under `core/`, as paths relative to it. */
export function payloadFiles(dir = PAYLOAD, base = PAYLOAD) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...payloadFiles(full, base));
    else out.push(relative(base, full));
  }
  return out.sort();
}

/**
 * Where one payload file lands, and whether it is a seed.
 *
 * A SEED is copied under its real name and ONLY when absent.
 * `settings.json` and `machinery.json` are consumer-owned from the moment
 * they land -- a consumer edits its own permissions and its own repo
 * identity. Overwriting them on every sync would clobber that, which is the
 * one way this script could destroy work rather than merely deliver it.
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
  // own name. Caught by the equivalence oracle against the old manifest.
  const seeded = name.replace(/\.template(?=\.[^.]+$)/, "");
  if (seeded !== name) return { to: [...parts.slice(0, -1), seeded].join("/"), seed: true };
  return { to: rel, seed: false };
}

export function sync(dest, { dryRun = false, log = console.log } = {}) {
  const counts = { copied: 0, seeded: 0, seedKept: 0 };
  for (const rel of payloadFiles()) {
    const { to, seed } = routeOf(rel);
    const target = join(dest, to);
    if (seed && existsSync(target)) {
      counts.seedKept += 1;
      log(`  keep   ${to}  (seed, already present -- consumer owns it)`);
      continue;
    }
    if (!dryRun) {
      mkdirSync(dirname(target), { recursive: true });
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
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`sync: ${e.message}`);
    process.exit(1);
  }
}

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync,
  symlinkSync, linkSync, statSync, readdirSync, realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  routeOf, payloadFiles, sync, isInside, assertNoSymlinkOnPath, materializePayload, topUpKeys, topUpSeed,
  carriesBanner, staleFiles, uncommittedPaths,
} from "../sync.mjs";
import { missingBanners } from "../check-payload-banners.mjs";

const silent = () => {};
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
// A consumer is a git checkout: the sync finds what it manages through the
// consumer's index, and refuses a directory that has none.
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), "sync-test-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@example.invalid");
  git(dir, "config", "user.name", "sync test");
  git(dir, "config", "commit.gpgsign", "false");
  return dir;
};
const commitAll = (dir) => {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--allow-empty", "-m", "sync");
};
const BANNER = "<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. -->";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Materialize the committed payload ONCE and hand it to the tests, so the
// suite exercises the real tree without paying for an archive per test.
//
// This does NOT go through `materializePayload`, deliberately. That function
// refuses a dirty payload, which is right for a sync but wrong for a test
// suite: editing a payload file then running the tests made all seventeen
// fail -- including a pure path-comparison test -- because the `before` hook
// threw and every case died with it. A cascade that points nowhere near its
// cause is worse than the check is worth here, so the suite archives HEAD
// directly and the refusal gets its own dedicated test below.
function archiveHead() {
  const out = mkdtempSync(join(tmpdir(), "sync-test-payload-"));
  const tar = execFileSync("git", ["-C", REPO_ROOT, "archive", "HEAD:core"],
    { maxBuffer: 256 * 1024 * 1024, encoding: "buffer" });
  execFileSync("tar", ["-x", "-C", out], { input: tar, maxBuffer: 256 * 1024 * 1024 });
  return out;
}

let PAYLOAD;
before(() => { PAYLOAD = archiveHead(); });
after(() => { if (PAYLOAD) rmSync(PAYLOAD, { recursive: true, force: true }); });

const run = (dest, opts = {}) => sync(dest, { log: silent, payloadRoot: PAYLOAD, ...opts });
const countFiles = (dir) => {
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (e === ".git") continue;
      const f = join(d, e);
      if (statSync(f).isDirectory()) walk(f);
      else n++;
    }
  };
  walk(dir);
  return n;
};

// ── routing ────────────────────────────────────────────────────────────────

test("a plain payload file keeps its path, minus the core/ prefix", () => {
  assert.deepEqual(routeOf("scripts/plan-review.mjs"), { to: "scripts/plan-review.mjs", seed: false, topUp: false });
  assert.deepEqual(routeOf(".claude/skills/pr-watch/SKILL.md"), { to: ".claude/skills/pr-watch/SKILL.md", seed: false, topUp: false });
});

test("a .template. file lands under its real name and is marked a seed", () => {
  // Reading `.template` as a suffix of the stem before the FIRST dot matched
  // nothing, so the template shipped under its own name. Caught by an
  // equivalence oracle against the deleted manifest, not by review.
  assert.deepEqual(routeOf(".agents/machinery.template.json"), { to: ".agents/machinery.json", seed: true, topUp: true });
  assert.deepEqual(routeOf(".claude/settings.template.json"), { to: ".claude/settings.json", seed: true, topUp: false });
});

test("'template' elsewhere in a name is not a seed", () => {
  assert.deepEqual(routeOf("docs/template-guide.md"), { to: "docs/template-guide.md", seed: false, topUp: false });
  assert.deepEqual(routeOf("docs/the.template"), { to: "docs/the.template", seed: false, topUp: false });
});

test("only the two known seeds are seeds, across the real payload", () => {
  const seeds = payloadFiles(PAYLOAD).filter((f) => routeOf(f).seed).sort();
  assert.deepEqual(seeds, [".agents/machinery.template.json", ".claude/settings.template.json"]);
});

test("no two payload files collide on one destination", () => {
  const seen = new Map();
  for (const f of payloadFiles(PAYLOAD)) {
    const { to } = routeOf(f);
    assert.equal(seen.get(to), undefined, `${f} and ${seen.get(to)} both land at ${to}`);
    seen.set(to, f);
  }
});

// ── what gets enumerated ───────────────────────────────────────────────────

test("the payload comes from the committed tree, so ignored evidence never ships", () => {
  // core/.agents/receipts/pr-*.json are live readiness receipts, gitignored
  // here and at the destination. A working-tree walk includes them, and a
  // foreign receipt landing in a consumer makes its merge guard refuse with
  // nothing saying why.
  //
  // This CREATES the condition rather than asserting over whatever the tree
  // holds: written the other way it passed with the bug present, because
  // there were no ignored files at that moment.
  const ignored = join(REPO_ROOT, "core/.agents/receipts/pr-999999.json");
  writeFileSync(ignored, '{"pr":999999}');
  try {
    const root = archiveHead();
    try {
      const files = payloadFiles(root);
      assert.ok(files.length > 100, `expected a real payload, got ${files.length}`);
      assert.ok(existsSync(ignored), "the ignored file is really on disk");
      assert.ok(!files.some((f) => f.includes("pr-999999")), "a gitignored receipt must not ship");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  } finally {
    rmSync(ignored, { force: true });
  }
});

test("a dirty payload is refused rather than silently shipping committed bytes", () => {
  // Reading committed bytes is correct -- an unreviewed local edit must not
  // reach a consumer -- but doing it quietly while core/ differs from what
  // you see would be its own surprise.
  const victim = join(REPO_ROOT, "core/.agents/PLANS.md");
  const original = readFileSync(victim);
  writeFileSync(victim, Buffer.concat([original, Buffer.from("\nlocal edit\n")]));
  try {
    assert.throws(() => materializePayload(REPO_ROOT), /uncommitted changes/);
  } finally {
    writeFileSync(victim, original);
  }
});

test("payload paths are forward-slash separated", () => {
  for (const f of payloadFiles(PAYLOAD)) assert.ok(!f.includes("\\"), `${f} carries a backslash`);
});

// ── delivery ───────────────────────────────────────────────────────────────

test("a fresh consumer receives every payload file, and no temporaries", () => {
  const dest = fresh();
  try {
    const counts = run(dest);
    assert.equal(counts.copied + counts.seeded, payloadFiles(PAYLOAD).length);
    assert.ok(existsSync(join(dest, ".agents/machinery.json")));
    assert.ok(!existsSync(join(dest, ".agents/machinery.template.json")));
    assert.equal(countFiles(dest), payloadFiles(PAYLOAD).length, "no stray temporary files");
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("a re-sync never clobbers a value the consumer has edited", () => {
  const dest = fresh();
  try {
    run(dest);
    const owned = join(dest, ".agents/machinery.json");
    writeFileSync(owned, '{"repo":"consumer/edited"}');
    run(dest);
    // The consumer's OWN value is what must survive, and it does. The file is
    // no longer byte-identical because a seed is now topped up with keys the
    // template requires and this copy lacks -- without which a consumer
    // seeded before a new required key received the scripts that need it and
    // refused every invocation. (Codex, #79 round 1.)
    const after = JSON.parse(readFileSync(owned, "utf8"));
    assert.equal(after.repo, "consumer/edited");
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("a settings key the consumer DELETED stays deleted across a re-sync", () => {
  // THE CASE THE FIRST VERSION OF THIS TEST COULD NOT FAIL. It re-synced an
  // untouched copy and asserted the bytes matched -- which they did, because a
  // fresh copy carries every template key, so there was nothing to top up. The
  // top-up then applied to every JSON seed, and a consumer that had removed a
  // top-level key would have had the template's value restored silently, in
  // the file carrying its permissions, hooks and environment. This repository
  // is that consumer: its own `.claude/settings.json` has no `env` block
  // because it has no database. (Codex, #79 round 2.)
  const dest = fresh();
  try {
    run(dest);
    const owned = join(dest, ".claude/settings.json");
    const settings = JSON.parse(readFileSync(owned, "utf8"));
    assert.ok(settings.env?.DATABASE_URL, "the template must still seed an env block for this test to mean anything");
    delete settings.env;
    delete settings.model;
    const deliberate = `${JSON.stringify(settings, null, 2)}\n`;
    writeFileSync(owned, deliberate);
    run(dest);
    assert.equal(readFileSync(owned, "utf8"), deliberate, "an absent settings key is a decision, not a gap to backfill");
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("machinery.json is the only seed a sync tops up", () => {
  // The restriction is a list, and a second entry is a decision rather than an
  // accident -- so the list itself is asserted against the real payload.
  const toppedUp = payloadFiles(PAYLOAD).filter((f) => routeOf(f).topUp).map((f) => routeOf(f).to);
  assert.deepEqual(toppedUp, [".agents/machinery.json"]);
});

// ── deletion (#55): no ledger, so nothing stored can be wrong ─────────────
//
// The first removing sync was reverted after one round found four ways it
// deleted the wrong thing. Each of those cases has a test below, named for it,
// run against a consumer that is a real git checkout.

/** A synced, committed consumer holding one extra tracked file at `rel`. */
function consumerWith(rel, content) {
  const dest = fresh();
  run(dest);
  mkdirSync(dirname(join(dest, rel)), { recursive: true });
  writeFileSync(join(dest, rel), content);
  commitAll(dest);
  return dest;
}

test("a tracked file carrying the header that the payload no longer ships is deleted", () => {
  // The shape of the first real instance: #160 deleted plan-provenance.mjs and
  // its format document from the payload, and Overhype kept both.
  const dest = consumerWith("scripts/plan-provenance.mjs", `#!/usr/bin/env node\n// SYNCED FROM AI-Handbook — do not edit.\nexport {};\n`);
  try {
    const counts = run(dest);
    assert.equal(counts.deleted, 1);
    assert.ok(!existsSync(join(dest, "scripts/plan-provenance.mjs")));
    assert.ok(existsSync(join(dest, "scripts/review-proxy.mjs")), "a file the payload still ships is untouched");
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("a dry run names the deletion and deletes nothing", () => {
  const dest = consumerWith("docs/ai-context/retired.md", `${BANNER}\n# Retired\n`);
  try {
    const lines = [];
    const counts = sync(dest, { log: (l) => lines.push(l), payloadRoot: PAYLOAD, dryRun: true });
    assert.equal(counts.deleted, 1);
    assert.ok(lines.some((l) => l.includes("delete docs/ai-context/retired.md")), lines.join("\n"));
    assert.ok(existsSync(join(dest, "docs/ai-context/retired.md")));
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("the consumer's own files are never deleted: no header, or not tracked", () => {
  const dest = consumerWith("docs/ai-context/product-brief.md", "# Our product\n");
  try {
    // The phrase inside a line is prose or a string literal, not a claim.
    writeFileSync(join(dest, "docs/quoting.md"), "Synced files open with SYNCED FROM AI-Handbook in a comment.\n");
    commitAll(dest);
    // Untracked, even with the header: the consumer's work in progress.
    writeFileSync(join(dest, "docs/draft2.md"), `${BANNER}\n`);
    const counts = run(dest);
    assert.equal(counts.deleted, 0);
    for (const f of ["docs/ai-context/product-brief.md", "docs/quoting.md", "docs/draft2.md"]) {
      assert.ok(existsSync(join(dest, f)), `${f} must survive`);
    }
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("reverted case 1: a stale path that resolves outside the consumer is refused, not followed", () => {
  // The ledger version deleted whatever a stored `..` path pointed at. Git
  // never lists such a path, so the reachable form is a directory replaced by
  // a symlink after the file under it was committed.
  const dest = consumerWith("old/stale.md", `${BANNER}\n`);
  const outside = fresh();
  try {
    writeFileSync(join(outside, "stale.md"), `${BANNER}\nPRECIOUS\n`);
    rmSync(join(dest, "old"), { recursive: true });
    symlinkSync(outside, join(dest, "old"));
    assert.throws(() => run(dest), /symlink/);
    assert.equal(readFileSync(join(outside, "stale.md"), "utf8"), `${BANNER}\nPRECIOUS\n`);
  } finally {
    rmSync(dest, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("reverted case 2: a routed destination is never deleted, whatever it contains", () => {
  // The ledger version deleted a consumer's config when a managed file became
  // a seed: the seed's destination fell off the delivered list. Here the
  // consumer's settings.json carries the header -- the state a file that was
  // managed and then became a seed would leave behind -- and survives.
  const dest = fresh();
  try {
    run(dest);
    const owned = join(dest, ".claude/settings.json");
    const settings = JSON.parse(readFileSync(owned, "utf8"));
    const withHeader = `{\n  "$comment": "SYNCED FROM AI-Handbook — do not edit.",${JSON.stringify(settings, null, 2).slice(1)}\n`;
    writeFileSync(owned, withHeader);
    commitAll(dest);
    const counts = run(dest);
    assert.equal(counts.deleted, 0);
    assert.equal(readFileSync(owned, "utf8"), withHeader, "the consumer's seed copy is untouched");
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("reverted case 3: paths come from the consumer's own index, one separator, nothing stored", () => {
  // The ledger version read a Linux-written ledger on Windows as every entry
  // removed. There is no stored path now: git reports the consumer's tracked
  // paths with `/` on every platform, and the routes are computed in the same
  // run. A nested stale file is found under its exact route-shaped path, and
  // the directories it leaves empty go with it.
  const dest = consumerWith(".claude/skills/retired-skill/SKILL.md", `---\nname: x\n---\n\n${BANNER}\n`);
  try {
    const routed = new Set(payloadFiles(PAYLOAD).map((f) => routeOf(f).to));
    assert.deepEqual(staleFiles(realpathSync(dest), routed), [".claude/skills/retired-skill/SKILL.md"]);
    run(dest);
    assert.ok(!existsSync(join(dest, ".claude/skills/retired-skill")), "its emptied directory is pruned");
    assert.ok(existsSync(join(dest, ".claude/skills/pr-watch/SKILL.md")), "and a sibling is untouched");
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("reverted case 4: a stale file where the payload needs a directory is cleared before the copy", () => {
  // File -> directory: a stale FILE at `docs/engineering` blocks the payload's
  // `docs/engineering/code-review.md`. Deletion runs first, so the copy lands.
  const dest = fresh();
  try {
    writeFileSync(join(dest, "placeholder"), "x");
    mkdirSync(join(dest, "docs"), { recursive: true });
    writeFileSync(join(dest, "docs/engineering"), `${BANNER}\n`);
    commitAll(dest);
    run(dest);
    assert.ok(statSync(join(dest, "docs/engineering")).isDirectory());
    assert.ok(existsSync(join(dest, "docs/engineering/code-review.md")));
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("reverted case 4, the other way: stale files where the payload needs a file are cleared first", () => {
  // Directory -> file: stale files under `docs/engineering/code-review.md/`
  // block the payload's file of that name. Deleting them empties the
  // directory, pruning removes it, and the copy lands.
  const dest = fresh();
  try {
    mkdirSync(join(dest, "docs/engineering/code-review.md"), { recursive: true });
    writeFileSync(join(dest, "docs/engineering/code-review.md/part.md"), `${BANNER}\n`);
    commitAll(dest);
    run(dest);
    assert.ok(statSync(join(dest, "docs/engineering/code-review.md")).isFile());
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("a stale file with uncommitted edits refuses the whole sync, before anything is written", () => {
  const dest = consumerWith("docs/ai-context/retired.md", `${BANNER}\n# Retired\n`);
  try {
    writeFileSync(join(dest, "docs/ai-context/retired.md"), `${BANNER}\n# Retired, with a local edit\n`);
    rmSync(join(dest, "docs/engineering/code-review.md"));
    assert.throws(() => run(dest), /uncommitted edits:\n {2}docs\/ai-context\/retired\.md/);
    assert.ok(existsSync(join(dest, "docs/ai-context/retired.md")), "the edited file survives");
    assert.ok(!existsSync(join(dest, "docs/engineering/code-review.md")), "and nothing was copied either");
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("uncommittedPaths reads both sides of a staged rename", () => {
  const dest = consumerWith("a.md", "x\n");
  try {
    git(dest, "mv", "a.md", "b.md");
    const dirty = uncommittedPaths(dest);
    assert.ok(dirty.has("a.md") && dirty.has("b.md"), [...dirty].join(", "));
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("a destination that is not a git checkout is refused, rather than reported clean", () => {
  const plain = mkdtempSync(join(tmpdir(), "sync-test-plain-"));
  try {
    assert.throws(() => run(plain), /not a git checkout/);
    assert.equal(countFiles(plain), 0);
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }
});

test("a subdirectory of a checkout is refused: the routes are relative to its root", () => {
  const dest = fresh();
  try {
    mkdirSync(join(dest, "sub"));
    assert.throws(() => run(join(dest, "sub")), /is not its root/);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("a second sync after the first is committed changes nothing", () => {
  const dest = consumerWith("scripts/plan-provenance.mjs", "// SYNCED FROM AI-Handbook — do not edit.\n");
  try {
    run(dest);
    commitAll(dest);
    const again = run(dest);
    assert.equal(again.deleted, 0);
    assert.equal(git(dest, "status", "--porcelain"), "", "the second run leaves no diff");
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("every file a sync delivers is one a later sync can take back", () => {
  // The header is the only record, so a delivered file without one would be
  // delivered forever. The real payload, not a fixture.
  const dest = fresh();
  try {
    run(dest);
    const unmanaged = payloadFiles(PAYLOAD)
      .filter((f) => !routeOf(f).seed)
      .filter((f) => !carriesBanner(readFileSync(join(dest, routeOf(f).to), "utf8")));
    assert.deepEqual(unmanaged, []);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("check-payload-banners names a payload file that lacks the header", () => {
  const repo = fresh();
  try {
    mkdirSync(join(repo, "core/docs"), { recursive: true });
    writeFileSync(join(repo, "core/docs/managed.md"), `${BANNER}\n`);
    writeFileSync(join(repo, "core/docs/unmanaged.md"), "# no header\n");
    writeFileSync(join(repo, "core/docs/quoted.md"), "the words SYNCED FROM AI-Handbook, in prose\n");
    mkdirSync(join(repo, "core/.claude"), { recursive: true });
    writeFileSync(join(repo, "core/.claude/settings.template.json"), "{}\n");
    commitAll(repo);
    assert.deepEqual(missingBanners(repo), ["core/docs/quoted.md", "core/docs/unmanaged.md"]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("check-payload-banners refuses a tree with no payload, rather than passing it", () => {
  const repo = fresh();
  try {
    assert.throws(() => missingBanners(repo), /refusing to report a clean payload/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a header past the first 64 KiB is invisible to the check, as it is to the sync", () => {
  const repo = fresh();
  try {
    mkdirSync(join(repo, "core"), { recursive: true });
    writeFileSync(join(repo, "core/late.md"), `${"x".repeat(70 * 1024)}\n${BANNER}\n`);
    commitAll(repo);
    assert.deepEqual(missingBanners(repo), ["core/late.md"]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("the header is read only within the window, as a whole comment line", () => {
  assert.equal(carriesBanner(`#!/usr/bin/env bash\n# SYNCED FROM AI-Handbook — x\n`), true);
  assert.equal(carriesBanner(`{\n  "$comment": "SYNCED FROM AI-Handbook — x",\n}`), true);
  assert.equal(carriesBanner(`writeFileSync(abs, "<!-- SYNCED FROM AI-Handbook — do not edit -->");`), false);
  assert.equal(carriesBanner(`${"\n".repeat(40)}// SYNCED FROM AI-Handbook — x\n`), false);
});

test("a dry run reports what it would do and writes nothing", () => {
  const dest = fresh();
  try {
    const counts = run(dest, { dryRun: true });
    assert.equal(counts.copied + counts.seeded, payloadFiles(PAYLOAD).length);
    assert.equal(countFiles(dest), 0);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

// ── the write path: correct by construction, not by enumeration ────────────

test("a SYMLINK at a destination file is replaced, not written through", () => {
  // Measured before the rewrite: copyFileSync followed the link and
  // overwrote a file entirely outside the consumer, reporting success.
  // The atomic rename replaces the directory entry instead.
  const dest = fresh();
  const outside = fresh();
  try {
    const victim = join(outside, "victim.md");
    writeFileSync(victim, "PRECIOUS");
    mkdirSync(join(dest, "docs/engineering"), { recursive: true });
    symlinkSync(victim, join(dest, "docs/engineering/code-review.md"));

    run(dest);
    assert.equal(readFileSync(victim, "utf8"), "PRECIOUS", "the external file must be untouched");
    assert.ok(readFileSync(join(dest, "docs/engineering/code-review.md"), "utf8").length > 100);
  } finally {
    rmSync(dest, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a HARD LINK at a destination file does not truncate the shared inode", () => {
  // A hard link is not a link: it is a second name for one inode, and lstat
  // reports an ordinary file, so the symlink guard cannot see it. copyFileSync
  // truncated the inode and changed the external file. Rename swaps the
  // directory entry and leaves the inode alone.
  const dest = fresh();
  const outside = fresh();
  try {
    const victim = join(outside, "victim.md");
    writeFileSync(victim, "PRECIOUS");
    mkdirSync(join(dest, "docs/engineering"), { recursive: true });
    linkSync(victim, join(dest, "docs/engineering/code-review.md"));
    assert.equal(statSync(victim).ino, statSync(join(dest, "docs/engineering/code-review.md")).ino);

    run(dest);
    assert.equal(readFileSync(victim, "utf8"), "PRECIOUS", "the external file must be untouched");
  } finally {
    rmSync(dest, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a SYMLINK at an intermediate DIRECTORY is refused", () => {
  // The one case rename cannot help with: mkdirSync(..., {recursive:true})
  // traverses a linked directory, and then the temporary file AND its rename
  // both happen outside the consumer.
  const dest = fresh();
  const outside = fresh();
  try {
    mkdirSync(join(outside, "engineering"), { recursive: true });
    mkdirSync(join(dest, "docs"), { recursive: true });
    symlinkSync(join(outside, "engineering"), join(dest, "docs/engineering"));

    assert.throws(() => run(dest), /refusing to write through a symlink/);
    assert.equal(countFiles(outside), 0, "nothing may land outside");
  } finally {
    rmSync(dest, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("isInside compares locations, not string prefixes", () => {
  assert.equal(isInside("/a/b", "/a/b"), true);
  assert.equal(isInside("/a/b", "/a/b/c"), true);
  assert.equal(isInside("/a/b", "/a/bc"), false, "the prefix trap");
  assert.equal(isInside("/a/b", "/a"), false);
});

test("assertNoSymlinkOnPath ignores the final entry, which rename handles", () => {
  const dest = fresh();
  try {
    mkdirSync(join(dest, "docs"), { recursive: true });
    writeFileSync(join(dest, "docs/real.md"), "x");
    symlinkSync("/etc/hostname", join(dest, "docs/linked.md"));
    // A link at the FINAL component is fine -- rename replaces it.
    assert.doesNotThrow(() => assertNoSymlinkOnPath(dest, "docs/linked.md"));
    assert.doesNotThrow(() => assertNoSymlinkOnPath(dest, "docs/nothing/here.md"));
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

// --- #79 round 1: a seed the consumer owns still gains newly-required keys ---

test("a JSON seed gains keys the template added, and loses nothing it has", () => {
  // Phase 1 of AI-Handbook #36 made a `models` block required. Every consumer
  // seeded before it would have received the new scripts and then refused
  // every dispatch and every plan-review round until a human edited the file
  // by hand -- the review machinery disabled fleet-wide by a sync that
  // reported success. (Codex, #79 round 1.)
  const dir = mkdtempSync(join(tmpdir(), "topup-"));
  const template = join(dir, "machinery.template.json");
  const target = join(dir, "machinery.json");
  writeFileSync(
    template,
    JSON.stringify({ repo: "OWNER/REPO", requiredChecks: ["X"], models: { strongestClaude: { id: "a-b", effort: "xhigh" } } }, null, 2),
  );
  writeFileSync(target, JSON.stringify({ repo: "Real/Consumer", requiredChecks: ["Their Job"] }, null, 2));

  assert.deepEqual(topUpKeys(template, target), ["models"]);
  assert.deepEqual(topUpSeed(template, target), ["models"]);

  const after = JSON.parse(readFileSync(target, "utf8"));
  assert.equal(after.repo, "Real/Consumer", "the consumer's identity is untouched");
  assert.deepEqual(after.requiredChecks, ["Their Job"], "and its policy");
  assert.equal(after.models.strongestClaude.id, "a-b", "and the absent key arrived");

  // Idempotent: a second sync adds nothing.
  assert.deepEqual(topUpKeys(template, target), []);
});

test("a key the consumer already tuned is never overwritten", () => {
  const dir = mkdtempSync(join(tmpdir(), "topup-own-"));
  const template = join(dir, "m.template.json");
  const target = join(dir, "m.json");
  writeFileSync(template, JSON.stringify({ models: { strongestClaude: { id: "seed-value", effort: "xhigh" } } }));
  writeFileSync(target, JSON.stringify({ models: { strongestClaude: { id: "their-own-choice", effort: "high" } } }));

  assert.deepEqual(topUpSeed(template, target), []);
  assert.equal(JSON.parse(readFileSync(target, "utf8")).models.strongestClaude.id, "their-own-choice");
});

test("a copy that is not parseable JSON is left entirely alone", () => {
  // The sync does not get to guess at a file it cannot read.
  const dir = mkdtempSync(join(tmpdir(), "topup-bad-"));
  const template = join(dir, "m.template.json");
  const target = join(dir, "m.json");
  writeFileSync(template, JSON.stringify({ models: {} }));
  writeFileSync(target, "{ this is not json");

  assert.deepEqual(topUpKeys(template, target), []);
  assert.equal(readFileSync(target, "utf8"), "{ this is not json");
});

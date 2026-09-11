import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync,
  symlinkSync, linkSync, statSync, readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  routeOf, payloadFiles, sync, isInside, assertNoSymlinkOnPath, materializePayload, topUpKeys, topUpSeed,
} from "../sync.mjs";

const silent = () => {};
const fresh = () => mkdtempSync(join(tmpdir(), "sync-test-"));
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
  assert.deepEqual(routeOf("scripts/pr-ready.mjs"), { to: "scripts/pr-ready.mjs", seed: false, topUp: false });
  assert.deepEqual(routeOf(".claude/guard.sh"), { to: ".claude/guard.sh", seed: false, topUp: false });
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

test("the sync never deletes anything, including files it no longer ships", () => {
  const dest = fresh();
  try {
    run(dest);
    const stale = join(dest, "docs/ai-context/no-longer-shipped.md");
    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(stale, "a file the payload does not contain");
    run(dest);
    assert.ok(existsSync(stale), "an unshipped file must survive a re-sync");
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
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

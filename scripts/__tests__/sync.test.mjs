import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { routeOf, payloadFiles, sync, isInside, assertNoSymlinkOnPath } from "../sync.mjs";

const silent = () => {};
const fresh = () => mkdtempSync(join(tmpdir(), "sync-test-"));
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("a plain payload file keeps its path, minus the core/ prefix", () => {
  assert.deepEqual(routeOf("scripts/pr-ready.mjs"), { to: "scripts/pr-ready.mjs", seed: false });
  assert.deepEqual(routeOf(".claude/guard.sh"), { to: ".claude/guard.sh", seed: false });
  assert.deepEqual(routeOf(".agents/core/claude-core.md"), { to: ".agents/core/claude-core.md", seed: false });
});

test("a .template. file lands under its real name and is marked a seed", () => {
  // The bug this pins: reading `.template` as a suffix of the stem before the
  // FIRST dot matched nothing here, so the template shipped under its own
  // name and a consumer got `.agents/machinery.template.json` -- a file
  // nothing reads. Caught by the equivalence oracle, not by review.
  assert.deepEqual(routeOf(".agents/machinery.template.json"), {
    to: ".agents/machinery.json",
    seed: true,
  });
  assert.deepEqual(routeOf(".claude/settings.template.json"), {
    to: ".claude/settings.json",
    seed: true,
  });
});

test("'template' elsewhere in a name is not a seed", () => {
  // Only the segment immediately before the final extension counts. A doc
  // about templates must not be silently renamed.
  assert.deepEqual(routeOf("docs/template-guide.md"), { to: "docs/template-guide.md", seed: false });
  assert.deepEqual(routeOf("docs/the.template"), { to: "docs/the.template", seed: false });
});

test("every payload file routes somewhere, and only the two seeds are seeds", () => {
  const files = payloadFiles();
  assert.ok(files.length > 100, `expected a real payload, got ${files.length} files`);
  const seeds = files.filter((f) => routeOf(f).seed);
  assert.deepEqual(seeds.sort(), [".agents/machinery.template.json", ".claude/settings.template.json"]);
});

test("no two payload files collide on one destination", () => {
  // A collision would mean one file silently overwrote another in the
  // consumer, with the loser's absence indistinguishable from never shipping.
  const seen = new Map();
  for (const f of payloadFiles()) {
    const { to } = routeOf(f);
    assert.equal(seen.get(to), undefined, `${f} and ${seen.get(to)} both land at ${to}`);
    seen.set(to, f);
  }
});

test("a fresh consumer receives every payload file", () => {
  const dest = fresh();
  try {
    const counts = sync(dest, { log: silent });
    assert.equal(counts.copied + counts.seeded, payloadFiles().length);
    assert.equal(counts.seedKept, 0);
    assert.ok(existsSync(join(dest, ".agents/machinery.json")));
    assert.ok(existsSync(join(dest, ".claude/settings.json")));
    assert.ok(!existsSync(join(dest, ".agents/machinery.template.json")));
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("a re-sync never clobbers a seed the consumer has edited", () => {
  // The one way this script could destroy work rather than deliver it.
  const dest = fresh();
  try {
    sync(dest, { log: silent });
    const owned = join(dest, ".agents/machinery.json");
    writeFileSync(owned, '{"repo":"consumer/edited"}');
    const counts = sync(dest, { log: silent });
    assert.equal(readFileSync(owned, "utf8"), '{"repo":"consumer/edited"}');
    assert.equal(counts.seedKept, 2);
    assert.equal(counts.seeded, 0);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("a seed IS written when the consumer does not have it yet", () => {
  const dest = fresh();
  try {
    // Pre-create only one of the two, so the other must still be seeded.
    mkdirSync(dirname(join(dest, ".claude/settings.json")), { recursive: true });
    writeFileSync(join(dest, ".claude/settings.json"), "{}");
    const counts = sync(dest, { log: silent });
    assert.equal(counts.seeded, 1);
    assert.equal(counts.seedKept, 1);
    assert.equal(readFileSync(join(dest, ".claude/settings.json"), "utf8"), "{}");
    assert.ok(existsSync(join(dest, ".agents/machinery.json")));
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("the sync never deletes anything, including files it no longer ships", () => {
  // A removing sync was written and reverted: one review round found four
  // ways it deleted the wrong thing, and it was guarding a hazard with no
  // instances (no consumer has ever been synced). This pins the ADD-ONLY
  // contract so a future removal feature is a deliberate change to it, not
  // an accident. Removal is tracked separately.
  const dest = fresh();
  try {
    sync(dest, { log: silent });
    const stale = join(dest, "docs/ai-context/no-longer-shipped.md");
    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(stale, "a file the payload does not contain");
    const theirs = join(dest, "docs/ai-context/this-product-only.md");
    writeFileSync(theirs, "product-specific, not ours");

    sync(dest, { log: silent });

    assert.ok(existsSync(stale), "an unshipped file must survive a re-sync");
    assert.equal(readFileSync(theirs, "utf8"), "product-specific, not ours");
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("a dry run reports what it would do and writes nothing", () => {
  const dest = fresh();
  try {
    const counts = sync(dest, { dryRun: true, log: silent });
    assert.equal(counts.copied + counts.seeded, payloadFiles().length);
    assert.ok(!existsSync(join(dest, ".claude/guard.sh")));
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test("a symlink at a destination FILE is refused, not followed", () => {
  // Measured before the fix: copyFileSync followed the link and overwrote a
  // file entirely outside the consumer, while the run reported success.
  const dest = fresh();
  const outside = fresh();
  try {
    const victim = join(outside, "victim.md");
    writeFileSync(victim, "PRECIOUS");
    mkdirSync(join(dest, "docs/engineering"), { recursive: true });
    symlinkSync(victim, join(dest, "docs/engineering/code-review.md"));

    assert.throws(() => sync(dest, { log: silent }), /refusing to write through a symlink/);
    assert.equal(readFileSync(victim, "utf8"), "PRECIOUS", "the external file must be untouched");
  } finally {
    rmSync(dest, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a symlink at an intermediate DIRECTORY is refused too", () => {
  // The quieter half: mkdirSync(..., {recursive:true}) traverses a linked
  // directory without complaint, and then every file beneath it lands
  // outside the consumer.
  const dest = fresh();
  const outside = fresh();
  try {
    mkdirSync(join(outside, "engineering"), { recursive: true });
    mkdirSync(join(dest, "docs"), { recursive: true });
    symlinkSync(join(outside, "engineering"), join(dest, "docs/engineering"));

    assert.throws(() => sync(dest, { log: silent }), /refusing to write through a symlink/);
    assert.ok(!existsSync(join(outside, "engineering/code-review.md")), "nothing may land outside");
  } finally {
    rmSync(dest, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("the payload is enumerated from git, so ignored evidence never ships", () => {
  // core/.agents/receipts/pr-*.json are live readiness receipts, gitignored
  // here and at the destination. A filesystem walk includes them; a foreign
  // receipt landing in a consumer overwrites its own and makes its merge
  // guard refuse, with nothing saying why.
  //
  // This test CREATES the condition rather than asserting over whatever the
  // tree happens to hold. Written first as a plain assertion over the real
  // payload, it passed with the bug present -- there were no ignored files at
  // that moment -- which is a test that proves nothing.
  const ignored = join(REPO_ROOT, "core/.agents/receipts/pr-999999.json");
  writeFileSync(ignored, '{"pr":999999}');
  try {
    const files = payloadFiles();
    assert.ok(files.length > 100, `expected a real payload, got ${files.length}`);
    assert.ok(existsSync(ignored), "the ignored file is really on disk");
    assert.ok(
      !files.some((f) => f.includes("pr-999999")),
      "a gitignored receipt must not be enumerated as payload",
    );
    assert.ok(!files.some((f) => /loop-round-check-/.test(f)), "no round-check receipts");
  } finally {
    rmSync(ignored, { force: true });
  }
});

test("payload paths are forward-slash separated regardless of platform", () => {
  // routeOf splits on "/". Feeding it path.relative output reintroduces the
  // platform-separator defect the removal path was reverted for.
  for (const f of payloadFiles()) {
    assert.ok(!f.includes("\\"), `${f} carries a backslash separator`);
  }
});

test("isInside compares locations, not string prefixes", () => {
  assert.equal(isInside("/a/b", "/a/b"), true);
  assert.equal(isInside("/a/b", "/a/b/c"), true);
  // The prefix trap: /a/bc is NOT inside /a/b.
  assert.equal(isInside("/a/b", "/a/bc"), false);
  assert.equal(isInside("/a/b", "/a"), false);
});

test("assertNoSymlinkOnPath is silent when the path is clean or absent", () => {
  const dest = fresh();
  try {
    assert.doesNotThrow(() => assertNoSymlinkOnPath(dest, "does/not/exist/yet.md"));
    mkdirSync(join(dest, "docs"), { recursive: true });
    writeFileSync(join(dest, "docs/real.md"), "x");
    assert.doesNotThrow(() => assertNoSymlinkOnPath(dest, "docs/real.md"));
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

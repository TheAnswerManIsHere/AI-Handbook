import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { routeOf, payloadFiles, sync } from "../sync.mjs";

const silent = () => {};
const fresh = () => mkdtempSync(join(tmpdir(), "sync-test-"));

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

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ROLES, SEES_BUILDER_FRAMING, buildBrief, modelRequestedFor, rawFindings, docAtCommit } from "../fable-brief.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const agentPath = (name) => join(ROOT, ".claude", "agents", `${name}.md`);

/** A snapshot carrying threads, as `snapshot-from-captures.mjs` emits with --threads. */
const snapshotWith = (threads) => ({ path: "/tmp/s.json", text: JSON.stringify({ reviewThreads: threads }), parsed: { reviewThreads: threads } });

test("every role names an agent definition that exists", () => {
  for (const [role, spec] of Object.entries(ROLES)) {
    assert.ok(existsSync(agentPath(spec.agent)), `${role} names ${spec.agent}, which has no definition`);
  }
});

test("every role's definition pins a CONCRETE model, never an alias", () => {
  // #36's prerequisite. `model: fable` is an alias, so "it ran on 5.1" would be
  // probably-true and not established. The brief stamps what was requested.
  for (const [role, spec] of Object.entries(ROLES)) {
    const model = modelRequestedFor(spec.agent);
    assert.match(model, /^claude-[a-z0-9-]+$/, `${role} (${spec.agent}) pins "${model}", which is not a concrete id`);
  }
});

test("an alias in a definition is refused rather than dispatched unpinned", () => {
  // The adjudicator pins `best` deliberately -- it should follow the strongest
  // tier -- so it is the live example of a definition this must refuse.
  assert.throws(() => modelRequestedFor("review-loop-adjudicator"), /alias, not a pinned id/);
});

test("a role that reads findings refuses a brief with no snapshot", () => {
  for (const [role, spec] of Object.entries(ROLES)) {
    if (!spec.needsSnapshot) continue;
    assert.throws(
      () => buildBrief({ role, pr: 1, base: "a".repeat(40), head: "b".repeat(40) }),
      /--snapshot is required/,
      `${role} accepted a brief with no findings`,
    );
  }
});

test("a round-check-only snapshot is refused, not silently read as zero findings", () => {
  assert.throws(() => rawFindings({}), /round-check-only/);
  assert.throws(() => rawFindings({ reviewThreads: undefined }), /round-check-only/);
});

test("rawFindings carries the reviewer's first comment only, never the builder's replies", () => {
  const threads = [
    {
      id: "T1",
      isResolved: true,
      comments: [
        { path: "a.md", line: 3, body: "REVIEWER: this claim is too broad" },
        { path: "a.md", line: 3, body: "BUILDER: fixed in abc1234, here is why I was right anyway" },
      ],
    },
  ];
  const [f] = rawFindings(threads.length ? { reviewThreads: threads } : {});
  assert.equal(f.body, "REVIEWER: this claim is too broad");
  assert.equal(f.replyCount, 1);
  assert.ok(!JSON.stringify(f).includes("BUILDER:"), "a builder reply reached the brief");
});

test("only D4 may receive the builder's framing", () => {
  assert.deepEqual(Object.keys(SEES_BUILDER_FRAMING), ["D4"]);
  const options = { path: "/tmp/o.txt", text: "Option 1 ... Option 2 ...", parsed: null };
  for (const [role, spec] of Object.entries(ROLES)) {
    if (role === "D4") continue;
    assert.throws(
      () =>
        buildBrief({
          role,
          pr: 1,
          options,
          snapshot: spec.needsSnapshot ? snapshotWith([]) : null,
          base: spec.needsRange ? "a".repeat(40) : null,
          head: spec.needsRange ? "b".repeat(40) : null,
        }),
      /only D4 may see the builder's framing/,
      `${role} accepted the builder's framing`,
    );
  }
});

test("D4 refuses to run WITHOUT the framing, because the framing is its subject", () => {
  assert.throws(() => buildBrief({ role: "D4", pr: 1 }), /--options is required/);
});

test("a role that opines on a document refuses an empty brief", () => {
  // The defect this test exists for was live: D1 assembled a brief with empty
  // provenance and would have collected a confident opinion about nothing.
  for (const [role, spec] of Object.entries(ROLES)) {
    if (!spec.needsDoc) continue;
    assert.throws(() => buildBrief({ role, pr: 1 }), /--doc and --doc-commit are required/);
  }
});

test("a document is read from git at a pinned commit, never from the working tree", () => {
  assert.throws(() => docAtCommit("main", "README.md"), /not a commit sha/);
  assert.throws(() => docAtCommit("a".repeat(40), "no/such/file.md"), /refusing rather than reading the working tree/);
});

test("an unknown role is refused", () => {
  assert.throws(() => buildBrief({ role: "D9", pr: 1 }), /unknown role/);
});

test("the brief records its provenance and says what it contains", () => {
  const brief = buildBrief({ role: "B1", pr: 68, snapshot: snapshotWith([{ id: "T", comments: [{ body: "x", path: "p", line: 1 }] }]) });
  assert.equal(brief.provenance.length, 1);
  assert.equal(brief.provenance[0].input, "snapshot");
  assert.match(brief.provenance[0].sha256, /^[0-9a-f]{64}$/);
  assert.match(brief.contract, /No text written by the session driving the loop is present\./);
  assert.equal(brief.modelRequested, modelRequestedFor(ROLES.B1.agent));
});

test("D4's contract states the one exception rather than claiming purity", () => {
  const dir = mkdtempSync(join(tmpdir(), "fable-"));
  const p = join(dir, "o.txt");
  writeFileSync(p, "Option 1 / Option 2");
  const brief = buildBrief({ role: "D4", pr: 68, options: { path: p, text: readFileSync(p, "utf8"), parsed: null } });
  assert.match(brief.contract, /except builderFraming, which is the object under review/);
  assert.equal(brief.builderFraming.verbatim, "Option 1 / Option 2");
});

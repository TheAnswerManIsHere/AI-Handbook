// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyCaps,
  artifactDiff,
  artifactFileList,
  artifactStats,
  assertAdjudicationSnapshot,
  assertArtifactEndpoints,
  assertThreadProvenance,
  buildRecord,
  cappedDiff,
  declineCitationFor,
  findingsByTerritory,
  parseFrontmatter,
  planOracleFor,
  planReviewSignals,
  readAtCommit,
  sectionOf,
  PATCH_CAP_CHARS,
  RECORD_TOTAL_CAP_CHARS,
} from "../review-loop-record.mjs";

// The payload no longer knows one repo's name; tests declare their own.
const TEST_SLUG = "TestOwner/TestRepo";

// ---------------------------------------------------------------------------
// assertAdjudicationSnapshot: the evidence-freshness gate added in PR #539
// round 3 -- a record's own analysis is only as current as the issueComments
// it actually read, so that capture time must be present and parseable
// before anything downstream trusts it.
// ---------------------------------------------------------------------------

const validSnapshot = () => ({
  pr: { number: 500, head: { repo: TEST_SLUG } },
  repo: TEST_SLUG,
  issueComments: [],
  complete: { issueComments: true },
  capturedAt: { issueComments: "2026-08-19T21:00:00Z" },
});

test("assertAdjudicationSnapshot: a snapshot with no capturedAt.issueComments is rejected", () => {
  const snap = validSnapshot();
  delete snap.capturedAt;
  assert.throws(() => assertAdjudicationSnapshot(500, snap, TEST_SLUG), /parseable capturedAt\.issueComments/);
});

test("assertAdjudicationSnapshot: an unparseable capturedAt.issueComments is rejected", () => {
  const snap = validSnapshot();
  snap.capturedAt.issueComments = "not a date";
  assert.throws(() => assertAdjudicationSnapshot(500, snap, TEST_SLUG), /parseable capturedAt\.issueComments/);
});

test("assertAdjudicationSnapshot: a well-formed snapshot passes", () => {
  assert.doesNotThrow(() => assertAdjudicationSnapshot(500, validSnapshot(), TEST_SLUG));
});

// ---------------------------------------------------------------------------
// buildRecord: evidenceCapturedAt and budget.ambiguous, exercised end to end
// against a minimal but real MCP snapshot shape (review-counting.mjs's own
// assertions run inside fromMcp -- constructing a fixture that satisfies
// them for real is worth more than hand-guessing the shape).
// ---------------------------------------------------------------------------

const minimalSnapshot = ({ issueComments = [], reviews = [] } = {}) => ({
  pr: { number: 500, title: "test", created_at: "2026-08-01T00:00:00Z", closed_at: null, head: { sha: null, repo: TEST_SLUG } },
  repo: TEST_SLUG,
  reviews,
  files: [],
  reviewThreads: [],
  issueComments,
  complete: { reviews: true, files: true, reviewThreads: true, issueComments: true },
  capturedAt: { issueComments: "2026-08-19T21:00:00Z" },
});

// `loadLoop` needs a real io/filesystem; buildRecord only needs its RETURN
// shape, so a minimal valid budgetState is constructed directly rather than
// exercising the guard's own file discovery here (that's review-budget.test.mjs's job).
const minimalBudgetState = () => ({
  tier: "product",
  budget: { budget: 3, criticality: 10, artifact: "x" },
  extensions: [],
  nextSeq: 1,
});

test("buildRecord: evidenceCapturedAt is the snapshot's own issueComments capture time, not generatedAt", () => {
  const snapshot = minimalSnapshot();
  const record = buildRecord({
    pr: 500,
    snapshot,
    derived: { pr: snapshot.pr, reviews: [], files: [], comments: [], issueComments: [] },
    budgetState: minimalBudgetState(),
    changes: { resolved: false, reason: "test -- no diff needed for this assertion" },
    now: "2026-08-19T22:00:00Z", // deliberately LATER than the snapshot's capture time
  });
  assert.equal(record.evidenceCapturedAt, "2026-08-19T21:00:00Z");
  assert.equal(record.generatedAt, "2026-08-19T22:00:00Z");
  assert.notEqual(record.evidenceCapturedAt, record.generatedAt);
});

test("buildRecord: budget.ambiguous is threaded through from countRounds, not silently dropped", () => {
  // A trigger comment and the last completed pass sharing the exact same
  // second is what countRounds flags ambiguous -- construct that shape
  // directly via issueComments/reviews rather than re-deriving countRounds'
  // own logic here.
  const tie = "2026-08-19T20:00:00Z";
  const snapshot = minimalSnapshot({
    issueComments: [{ user: { login: "someone" }, body: "@codex review", created_at: tie }],
    reviews: [
      {
        user: { login: "chatgpt-codex-connector" },
        body: "**Reviewed commit:** `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`",
        submitted_at: tie,
      },
    ],
  });
  const record = buildRecord({
    pr: 500,
    snapshot,
    derived: {
      pr: snapshot.pr,
      reviews: snapshot.reviews,
      files: [],
      comments: [],
      issueComments: snapshot.issueComments,
    },
    budgetState: minimalBudgetState(),
    changes: { resolved: false, reason: "test -- no diff needed for this assertion" },
    now: "2026-08-19T22:00:00Z",
  });
  assert.equal(record.budget.ambiguous, true);
  // And the non-ambiguous case doesn't regress: a request answered well
  // before generation reports ambiguous: false.
  const clean = buildRecord({
    pr: 500,
    snapshot: minimalSnapshot(),
    derived: { pr: snapshot.pr, reviews: [], files: [], comments: [], issueComments: [] },
    budgetState: minimalBudgetState(),
    changes: { resolved: false, reason: "test" },
    now: "2026-08-19T22:00:00Z",
  });
  assert.equal(clean.budget.ambiguous, false);
});

test("the record's repository must be supplied by the caller, never defaulted", () => {
  // It defaulted to `repoSlug()` -- the working tree -- and the record itself
  // carried no repository at all, so a spoofed identity paired with a
  // same-numbered fork or mirror produced evidence the adjudicator would rule
  // on as if it were this loop's. The caller now passes the identity out of
  // the durable budget, and the record records it. (Codex, PR #7 round 8.)
  assert.throws(
    () => assertAdjudicationSnapshot(500, validSnapshot()),
    /must be supplied by the caller, from the durable budget/,
    "no working-tree fallback",
  );
  for (const bad of [null, "", "   "]) {
    assert.throws(() => assertAdjudicationSnapshot(500, validSnapshot(), bad), /must be supplied by the caller/);
  }
  // And a snapshot for a different repository is refused against it.
  assert.throws(
    () => assertAdjudicationSnapshot(500, validSnapshot(), "Someone/Else"),
    /Someone\/Else/,
  );
});

// ---------------------------------------------------------------------------
// cappedDiff / artifactDiff: the adjudicator's view of the artifact.
//
// None of this had a test before #12, which is how the defect below survived:
// the cap is applied to a lexicographically-ordered diff, `.agents/` sorts
// ahead of almost every implementation path, and a loop commits its own
// records AS IT RUNS. So by the time an adjudication is dispatched -- which
// only happens after several rounds -- the retained prefix is the loop's own
// bookkeeping and the code the findings are about has fallen off the end.
// Measured on PR #10: a 242,289-char diff capped to 60,000, with
// `+++ b/.claude/settings.json` absent entirely, and two verdicts withdrawn
// because of it.
// ---------------------------------------------------------------------------

const EXCLUDE_PREFIX = ":(exclude,literal)";

/**
 * A git stand-in that actually honours exclude pathspecs, so these tests
 * prove the implementation ASKS for the right thing rather than merely
 * post-filtering text it already fetched.
 */
function fakeGit(files) {
  const names = files.map((f) => f.name);
  return (args) => {
    if (args.includes("--name-only")) return `${names.join("\0")}\0`;
    const excluded = new Set(
      args.filter((a) => a.startsWith(EXCLUDE_PREFIX)).map((a) => a.slice(EXCLUDE_PREFIX.length)),
    );
    return files
      .filter((f) => !excluded.has(f.name))
      .map((f) => `diff --git a/${f.name} b/${f.name}\n+++ b/${f.name}\n${f.body}\n`)
      .join("");
  };
}

/** A record big enough to consume the whole cap on its own. */
const fatRecord = (name) => ({ name, body: "R".repeat(PATCH_CAP_CHARS + 5_000) });

test("a record large enough to fill the cap no longer hides the implementation", () => {
  const runGit = fakeGit([
    fatRecord(".agents/adjudications/10-1.json"),
    { name: ".claude/settings.json", body: "-  relative\n+  absolute" },
  ]);

  const patch = cappedDiff(runGit, "base...head");

  // The regression, stated as the thing that actually went wrong.
  assert.ok(
    patch.includes("+++ b/.claude/settings.json"),
    "the implementation file must survive a record that would otherwise eat the entire cap",
  );
  assert.ok(patch.includes("+  absolute"), "and its hunk body, not just its header");
  assert.ok(
    !patch.includes(".agents/adjudications/10-1.json\n+++"),
    "while the record's own content is gone rather than merely reordered",
  );
});

test("excluded records are announced -- never silently dropped", () => {
  const runGit = fakeGit([
    { name: ".agents/adjudications/10-1.json", body: "x" },
    { name: ".agents/receipts/loop-budget-10.json", body: "y" },
    { name: "core/scripts/pr-ready.mjs", body: "z" },
  ]);

  const patch = cappedDiff(runGit, "base...head");

  assert.match(patch, /excluded 2 generated record file/);
  assert.ok(patch.includes("+++ b/core/scripts/pr-ready.mjs"));
});

test("a diff with no records is untouched, and gains no spurious note", () => {
  const runGit = fakeGit([{ name: "core/scripts/pr-ready.mjs", body: "z" }]);

  const patch = cappedDiff(runGit, "base...head");

  assert.ok(!/excluded \d+ generated record/.test(patch), "no note when nothing was excluded");
  assert.ok(!patch.includes("TRUNCATED"), "and no truncation note when it fits");
  assert.ok(patch.includes("+++ b/core/scripts/pr-ready.mjs"));
});

test("truncation is still announced when the filtered diff is itself over the cap", () => {
  const runGit = fakeGit([
    { name: ".agents/receipts/loop-budget-10.json", body: "r" },
    { name: "core/big.mjs", body: "C".repeat(PATCH_CAP_CHARS + 100) },
  ]);

  const patch = cappedDiff(runGit, "base...head");

  assert.match(patch, /TRUNCATED at 60000 chars/, "the existing truncation notice still fires");
  assert.match(patch, /excluded 1 generated record file/, "and both notices coexist");
});

test("records are excluded even when the diff would have fit -- they are not the artifact", () => {
  const runGit = fakeGit([
    { name: ".agents/adjudications/10-1.json", body: "x" },
    { name: "CLAUDE.md", body: "y" },
  ]);

  const patch = cappedDiff(runGit, "base...head");

  assert.ok(
    !patch.includes("+++ b/.agents/adjudications/10-1.json"),
    "its hunk is gone regardless of size -- the notice still names it, which is the point",
  );
  assert.ok(patch.includes("+++ b/CLAUDE.md"));
});

test("a git failure still reports unavailable rather than throwing", () => {
  const patch = cappedDiff(() => {
    throw new Error("no such ref");
  }, "base...head");
  assert.match(patch, /\[unavailable/);
});

test("artifactDiff still refuses without both endpoints", () => {
  assert.match(artifactDiff(null, "head"), /\[unavailable/);
  assert.match(artifactDiff("base", null), /\[unavailable/);
});

test("artifactDiff passes the three-dot range through and filters records", () => {
  let seenRange = null;
  const inner = fakeGit([
    { name: ".agents/receipts/loop-budget-10.json", body: "r" },
    { name: "core/scripts/pr-ready.mjs", body: "z" },
  ]);
  const runGit = (args) => {
    if (!args.includes("--name-only")) seenRange = args.find((a) => a.includes("..."));
    return inner(args);
  };

  const patch = artifactDiff("base", "head", { runGit });

  assert.equal(seenRange, "base...head", "three-dot, so a base-branch merge is not dragged in");
  assert.match(patch, /excluded 1 generated record file/);
  assert.ok(patch.includes("+++ b/core/scripts/pr-ready.mjs"));
});

// --- Round 1 of #14: two ways the first cut of this filter was too coarse ---

test("tracked scaffolding is NOT excluded -- it is synced payload, not a generated record", () => {
  // classifyPath calls every file under .agents/receipts and
  // .agents/adjudications a "record", but the sync DELIVERS three tracked
  // files into those directories. Excluding them would hide real contract
  // changes from the adjudicator and mislabel them as bookkeeping -- the same
  // blindness this filter exists to remove, pointed at a different target.
  // (Codex, #14 round 1.)
  const runGit = fakeGit([
    { name: ".agents/adjudications/README.md", body: "docs change" },
    { name: ".agents/receipts/README.md", body: "docs change" },
    { name: ".agents/receipts/.gitignore", body: "+loop-new-shape-*.json" },
    { name: ".agents/receipts/loop-budget-10.json", body: "generated" },
  ]);

  const patch = cappedDiff(runGit, "base...head");

  assert.ok(patch.includes("+++ b/.agents/receipts/.gitignore"), "the ignore rules are reviewable");
  assert.ok(patch.includes("+loop-new-shape-*.json"), "including their content");
  assert.ok(patch.includes("+++ b/.agents/receipts/README.md"));
  assert.ok(patch.includes("+++ b/.agents/adjudications/README.md"));
  assert.ok(
    !patch.includes("+++ b/.agents/receipts/loop-budget-10.json"),
    "while the generated receipt beside them still goes",
  );
  assert.match(patch, /excluded 1 generated record file/);
});

test("every shape the receipts README documents is recognised as generated", () => {
  const generated = [
    ".agents/receipts/pr-10.json",
    ".agents/receipts/loop-round-check-10.json",
    ".agents/receipts/loop-budget-10.json",
    ".agents/receipts/loop-extension-10-3.json",
    ".agents/adjudications/10-7.json",
  ];
  const runGit = fakeGit([
    ...generated.map((name) => ({ name, body: "g" })),
    { name: "core/scripts/pr-ready.mjs", body: "code" },
  ]);

  const patch = cappedDiff(runGit, "base...head");

  for (const name of generated) {
    assert.ok(!patch.includes(`+++ b/${name}`), `${name} should be excluded`);
  }
  assert.match(patch, /excluded 5 generated record files/);
  assert.ok(patch.includes("+++ b/core/scripts/pr-ready.mjs"));
});

test("a renamed record is excluded on BOTH sides, not just its destination", () => {
  // Discovery must disable rename detection. With it on, `--name-only`
  // reports only the destination; the old path then survives as a deletion
  // hunk and a large renamed record can consume the cap all over again.
  // (Codex, #14 round 1 -- verified against real git.)
  let sawNoRenames = false;
  const inner = fakeGit([
    { name: ".agents/adjudications/10-1.json", body: "old" },
    { name: ".agents/adjudications/10-2.json", body: "new" },
    { name: "CLAUDE.md", body: "code" },
  ]);
  const runGit = (args) => {
    if (args.includes("--name-only")) {
      sawNoRenames = args.includes("--no-renames");
      // Model git's DEFAULT behaviour if the flag is absent: destination only.
      if (!sawNoRenames) return ".agents/adjudications/10-2.json\0";
    }
    return inner(args);
  };

  const patch = cappedDiff(runGit, "base...head");

  assert.ok(sawNoRenames, "discovery must pass --no-renames");
  assert.ok(
    !patch.includes("+++ b/.agents/adjudications/10-1.json"),
    "the rename SOURCE is excluded too",
  );
  assert.ok(
    !patch.includes("+++ b/.agents/adjudications/10-2.json"),
    "as is the destination",
  );
  assert.ok(patch.includes("+++ b/CLAUDE.md"));
});

test("the exclusion notice NAMES what it withheld, so the omission is auditable", () => {
  // An earlier draft pointed at "the numstat fields" for the list. `artifact`
  // carries only counts, and `sinceLastReview.files` covers a different range
  // and is empty exactly when the judge is dispatched -- so the notice was
  // sending a fresh-context reader somewhere there was nothing to find, in the
  // register of an assurance. (Codex, #14 round 1.)
  const runGit = fakeGit([
    { name: ".agents/receipts/loop-budget-10.json", body: "g" },
    { name: ".agents/adjudications/10-7.json", body: "g" },
    { name: "CLAUDE.md", body: "code" },
  ]);

  const patch = cappedDiff(runGit, "base...head");

  assert.ok(patch.includes(".agents/receipts/loop-budget-10.json"), "named, not merely counted");
  assert.ok(patch.includes(".agents/adjudications/10-7.json"));
  assert.ok(!/numstat/.test(patch), "and no longer points at a list that does not exist");
});

test("a pathological number of records is summarised rather than dumped", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    name: `.agents/adjudications/10-${i + 1}.json`,
    body: "g",
  }));
  const runGit = fakeGit([...many, { name: "CLAUDE.md", body: "code" }]);

  const patch = cappedDiff(runGit, "base...head");
  const notice = patch.split("\n")[0];

  assert.match(notice, /excluded 20 generated record files/);
  assert.match(notice, /and 8 more/, "12 named, the remainder counted");
  assert.ok(patch.includes("+++ b/CLAUDE.md"));
});

// ---------------------------------------------------------------------------
// ONE git-derived source for size, territory and patch (#34 gap 2)
//
// The defect these cover, measured on #28 and #33: the snapshot's `files` was
// empty, `artifactSize` read it, and the record reported an artifact of zero
// files beside a 50 KB patch -- so `territory` said every finding was outside
// a diff that contained all of them. The fix is not a better check on that
// field; it is deriving the fact from the same range the patch comes from.
// ---------------------------------------------------------------------------

/** A numstat stand-in: records are `added\tremoved\tpath\0`. */
const numstatGit = (rows, { fail = null } = {}) => (args) => {
  if (fail && args.includes(fail)) throw new Error(`fake git: ${fail} unresolvable`);
  if (args.includes("--numstat")) return rows.map((r) => r.join("\t")).join("\0") + (rows.length ? "\0" : "");
  if (args[0] === "cat-file") return "";
  return "";
};

test("size excludes this machinery's own records; territory includes them", () => {
  const { files } = artifactFileList("base", "head", {
    runGit: numstatGit([
      ["9", "0", ".agents/receipts/loop-budget-37.json"],
      ["100", "5", "core/scripts/review-budget.mjs"],
      ["20", "1", "core/scripts/pr-ready.mjs"],
    ]),
  });
  const stats = artifactStats(files);
  assert.deepEqual(
    { files: stats.files, added: stats.added, removed: stats.removed, excluded: stats.excludedGeneratedRecords },
    { files: 2, added: 120, removed: 6, excluded: 1 },
    "the artifact is the code under review, not the loop's own bookkeeping",
  );
  // Territory classifies against the FULL set: a finding anchored on a receipt
  // this PR changed is still inside this PR's diff, and saying otherwise is
  // exactly the lie #34 gap 2 reported.
  const territory = findingsByTerritory(
    [{ path: ".agents/receipts/loop-budget-37.json" }, { path: "core/scripts/review-budget.mjs" }],
    files.map((f) => ({ filename: f.file })),
  );
  assert.deepEqual({ inDiff: territory.inDiff, outsideDiff: territory.outsideDiff }, { inDiff: 2, outsideDiff: 0 });
});

test("a binary change reports null counts and a binaryFiles count, never a false zero", () => {
  const { files } = artifactFileList("base", "head", {
    runGit: numstatGit([
      ["-", "-", "docs/img/diagram.png"],
      ["3", "0", "core/scripts/pr-ready.mjs"],
    ]),
  });
  const stats = artifactStats(files);
  assert.equal(files[0].added, null, "a binary file's line count is unknown, not zero");
  assert.deepEqual({ files: stats.files, added: stats.added, binaryFiles: stats.binaryFiles }, { files: 2, added: 3, binaryFiles: 1 });
});

test("a non-numeric, non-binary count refuses rather than coercing to zero", () => {
  assert.throws(
    () => artifactFileList("base", "head", { runGit: numstatGit([["?", "0", "a.ts"]]) }),
    /non-numeric, non-binary count/,
  );
});

test("a rename lands BOTH paths in the set, so a finding on either is inDiff", () => {
  // --no-renames is why: with rename detection on, git reports only the
  // destination and a finding anchored on the source classifies outside the
  // diff. The fake asserts the flag is actually asked for.
  let sawNoRenames = false;
  const runGit = (args) => {
    if (args.includes("--numstat")) {
      sawNoRenames = args.includes("--no-renames");
      return ["12\t0\tnew/path.mjs", "0\t12\told/path.mjs"].join("\t\0").replace("\t\0", "\0") + "\0";
    }
    return "";
  };
  const { files } = artifactFileList("base", "head", { runGit });
  assert.ok(sawNoRenames, "rename detection must be off, or the source path disappears");
  const paths = files.map((f) => f.file);
  assert.deepEqual(paths.sort(), ["new/path.mjs", "old/path.mjs"]);
});

test("a path with a space and a non-ASCII byte round-trips", () => {
  // -z is why: git's default output C-quotes such a path, and a quoted path
  // never equals the path a finding is anchored on.
  const { files } = artifactFileList("base", "head", {
    runGit: numstatGit([["1", "0", "docs/plans/PLAN — my plan.md"]]),
  });
  assert.equal(files[0].file, "docs/plans/PLAN — my plan.md");
});

test("an empty artifact against DISTINCT endpoints is allowed, and says so", () => {
  // A branch whose every change was reverted is legitimate and reachable, and
  // refusing it would block the tripwire and direct-stop flows that need a
  // record to close the loop at all. (Codex, #37 round 3.)
  const { files, emptyAgainstDistinctEndpoints } = artifactFileList("base", "head", { runGit: numstatGit([]) });
  assert.deepEqual(files, []);
  assert.equal(emptyAgainstDistinctEndpoints, true, "the state is marked, not refused");
});

test("both endpoints are validated before anything derives from the range", () => {
  assert.throws(() => assertArtifactEndpoints(null, "head", { runGit: () => "" }), /carries no pr\.base\.sha/);
  assert.throws(
    () => assertArtifactEndpoints("base", "head", { runGit: numstatGit([], { fail: "cat-file" }) }),
    /is not a resolvable commit/,
  );
});

// ---------------------------------------------------------------------------
// Reading payload at the reviewed commit, in either layout
// ---------------------------------------------------------------------------

/**
 * A git stand-in over a committed tree: `{ path: {mode, text} }`. The handbook
 * fixture stores a symlink whose blob is its target's path, exactly as
 * `git ls-tree` and `git show` report one.
 */
const treeGit = (tree) => (args) => {
  if (args[0] === "ls-tree") {
    const wanted = args[args.length - 1];
    const entry = tree[wanted];
    return entry ? `${entry.mode} blob deadbeef\t${wanted}\0` : "";
  }
  if (args[0] === "show") {
    const wanted = args[1].split(":").slice(1).join(":");
    if (!tree[wanted]) throw new Error(`fake git: no ${wanted}`);
    return tree[wanted].text;
  }
  return "";
};

const DEFINITION = ".claude/agents/review-loop-adjudicator.md";
const FRONTMATTER = "---\nname: review-loop-adjudicator\nmodel: best\neffort: xhigh\n---\n\nbody\n";

test("a head-pinned read follows the handbook's symlink into core/", () => {
  const runGit = treeGit({
    [DEFINITION]: { mode: "120000", text: "../../core/.claude/agents/review-loop-adjudicator.md" },
    "core/.claude/agents/review-loop-adjudicator.md": { mode: "100644", text: FRONTMATTER },
  });
  const read = readAtCommit("head", DEFINITION, { runGit });
  assert.equal(read.path, "core/.claude/agents/review-loop-adjudicator.md");
  assert.equal(read.followedLink, DEFINITION);
  assert.deepEqual(parseFrontmatter(read.text), { name: "review-loop-adjudicator", model: "best", effort: "xhigh" });
});

test("the same read works in an assembled consumer, where the path is an ordinary file", () => {
  const runGit = treeGit({ [DEFINITION]: { mode: "100644", text: FRONTMATTER } });
  const read = readAtCommit("head", DEFINITION, { runGit });
  assert.equal(read.path, DEFINITION);
  assert.equal(read.followedLink, null);
});

test("a consumer path absent entirely retries once under core/", () => {
  // The handbook has no `.agents/memory/…` at all -- the tracked source is
  // `core/.agents/memory/…`, so a bare `git show <sha>:<consumer path>` reads
  // nothing and the field would have been silently empty.
  const note = ".agents/memory/machinery-threat-model-is-my-own-mistakes.md";
  const runGit = treeGit({ [`core/${note}`]: { mode: "100644", text: "the threat model" } });
  const citation = declineCitationFor("internal", "head", { runGit });
  assert.equal(citation.text, "the threat model");
  assert.equal(citation.path, `core/${note}`);
});

test("a symlink escaping the repository is refused, not followed", () => {
  const runGit = treeGit({ [DEFINITION]: { mode: "120000", text: "../../../etc/passwd" } });
  assert.throws(() => readAtCommit("head", DEFINITION, { runGit }), /escapes the repository/);
});

test("a path resolving in neither layout refuses, naming both attempts", () => {
  assert.throws(() => readAtCommit("head", DEFINITION, { runGit: treeGit({}) }), /tried .*core\//s);
});

test("the decline citation is tier-selected, and degrades with a stated reason", () => {
  assert.equal(declineCitationFor("product", "head", { runGit: treeGit({}) }).text, null);
  // Absent in this repository: a stated null, not a refusal -- `memory` is a
  // separate sync group and requiring it would couple the machinery to most
  // of the handbook.
  const absent = declineCitationFor("internal", "head", { runGit: treeGit({}) });
  assert.equal(absent.text, null);
  assert.match(absent.reason, /unavailable at head/);
});

// ---------------------------------------------------------------------------
// The plan oracle, both modes
// ---------------------------------------------------------------------------

const PLAN = "docs/plans/PLAN_NEW.md";
const planText = "# Plan\n\n## Direction\nthe direction\n\n## Product Intent\nthe intent\n\n## Must Not Change\nthe invariants\n\n## Settled Decisions\n1. a decision\n";

const planGit = (introduced, text = planText) => (args) => {
  if (args[0] === "diff-tree") return introduced.join("\0") + (introduced.length ? "\0" : "");
  if (args[0] === "cat-file") return "";
  if (args[0] === "show") return text;
  return "";
};

test("a [PLAN REVIEW] loop reads its own plan at the head -- the deadlock #37 round 2 found", () => {
  // Without this mode the record refuses on every plan-review loop, because a
  // plan under review has no approved-plan source by definition. The loop then
  // cannot obtain the verdict it needs to continue OR stop.
  const oracle = planOracleFor(
    { title: "[PLAN REVIEW] something — DO NOT MERGE", body: "## Review mode\nPlan review only. Never merge." },
    "head",
    { runGit: planGit([PLAN]) },
  );
  assert.equal(oracle.mode, "plan-review");
  assert.deepEqual(oracle.sections, {
    Direction: "the direction",
    "Product Intent": "the intent",
    "Must Not Change": "the invariants",
    "Settled Decisions": "1. a decision",
  });
});

test("plan review needs BOTH defining signals, and refuses when they disagree", () => {
  const bodyOnly = { title: "Ordinary implementation PR", body: "## Review mode\nPlan review only." };
  assert.throws(() => planOracleFor(bodyOnly, "head", { runGit: planGit([PLAN]) }), /declares plan review in its body but not the other/);
  assert.equal(planReviewSignals(bodyOnly).isPlanReview, false);
});

test("a plan-review PR introducing no plan file refuses", () => {
  assert.throws(
    () => planOracleFor({ title: "[PLAN REVIEW] x — DO NOT MERGE", body: "## Review mode\nPlan review only." }, "head", { runGit: planGit([]) }),
    /must introduce exactly one/,
  );
});

test("the approved plan is the one the cited commit INTRODUCED, not the one file present", () => {
  // A repository may retain an older plan on main, which the loop permits. A
  // "exactly one file present" rule would then refuse every future plan.
  const body = "**Approved-plan source:** Plan-review PR #37, final plan commit abc1234, approved by David on 2026-09-06";
  const oracle = planOracleFor({ title: "Implement the thing", body }, "head", { runGit: planGit([PLAN]) });
  assert.equal(oracle.mode, "approved-plan");
  assert.equal(oracle.sha, "abc1234");
  assert.equal(oracle.path, PLAN);
});

test("a feature body with no approved-plan source REFUSES rather than nulling", () => {
  assert.throws(
    () => planOracleFor({ title: "Implement the thing", body: "## Summary\nsome prose" }, "head", { runGit: planGit([PLAN]) }),
    /names no approved-plan source/,
  );
});

test("each permitted no-plan form yields a stated null", () => {
  const forms = [
    // The bugfix oracle is the block bugfix/SKILL.md actually specifies --
    // see the dedicated test below for why the imagined line is not it.
    ["**Fix tier:** B — Q2 fired\n**Root cause:** the retry double-charges", "bugfix oracle (tier A/B)"],
    ["**Fix tier:** C — trivial schema fix, migration ceremony authorized", "bugfix oracle (tier C)"],
    ["**Approved-plan source:** n/a — no plan (trivial change)", "trivial change"],
    ["**Approved-plan source:** PLAN_X.md, shasum -a 256 abc…, 2026-09-06", "private path"],
  ];
  for (const [body, reason] of forms) {
    const oracle = planOracleFor({ title: "Implement the thing", body }, "head", { runGit: planGit([PLAN]) });
    assert.deepEqual({ mode: oracle.mode, reason: oracle.reason }, { mode: null, reason });
  }
});

// ---------------------------------------------------------------------------
// Provenance, bodies and caps
// ---------------------------------------------------------------------------

test("findings must come from captured threads, not a reconstruction", () => {
  // The fix for my own mistake on #37: prior rounds' threads were filled in by
  // hand, with invented ids and my paraphrase of the reviewer, and handed to
  // the judge as GitHub's record. A real thread carries a PRRT_ node id and a
  // #discussion_r html_url; neither is something a session assembles.
  assert.throws(
    () => assertThreadProvenance([{ id: "r1-0", comments: [{ html_url: "https://example.invalid" }] }]),
    /not a GitHub review-thread node id/,
  );
  // A thread with NEITHER a stable node id NOR a #discussion_r URL has nothing
  // identifying it as GitHub's record at all.
  assert.throws(
    () => assertThreadProvenance([{ id: "made-up", comments: [{ html_url: "https://example.invalid" }] }]),
    /not a GitHub review-thread node id/,
  );
  assertThreadProvenance([{ id: "PRRT_ok", comments: [{ html_url: "https://github.com/o/r/pull/1#discussion_r42" }] }]);
});

test("every variable-length field is bounded, and truncation is named", () => {
  const huge = "x".repeat(RECORD_TOTAL_CAP_CHARS);
  const record = applyCaps({
    findings: {
      items: [
        { threadId: "PRRT_a", resolved: false, createdAt: "2026-09-01", body: huge },
        { threadId: "PRRT_b", resolved: true, createdAt: "2026-09-02", body: huge },
      ],
    },
    planOracle: { sections: { Direction: huge } },
    declineCitation: { text: huge },
  });
  assert.ok(record.truncation.fields.length >= 3, "every over-long field names itself");
  assert.ok(
    record.truncation.serializedChars <= RECORD_TOTAL_CAP_CHARS,
    `the emitted record must fit the total cap, got ${record.truncation.serializedChars}`,
  );
  // Unresolved findings are served first: the verdict turns on those.
  assert.ok((record.findings.items[0].body ?? "").length >= (record.findings.items[1].body ?? "").length);
});

// ---------------------------------------------------------------------------
// The shipped definition declares what this machinery reads
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Round-1 regressions (#38)
// ---------------------------------------------------------------------------

test("an oracle section keeps its nested headings and everything under them", () => {
  // Stopping at ANY heading dropped a `### Security` subsection and its
  // constraints -- the record would then hand the judge a Must Not Change
  // section with its security rules silently missing.
  const md = "## Must Not Change\nfirst rule\n\n### Security\nthe security rule\n\n## Next Section\nunrelated";
  const body = sectionOf(md, "Must Not Change");
  assert.match(body, /### Security/);
  assert.match(body, /the security rule/);
  assert.doesNotMatch(body, /unrelated/, "but it still ends at the next same-level heading");
});

test("the documented bugfix oracle block is recognised, not just an imagined line", () => {
  // bugfix/SKILL.md tells an author to write `**Fix tier:**` with its
  // companion fields. Matching an "Approved-plan source: n/a — bugfix" line
  // that no bugfix PR carries made every bugfix loop refuse record generation
  // at its mandatory round-3 adjudication -- unable to write the next fix OR
  // close on a verdict.
  const body = [
    "**Fix tier:** A — Q1 and Q2 both ruled out",
    "**Reported symptom:** the card renders twice",
    "**Intended correct behavior:** it renders once",
    "**Must not change:** the sibling card path",
    "**Root cause:** the effect re-subscribes on every render",
    "**Blast radius:** two callers, both checked",
  ].join("\n");
  const oracle = planOracleFor({ title: "Fix the double render", body }, "head", { runGit: planGit([PLAN]) });
  assert.deepEqual({ mode: oracle.mode, reason: oracle.reason }, { mode: null, reason: "bugfix oracle (tier A/B)" });
});

test("a plan commit is read only from an Approved-plan source line", () => {
  // Unanchored, the phrase matches anywhere -- a quoted comment, a changelog,
  // a sentence about a different PR -- and that commit's plan would then be
  // presented to the judge as this PR's approved oracle.
  const incidental = "## Notes\nWe discussed the final plan commit abc1234 in standup; it is not this PR's.";
  assert.throws(
    () => planOracleFor({ title: "Implement the thing", body: incidental }, "head", { runGit: planGit([PLAN]) }),
    /names no approved-plan source/,
  );
});

test("the total cap terminates, and an overflow it cannot fix is stated", () => {
  // The obvious loop -- blank a non-empty body, re-serialize, repeat -- never
  // terminates, because blanking replaces the body with a non-empty marker
  // the next pass selects again. It hung record generation outright.
  const big = "x".repeat(700_000);
  const record = applyCaps({
    findings: {
      items: [
        { threadId: "PRRT_a", resolved: false, createdAt: "2026-01-01", body: big },
        { threadId: "PRRT_b", resolved: true, createdAt: "2026-01-02", body: big },
      ],
    },
  });
  assert.ok(record.truncation.serializedChars <= RECORD_TOTAL_CAP_CHARS);

  // And when the overflow is in metadata this function does not own, it says
  // so in the record rather than emitting a silently oversized one.
  const stuck = applyCaps({ findings: { items: [] }, padding: "y".repeat(RECORD_TOTAL_CAP_CHARS + 10) });
  assert.equal(stuck.truncation.overCap, true);
  assert.match(stuck.truncation.overCapNote, /already been shed/);
});

// ---------------------------------------------------------------------------
// Round-2 regressions (#38)
// ---------------------------------------------------------------------------

test("the reported size is the size of the record as emitted, metadata included", () => {
  // Measuring, then adding the fields that describe the measurement, then
  // never re-measuring, is how a record crosses the cap on the strength of its
  // own truncation metadata -- with `overCap` unset and `serializedChars`
  // understating the truth. The boundary case is Codex's own.
  const record = applyCaps({ findings: { items: [] }, padding: "z".repeat(599_575) });
  const emitted = JSON.stringify(record, null, 2).length;
  assert.equal(record.truncation.serializedChars, emitted, "the reported size must be the emitted size");
  assert.equal(record.truncation.overCap, true, "and an emitted record over the cap must say so");

  // The ordinary case still reports exactly, with nothing flagged.
  const small = applyCaps({ findings: { items: [{ threadId: "PRRT_a", resolved: false, body: "short" }] } });
  assert.equal(small.truncation.serializedChars, JSON.stringify(small, null, 2).length);
  assert.equal(small.truncation.overCap, undefined);
});

test("an explicit plan path is read from the provenance line, and must be one the commit introduced", () => {
  // A body-wide match takes the first plan path anywhere -- a quoted Product
  // Intent, a reference to the next phase's plan -- and would then present
  // that file's sections as this PR's approved oracle.
  const decoy = [
    "**Approved-plan source:** Plan-review PR #37, final plan commit abc1234, approved by David on 2026-09-06",
    "",
    "## Product intent",
    "This delivers phase 1a; phase 1b is specified in docs/plans/PLAN_OTHER.md and is not in scope.",
  ].join("\n");
  const oracle = planOracleFor({ title: "Implement phase 1a", body: decoy }, "head", { runGit: planGit([PLAN]) });
  assert.equal(oracle.path, PLAN, "the decoy path outside the provenance line must not win");

  // And an explicit path IS a disambiguator among what the commit introduced,
  // never an override of it.
  const overriding = "**Approved-plan source:** final plan commit abc1234, docs/plans/PLAN_ELSEWHERE.md";
  assert.throws(
    () => planOracleFor({ title: "x", body: overriding }, "head", { runGit: planGit([PLAN]) }),
    /refusing rather than reading a plan the cited commit did not deliver/,
  );
});

// ---------------------------------------------------------------------------
// Recorded gaps from #38's stop verdict, worked under David's grant (#39)
// ---------------------------------------------------------------------------

test("the approved-plan pointer is read in the shape this repository actually writes it", () => {
  // Found by running the machinery on its own PR, not by reading it: #38's
  // body carries "final plan commit `972b60d`" -- the sha in backticks, which
  // is this repo's house style -- and the first record generated for it
  // REFUSED. Every feature PR written the way this repo writes them would
  // have. (#39 gap 2.)
  const body = "**Approved-plan source:** Plan-review PR #37, final plan commit `972b60d`, approved by David on 2026-09-06.";
  const oracle = planOracleFor({ title: "Implement phase 1a", body }, "head", { runGit: planGit([PLAN]) });
  assert.equal(oracle.mode, "approved-plan");
  assert.equal(oracle.sha, "972b60d");

  // Quoted and bare forms keep working, and a backticked PATH resolves too.
  for (const variant of [
    "**Approved-plan source:** final plan commit 972b60d",
    "**Approved-plan source:** final plan commit \"972b60d\"",
    "**Approved-plan source:** final plan commit `972b60d`, `docs/plans/PLAN_NEW.md`",
  ]) {
    assert.equal(planOracleFor({ title: "x", body: variant }, "head", { runGit: planGit([PLAN]) }).sha, "972b60d");
  }
});

test("thread provenance matches the shared snapshot contract, no stricter", () => {
  // `assertMcpSnapshotShape` recovers a comment's identity from its
  // #discussion_r URL and deliberately falls back to the stable thread id.
  // Requiring both here rejected captures `fromMcp` accepts, in the one place
  // a refusal strands a mandatory round. (#39 gap 1.)
  const url = "https://github.com/o/r/pull/1#discussion_r42";
  assertThreadProvenance([{ id: "PRRT_ok", comments: [{ html_url: url }] }]);
  assertThreadProvenance([{ id: "PRRT_ok", comments: [{}] }]); // the documented fallback

  // The anti-reconstruction property is untouched: it rests on the node id,
  // which is the check that caught my own hand-written threads.
  assert.throws(
    () => assertThreadProvenance([{ id: "r1-0", comments: [{ html_url: url }] }]),
    /not a GitHub review-thread node id/,
  );
  assert.throws(
    () => assertThreadProvenance([{ id: "r1-0", comments: [{}] }]),
    /not a GitHub review-thread node id/,
  );
});

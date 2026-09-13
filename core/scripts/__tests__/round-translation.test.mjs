import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  buildTranslationRecord,
  translationBrief,
  skipReason,
  passFor,
  authorRole,
  assertCaptureAfterResponse,
  assertEndpointsResolve,
  assertCapturedAfterPass,
  rootPassIds,
  assertSnapshotIsForPr,
  roundThreads,
  commentsSincePass,
  builderAnsweredAt,
  COMMENT_CAP_CHARS,
} from "../round-translation-record.mjs";
import { facts, chatLine, renderPage, receiptsFor, writePage, publishPage, pagePath, unavailable } from "../round-translation-page.mjs";
import { reviewerFindings } from "../review-loop-record.mjs";
import { roundState, waitForRounds, main as closeoutMain } from "../round-translation-closeout.mjs";
import { derivePosition, writeLoopPosition, loopPosition, describe as describePosition, positionPath, main as positionMain } from "../loop-position.mjs";
import { MAX_SNAPSHOT_AGE_MS, capturedAtOf } from "../review-counting.mjs";
import { parseArgs, receiptPathFor, canDispatch, dispatchableRoles, roleContract, deliverTranslation, blankDeclaredStrings, main, runTranslation } from "../fable-dispatch.mjs";

const SLUG = "TestOwner/TestRepo";
const PR = 81;
const HEAD = "f00dcafef00dcafef00dcafef00dcafef00dcafe";
const REVIEWED = "beefbeefbeefbeefbeefbeefbeefbeefbeefbeef";
const BOT = "chatgpt-codex-connector[bot]";
const BUILDER = "TheAnswerManIsHere";

const url = (frag) => `https://github.com/${SLUG}/pull/${PR}#${frag}`;
const T = (iso) => new Date(iso).toISOString();

/**
 * One round: a reviewer pass with two findings, the builder's replies, a
 * context comment, and a capture taken after all of it.
 */
function snapshot(over = {}) {
  const base = {
    repo: SLUG,
    pr: {
      number: PR,
      title: "Add the thing",
      created_at: T("2026-09-12T09:00:00Z"),
      closed_at: null,
      html_url: `https://github.com/${SLUG}/pull/${PR}`,
      user: { login: BUILDER },
      head: { sha: HEAD, repo: SLUG },
      base: { sha: "0".repeat(40) },
    },
    reviews: [
      {
        id: 900001,
        user: { login: BOT },
        submitted_at: T("2026-09-12T10:00:00Z"),
        commit_id: REVIEWED,
        body: "**Reviewed commit:** " + REVIEWED,
        html_url: url("pullrequestreview-900001"),
      },
    ],
    issueComments: [
      {
        id: 800001,
        user: { login: BUILDER },
        body: "Round 1 context: two findings, one fixed and one declined.",
        created_at: T("2026-09-12T10:30:00Z"),
        html_url: url("issuecomment-800001"),
      },
    ],
    reviewThreads: [
      {
        id: "PRRT_kwDOAAAA1",
        isResolved: true,
        path: "core/scripts/a.mjs",
        line: 12,
        comments: [
          {
            id: 111,
            author: BOT,
            user: { login: BOT },
            pull_request_review_id: 900001,
            body: "P1: this writes the file before checking the caller may.",
            created_at: T("2026-09-12T10:00:05Z"),
            html_url: url("discussion_r111"),
          },
          {
            id: 112,
            author: BUILDER,
            user: { login: BUILDER },
            body: "Class: in-scope. Worth: real. Fixed in abc1234 — the check now precedes the write.",
            created_at: T("2026-09-12T10:20:00Z"),
            html_url: url("discussion_r112"),
          },
        ],
      },
      {
        id: "PRRT_kwDOAAAA2",
        isResolved: false,
        path: "core/scripts/b.mjs",
        line: 40,
        comments: [
          {
            id: 121,
            author: BOT,
            user: { login: BOT },
            pull_request_review_id: 900001,
            body: "P2: a hostile value of --role would escape the allowlist.",
            created_at: T("2026-09-12T10:00:06Z"),
            html_url: url("discussion_r121"),
          },
          {
            id: 122,
            author: BUILDER,
            user: { login: BUILDER },
            body: "Class: out-of-threat-model. Declined — --role is a choice the operator types.",
            created_at: T("2026-09-12T10:25:00Z"),
            html_url: url("discussion_r122"),
          },
        ],
      },
    ],
    complete: { reviews: true, issueComments: true, reviewThreads: true },
    capturedAt: T("2026-09-12T11:00:00Z"),
  };
  return { ...base, ...over };
}

/**
 * git stub, on the STRING-returning convention `review-loop-record.mjs` uses
 * -- the one `artifactDiff` is written against. A spawn-result stub passes
 * `rev-parse` and silently turns the diff into "[unavailable]".
 */
const gitAt = (head = HEAD, patch = "diff --git a/core/scripts/a.mjs b/core/scripts/a.mjs\n+ the fix\n") => {
  return (args) => {
    if (args[0] === "rev-parse") return `${head}\n`;
    if (args[0] === "diff" && args.includes("--name-only")) return "";
    if (args[0] === "diff") return patch;
    return "";
  };
};

const build = (snap = snapshot(), round = 1, git = gitAt()) => buildTranslationRecord(snap, round, { runGit: git, now: () => T("2026-09-12T11:05:00Z") });

// ---------------------------------------------------------------------------
// The property the whole increment rests on: this record keeps the replies
// the adjudicator's record drops, and neither can become the other.
// ---------------------------------------------------------------------------

test("the D0 record carries every reply; the judge's findings from the same snapshot carry none", () => {
  const snap = snapshot();
  const record = build(snap);

  const replies = record.findings.flatMap((f) => f.comments.filter((c) => c.role === "builder"));
  assert.equal(replies.length, 2, "both builder replies survive into the D0 record");
  assert.match(replies[0].body, /Fixed in abc1234/);
  assert.match(replies[1].body, /Declined/);

  // The judge's builder, over the same snapshot, keeps root comments only.
  const judge = reviewerFindings(snap.reviewThreads);
  assert.equal(judge.length, 2);
  for (const f of judge) {
    assert.doesNotMatch(f.body ?? "", /Fixed in abc1234|Declined/, "no builder prose reaches the adjudicator's shape");
  }
});

test("every block is labelled by who wrote it, and the brief renders the label", () => {
  const record = build();
  assert.deepEqual(
    record.findings[0].comments.map((c) => c.role),
    ["reviewer", "builder"],
  );
  const brief = translationBrief(record);
  assert.match(brief, /Codex, the code reviewer, wrote/);
  assert.match(brief, /The builder \(Claude\) replied/);
  assert.match(brief, /```diff/, "the diff is in the brief as the evidence for the replies' claims");
});

test("a comment from someone who is neither reviewer nor builder is labelled `other`", () => {
  // David's own inline comment is not the builder's, and attributing one to
  // me would be wrong about the one thing this record exists to get right.
  assert.equal(authorRole(BOT, BUILDER), "reviewer");
  assert.equal(authorRole(BUILDER, BUILDER), "builder");
  assert.equal(authorRole("someone-else", BUILDER), "other");
  assert.equal(authorRole("chatgpt-codex-connector", BUILDER), "reviewer", "the bot suffix is optional");
});

// ---------------------------------------------------------------------------
// Check 1 — the round is named, not "the latest pass"
// ---------------------------------------------------------------------------

test("a later pass landing before D0 runs does not change which round is translated", () => {
  const snap = snapshot();
  snap.reviews.push({
    id: 900002,
    user: { login: BOT },
    submitted_at: T("2026-09-12T10:45:00Z"),
    commit_id: HEAD,
    body: "**Reviewed commit:** " + HEAD,
    html_url: url("pullrequestreview-900002"),
  });
  const record = build(snap, 1);
  assert.equal(record.round.number, 1);
  assert.equal(record.round.of, 2, "the later pass is visible but not selected");
  assert.equal(record.round.reviewedCommit, REVIEWED);
  assert.equal(record.findings.length, 2, "round 1's findings, not round 2's zero");
});

test("--round naming a pass that does not exist is refused", () => {
  assert.throws(() => build(snapshot(), 3), /holds 1 completed reviewer pass\(es\).*no round 3/s);
  assert.throws(() => build(snapshot(), 0), /positive integer/);
});

test("passFor counts rounds with reviewerPasses, not with its own rule", () => {
  const { passes } = passFor(snapshot(), 1);
  assert.equal(passes.length, 1);
  assert.equal(passes[0].commit, REVIEWED);
});

// ---------------------------------------------------------------------------
// Check 2 — the capture must postdate the builder's last word on the round
// ---------------------------------------------------------------------------

test("a capture taken before the builder replied is refused, not translated as silence", () => {
  const snap = snapshot({ capturedAt: T("2026-09-12T10:10:00Z") });
  assert.throws(
    () => build(snap),
    /captured at .* not clearly after .* comment at .*Read the collections again/s,
  );
});

test("a capture after the last reply is accepted, and the boundary is recorded", () => {
  const record = build();
  assert.equal(record.round.respondedAt, T("2026-09-12T10:30:00Z"), "the newest non-reviewer comment");
});

test("a round nobody has replied to yet translates as awaiting a response", () => {
  // There is no boundary to beat, and "the builder has not answered" is TRUE
  // here -- refusing would withhold an accurate account.
  const snap = snapshot();
  snap.issueComments = [];
  for (const t of snap.reviewThreads) t.comments = [t.comments[0]];
  const record = build(snap);
  assert.equal(record.round.respondedAt, null);
  assert.equal(record.findings.length, 2);
});

test("a snapshot with no usable capturedAt is refused", () => {
  assert.throws(() => build(snapshot({ capturedAt: "not a date" })), /no usable capturedAt/);
});

test("the reviewer's own later comment does not count as the builder answering", () => {
  const snap = snapshot({ capturedAt: T("2026-09-12T10:40:00Z") });
  snap.reviewThreads[0].comments.push({
    id: 113,
    author: BOT,
    user: { login: BOT },
    body: "Acknowledged.",
    created_at: T("2026-09-12T23:00:00Z"),
    html_url: url("discussion_r113"),
  });
  const record = build(snap);
  assert.equal(record.round.respondedAt, T("2026-09-12T10:30:00Z"));
});

// ---------------------------------------------------------------------------
// Check 3 — the diff's endpoints, and the checkout
// ---------------------------------------------------------------------------

test("an endpoint that is not in this clone refuses, so the patch is never an empty marker", () => {
  // This replaced a HEAD-equality check that could not hold: the tree is live,
  // the dispatch is detached, and the next round proceeds while it runs. The
  // role gave up `Read` instead; what is checked is that the diff is real.
  const missing = (args) => {
    if (args[0] === "rev-parse" && args.includes("--verify")) throw new Error("unknown revision");
    return "";
  };
  assert.throws(() => assertEndpointsResolve(REVIEWED, HEAD, { runGit: missing }), /is not in this clone/);
  assert.doesNotThrow(() => assertEndpointsResolve(REVIEWED, HEAD, { runGit: () => REVIEWED }));
});

test("the diff runs from the round's reviewed commit to the snapshot's head", () => {
  const record = build();
  assert.equal(record.diff.range, `${REVIEWED}..${HEAD}`);
  assert.match(record.diff.patch, /the fix/);
});

test("a round with no push reports no diff, and says only what the diff shows", () => {
  const snap = snapshot();
  snap.reviews[0].commit_id = HEAD;
  const record = build(snap);
  assert.equal(record.diff.range, null);
  assert.match(record.diff.note, /Nothing was pushed since the commit this round reviewed/);
  // It must NOT claim the builder replied: the diff cannot see a reply, and on
  // an unanswered round that claim told the translator the round was answered.
  assert.ok(!/replied|replies/.test(record.diff.note.replace(/Whether the builder replied is in the threads above, not here\./, "")));
  assert.match(record.diff.note, /in the threads above, not here/);
});



// ---------------------------------------------------------------------------
// The skip, and what is NOT skipped
// ---------------------------------------------------------------------------

test("a clean round with nothing pushed is skipped; an all-declined round is not", () => {
  const clean = snapshot();
  clean.reviewThreads = [];
  clean.reviews[0].commit_id = HEAD;
  clean.issueComments = [];
  assert.equal(skipReason(build(clean)), "no findings and nothing pushed since the reviewed commit");

  // All-declined: findings exist, nothing was pushed. This is the round where
  // the builder's account matters most, so it is dispatched.
  const declined = snapshot();
  declined.reviews[0].commit_id = HEAD;
  assert.equal(skipReason(build(declined)), null);
});

test("a round with no findings but a push is dispatched", () => {
  const snap = snapshot();
  snap.reviewThreads = [];
  assert.equal(skipReason(build(snap)), null, "there is a change to account for");
});

test("a round whose reviewed commit is unknown is never skipped as empty", () => {
  // "Could not tell what was pushed" is not "nothing was pushed". Collapsing
  // the two would report a round as empty on the strength of a missing field
  // -- observed-false standing in for could-not-observe, which is the one
  // substitution this machinery refuses everywhere.
  const snap = snapshot();
  snap.reviewThreads = [];
  delete snap.reviews[0].commit_id;
  const record = build(snap);
  assert.equal(record.diff.pushed, null);
  assert.equal(skipReason(record), null, "it is dispatched rather than declared empty");
  assert.match(record.diff.note, /Weigh the absence as uncertainty/);
});

// ---------------------------------------------------------------------------
// Provenance and identity refusals inherited from the judge's record
// ---------------------------------------------------------------------------

test("a snapshot for another pull request is refused", () => {
  assert.throws(() => assertSnapshotIsForPr(99, snapshot()), /is for pull request #81, not #99/);
});

test("a reconstructed thread is refused", () => {
  const snap = snapshot();
  snap.reviewThreads[0].id = "thread-1";
  assert.throws(() => build(snap), /not a GitHub review-thread node id/);
});

test("a threads payload that does not attest completeness is refused", () => {
  // A truncated first page drops findings, and a round missing findings reads
  // as a round that raised fewer -- a wrong account with nothing to doubt it.
  const snap = snapshot();
  snap.complete = { reviews: true, issueComments: true };
  assert.throws(() => build(snap), /complete\.reviewThreads must be explicitly true/);
});

test("a very long comment is capped, and says so in place", () => {
  const snap = snapshot();
  snap.reviewThreads[0].comments[0].body = "x".repeat(COMMENT_CAP_CHARS + 500);
  const record = build(snap);
  assert.match(record.findings[0].comments[0].body, /\[TRUNCATED at 20000 chars of 20500\]$/);
});

test("a thread whose root carries no review id is still attributed by time", () => {
  // The MCP threads payload does not always carry pull_request_review_id, and
  // without a fallback a whole round's findings render as zero -- a clean
  // round that was not clean.
  const snap = snapshot();
  for (const t of snap.reviewThreads) delete t.comments[0].pull_request_review_id;
  const { pass } = passFor(snap, 1);
  assert.equal(roundThreads(snap, pass, BUILDER).length, 2);
});

// ---------------------------------------------------------------------------
// The three derived facts, the chat line, and the page
// ---------------------------------------------------------------------------

const receipt = (round, output, over = {}) => ({ role: "round-translation", pr: PR, round, output, finishedAt: T("2026-09-12T11:10:00Z"), ...over });
const answer = (over = {}) => ({
  summary_for_david: "The reviewer raised two points on this round.\nOne was fixed, one declined.\nNothing here should worry you.",
  what_happened: "The first point was a real ordering mistake and the builder fixed it. The second was about a value you type yourself, and the builder declined it.",
  disagreements: [],
  could_not_assess: null,
  recommendation: "Nothing to do.",
  ...over,
});

test("agrees is printed only when nothing was left unassessed", () => {
  assert.equal(chatLine(receipt(1, answer())), "round 1: agrees with the builder's account");
  assert.equal(
    chatLine(receipt(1, answer({ could_not_assess: "The diff was cut before the second file." }))),
    "round 1: partial — something could not be assessed",
    "could-not-observe is never turned into the favourable answer",
  );
});

test("any disagreement wins over both, and is counted", () => {
  const one = receipt(2, answer({ disagreements: [{ what: "a", why_it_matters: "b" }] }));
  assert.equal(chatLine(one), "round 2: differs on 1 point");
  const two = receipt(2, answer({ disagreements: [{ what: "a", why_it_matters: "b" }, { what: "c", why_it_matters: "d" }], could_not_assess: "also this" }));
  assert.equal(chatLine(two), "round 2: differs on 2 points");
});

test("a skipped round is distinguishable from all three", () => {
  const r = { role: "round-translation", pr: PR, round: 3, skipped: true, reason: "no findings and nothing pushed since the reviewed commit" };
  assert.equal(chatLine(r), "round 3: skipped — no findings and nothing pushed since the reviewed commit");
  assert.equal(facts(r).skipped, true);
});

test("an empty disagreement list is a real answer, not a missing one", () => {
  const f = facts(receipt(1, answer()));
  assert.equal(f.disagreements, 0);
  assert.equal(f.unassessed, false);
});

test("the failure notices are fixed text, not the builder's wording", () => {
  assert.equal(unavailable(4, "the snapshot was captured too early"), "round 4: translation unavailable — the snapshot was captured too early");
});

test("the page renders newest round first and shows only what the receipts hold", () => {
  const html = renderPage(
    [
      receipt(1, answer()),
      receipt(2, answer({ disagreements: [{ what: "The builder called this fixed; the diff changes a different function.", why_it_matters: "The reported problem may still be there." }] })),
    ],
    { pr: PR },
  );
  assert.ok(html.indexOf("Round 2") < html.indexOf("Round 1"), "newest first");
  assert.match(html, /The builder called this fixed/);
  assert.match(html, /verdict differs/);
  assert.match(html, /<title>Review rounds on PR #81<\/title>/);
  assert.doesNotMatch(html, /Class:|Worth:/, "the builder's thread shorthand never reaches the page");
});

test("the page marks a truncated diff independently of what the translator said", () => {
  const r = receipt(1, answer(), { record: { diff: { truncated: { keptChars: 1000, fullChars: 9000 } } } });
  assert.match(renderPage([r], { pr: PR }), /cut at 1000 of 9000 characters/);
});

test("the page escapes text rather than rendering it as markup", () => {
  const html = renderPage([receipt(1, answer({ recommendation: "<script>alert(1)</script>" }))], { pr: PR });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test("a skipped round renders as skipped, with its reason", () => {
  const html = renderPage([{ role: "round-translation", pr: PR, round: 1, skipped: true, reason: "no findings and nothing pushed since the reviewed commit" }], { pr: PR });
  assert.match(html, /Not translated/);
  assert.match(html, /verdict">skipped/);
});

test("the page names both themes' colours at the root, so neither renders on the other's ground", () => {
  const html = renderPage([receipt(1, answer())], { pr: PR });
  const root = html.slice(html.indexOf(":root {"), html.indexOf("@media"));
  for (const token of ["--bg:", "--ink:", "--card:", "--rule:", "--accent:", "--flag:"]) {
    assert.ok(root.includes(token), `${token} is defined on bare :root`);
  }
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /\[data-theme="dark"\]/);
});

// ---------------------------------------------------------------------------
// The page and receipts on disk
// ---------------------------------------------------------------------------

function tmpRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "d0-page-"));
  fs.mkdirSync(path.join(root, ".agents/receipts"), { recursive: true });
  return root;
}

/**
 * A tmpRepo that is a REAL git repository.
 *
 * `writePage` proves the page is ignored by running `git check-ignore`, so any
 * path that goes through `publishPage` without a `runGit` override -- which is
 * every real caller, including `runTranslation` -- needs one. Stubbing git
 * instead would make the test pass over exactly the check the real path runs,
 * which is the class of defect this suite has now been caught by three times.
 */
function tmpGitRepo() {
  const root = tmpRepo();
  const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "t@example.test"]);
  git(["config", "user.name", "t"]);
  return root;
}

test("the page is written into a directory git ignores, and refuses if it is not", () => {
  const root = tmpRepo();
  const rel = writePage(root, PR, "<p>x</p>", { runGit: () => ({ status: 0 }) });
  assert.equal(rel, path.join(".agents/reviews", `pr-${PR}`, "translation.html"));
  assert.equal(fs.readFileSync(path.join(root, ".agents/reviews/.gitignore"), "utf8"), "*\n");
  assert.throws(() => writePage(root, PR, "<p>x</p>", { runGit: () => ({ status: 1 }) }), /is not ignored by git/);
});

test("receiptsFor reads this PR's rounds in order and ignores everything else", () => {
  const root = tmpRepo();
  const w = (name, body) => fs.writeFileSync(path.join(root, ".agents/receipts", name), JSON.stringify(body));
  w("fable-round-translation-81-2.json", receipt(2, answer()));
  w("fable-round-translation-81-1.json", receipt(1, answer()));
  w("fable-round-translation-99-1.json", { ...receipt(1, answer()), pr: 99 });
  w("fable-probe-abc1234.json", { role: "probe" });
  const got = receiptsFor(root, PR);
  assert.deepEqual(got.map((r) => r.round), [1, 2]);
});

test("the page path is derived from the PR, never supplied", () => {
  assert.equal(pagePath("/r", 81), path.join("/r", ".agents/reviews", "pr-81", "translation.html"));
});

// ---------------------------------------------------------------------------
// Dispatch wiring
// ---------------------------------------------------------------------------

test("round-translation dispatches because this script generates its brief", () => {
  assert.equal(canDispatch("round-translation"), true);
  assert.deepEqual(dispatchableRoles().sort(), ["probe", "round-translation"]);
  assert.equal(canDispatch("plan-opinion"), false, "an unbuilt role is still refused");
});

test("each role takes only its own flags, and all of them are data", () => {
  assert.throws(() => parseArgs(["--role", "probe", "--pr", "81"]), /role "probe" does not take --pr/);
  assert.throws(() => parseArgs(["--role", "round-translation", "--pr", "81", "--round", "3"]), /requires --mcp-snapshot/);
  assert.throws(() => parseArgs(["--role", "round-translation", "--pr", "x", "--round", "3", "--mcp-snapshot", "s"]), /--pr must be a whole number/);
  const ok = parseArgs(["--role", "round-translation", "--pr", "81", "--round", "3", "--mcp-snapshot", "s.json"]);
  assert.deepEqual({ pr: ok.pr, round: ok.round, snapshot: ok.snapshot }, { pr: 81, round: 3, snapshot: "s.json" });
});

test("there is still no --brief flag, and free text is still refused", () => {
  assert.throws(() => parseArgs(["--role", "round-translation", "--brief", "f"]), /unknown flag --brief/);
  assert.throws(() => parseArgs(["--role", "round-translation", "translate this nicely"]), /This command takes flags only/);
});

test("the receipt is keyed by round, so two rounds on one head do not collide", () => {
  const a = receiptPathFor("/r", { role: "round-translation", pr: 81, round: 2 });
  const b = receiptPathFor("/r", { role: "round-translation", pr: 81, round: 3 });
  assert.notEqual(a, b);
  assert.equal(path.basename(a), "fable-round-translation-81-2.json");
  // The probe is untouched: still keyed by head.
  assert.equal(path.basename(receiptPathFor("/r", { role: "probe", headAtSpawn: "abcdef1234567" })), "fable-probe-abcdef1.json");
});

test("the shipped role definition and schema satisfy the launch contract", () => {
  const dir = fs.existsSync("core/.agents/fable-roles") ? "core/.agents/fable-roles" : ".agents/fable-roles";
  const definitionPath = path.join(dir, "fable-round-translation.md");
  const text = fs.readFileSync(definitionPath, "utf8");
  const contract = roleContract(text, { role: "round-translation", definitionPath, definitionCommit: "HEAD" });
  assert.deepEqual(contract.tools, [], "`tools: none` is an explicit empty allowlist, not an omission");
  assert.equal(contract.modelTier, "strongestClaude", "a tier, never a version");
  assert.ok(contract.budgetUsd > 0);
  const schema = JSON.parse(fs.readFileSync(path.join(dir, contract.schemaPath), "utf8"));
  assert.deepEqual(schema.required.sort(), ["could_not_assess", "disagreements", "recommendation", "summary_for_david", "what_happened"]);
  assert.equal(schema.additionalProperties, false);
  assert.match(contract.systemPrompt, /cannot read code/, "the role's own text names its reader");
  assert.match(contract.systemPrompt, /hold no tools/, "and says it has no file to open");
});

// ---------------------------------------------------------------------------
// Round 1 of PR #81 — one regression test per finding, each failing before
// its fix. The first is the one my own fixture hid: it carried a field the
// real assembler never emits.
// ---------------------------------------------------------------------------

/** A snapshot shaped the way `snapshot-from-captures.mjs` actually emits one. */
function assembled(over = {}) {
  const snap = snapshot(over);
  // normaliseThread emits no `pull_request_review_id` on thread comments.
  for (const t of snap.reviewThreads) for (const c of t.comments) delete c.pull_request_review_id;
  return snap;
}

test("R1: each finding belongs to exactly one round, on a snapshot shaped like the real one", () => {
  // Before the fix: the primary key was absent from every captured thread, so
  // attribution fell through to a ±6h window and two rounds an hour apart each
  // collected BOTH rounds' findings. Measured: round 1 reported 2, round 2
  // reported the same 2.
  const snap = assembled();
  snap.reviews.push({
    id: 900002,
    user: { login: BOT },
    submitted_at: T("2026-09-12T11:00:00Z"),
    commit_id: HEAD,
    body: "**Reviewed commit:** " + HEAD,
    html_url: url("pullrequestreview-900002"),
  });
  snap.reviewThreads.push({
    id: "PRRT_kwDOAAAA3",
    isResolved: false,
    path: "core/scripts/c.mjs",
    line: 7,
    comments: [
      { id: 131, author: BOT, user: { login: BOT }, body: "round 2's only finding", created_at: T("2026-09-12T11:00:05Z"), html_url: url("discussion_r131") },
    ],
  });
  snap.capturedAt = T("2026-09-12T12:00:00Z");

  const r1 = build(snap, 1);
  const r2 = build(snap, 2);
  assert.equal(r1.findings.length, 2, "round 1 keeps its own two");
  assert.equal(r2.findings.length, 1, "round 2 gets only its own");
  assert.doesNotMatch(JSON.stringify(r1.findings), /round 2's only finding/);
  assert.doesNotMatch(JSON.stringify(r2.findings), /writes the file before/);
});

test("R1: attribution comes from flattenMcpThreads, so a finding's round matches every other count", () => {
  const byRoot = rootPassIds(assembled());
  assert.deepEqual([...byRoot.values()], [900001, 900001], "both roots bound to the one pass that exists");
});

test("R2: a snapshot with no pull request author is refused, not silently labelled `other`", () => {
  // The assembler dropped `pr.user`, so every builder reply read as `other`
  // and the provenance the translator weighs quietly stopped meaning anything.
  const snap = snapshot();
  delete snap.pr.user;
  assert.throws(() => build(snap), /no pull request author.*labelled `other`/s);
});

test("R3: the diff is a two-dot range, so a rewritten history cannot hide what changed", () => {
  // `a...b` measures from the merge base, which after a permitted
  // --force-with-lease rewrite is not the reviewed commit.
  let seen = null;
  const spy = (args) => {
    if (args[0] === "rev-parse") return `${HEAD}\n`;
    if (args[0] === "diff" && args.includes("--name-only")) return "";
    if (args[0] === "diff") {
      seen = args.find((a) => a.includes(".."));
      return "patch";
    }
    return "";
  };
  build(snapshot(), 1, spy);
  assert.equal(seen, `${REVIEWED}..${HEAD}`);
  assert.ok(!seen.includes("..."), "three dots would measure from the merge base");
});

test("R4: threads captured before the round's own pass are refused", () => {
  // A mixed snapshot -- reviews fresh, threads stale -- holds none of the
  // round's findings, so it would translate or skip as clean.
  const snap = snapshot({
    capturedAt: {
      pr: T("2026-09-12T11:00:00Z"),
      reviews: T("2026-09-12T11:00:00Z"),
      issueComments: T("2026-09-12T11:00:00Z"),
      reviewThreads: T("2026-09-12T09:30:00Z"),
    },
  });
  assert.throws(() => build(snap), /reviewThreads was captured before round 1's pass.*translated -- or skipped -- as clean/s);
});

test("R4: assertCapturedAfterPass refuses a pass with no readable time", () => {
  assert.throws(() => assertCapturedAfterPass(snapshot(), { at: "nonsense" }, 2), /round 2's reviewer pass carries an unparseable timestamp/);
});

test("R5: an abbreviated pass commit on the current head counts as no push", () => {
  // A summary-comment pass carries the 7-40 char sha from its marker while
  // pr.head.sha is the full 40, so `!==` called a clean pass "pushed".
  const snap = snapshot();
  snap.reviews[0].commit_id = HEAD.slice(0, 10);
  snap.reviewThreads = [];
  const record = build(snap);
  assert.equal(record.diff.pushed, false, "prefix-tolerant, like reviewerPasses");
  assert.equal(skipReason(record), "no findings and nothing pushed since the reviewed commit");
});

test("R7: a snapshot from another repository is refused even when the PR number matches", () => {
  const foreign = snapshot({ repo: "SomeoneElse/OtherRepo" });
  foreign.pr.head.repo = "SomeoneElse/OtherRepo";
  assert.throws(() => assertSnapshotIsForPr(PR, foreign, { slug: SLUG }), /captured from SomeoneElse\/OtherRepo, but this checkout is TestOwner\/TestRepo/);
  assert.throws(() => assertSnapshotIsForPr(PR, { pr: { number: PR } }, { slug: SLUG }), /names no repository/);
  assert.doesNotThrow(() => assertSnapshotIsForPr(PR, snapshot(), { slug: SLUG }));
});

test("R10: a multiline refusal becomes one line for chat, with the full text on stderr", () => {
  // SIGN_IN_HINT is a numbered list; pasting it turns a fixed status line into
  // a wall of operator instructions.
  const multi = "the provider is unavailable\n  1. npm install @openai/codex\n  2. log in";
  const line = unavailable(3, multi.split("\n")[0]);
  assert.equal(line, "round 3: translation unavailable — the provider is unavailable");
  assert.ok(!line.includes("\n"));
});

test("R8: a delivery failure still prints one fixed line, and exits non-zero", () => {
  // The reviewer had already run. Before the fix a receipt-write, page-render
  // or check-ignore failure threw loose and the loop had NO verbatim status to
  // paste -- worst on the last round before a merge ask, the one the contract
  // says must carry it.
  const root = tmpRepo();
  fs.rmSync(path.join(root, ".agents"), { recursive: true, force: true });
  fs.writeFileSync(path.join(root, ".agents"), "a file where the directory should be");
  const out = [];
  const write = process.stdout.write;
  process.stdout.write = (s) => (out.push(s), true);
  let code;
  try {
    code = deliverTranslation(root, { role: "round-translation", pr: PR, round: 4, output: answer() });
  } finally {
    process.stdout.write = write;
  }
  assert.equal(code, 1, "non-zero, so a caller cannot read it as delivered");
  assert.equal(out.length, 1, "exactly one line");
  assert.match(out[0], /^round 4: translation unpublished — /);
  assert.equal(out[0].trimEnd().includes("\n"), false);
});

// ---------------------------------------------------------------------------
// Round 3's four findings, closed on David's instruction after the loop had
// stopped. One test each, every one of them failing before its fix.
// ---------------------------------------------------------------------------

test("R11: a later pass's PR-level comments stay out of the earlier round's brief", () => {
  // The race this record explicitly supports: round 2 lands before round 1 is
  // translated -- a re-run, a catch-up, or a dispatch still in flight. With a
  // lower bound only, round 2's context comment and every reply after it were
  // collected into round 1's brief, so David's round-1 account was partly
  // about round 2. (Codex, #81 round 3.)
  const snap = snapshot();
  snap.reviews.push({
    id: 900002,
    user: { login: BOT },
    submitted_at: T("2026-09-12T10:45:00Z"),
    commit_id: HEAD,
    body: "**Reviewed commit:** " + HEAD,
    html_url: url("pullrequestreview-900002"),
  });
  // The trigger precedes round 2's pass and belongs to round 1; the context
  // comment follows it and belongs to round 2.
  snap.issueComments.push(
    { id: 800002, user: { login: BUILDER }, body: "atC0dex r3view", created_at: T("2026-09-12T10:40:00Z"), html_url: url("issuecomment-800002") },
    { id: 800003, user: { login: BUILDER }, body: "Round 2 context: one finding.", created_at: T("2026-09-12T10:50:00Z"), html_url: url("issuecomment-800003") },
  );

  const bodies = (r) => r.commentsSincePass.map((c) => c.body);

  const round1 = build(snap, 1);
  assert.deepEqual(
    bodies(round1),
    ["Round 1 context: two findings, one fixed and one declined.", "atC0dex r3view"],
    "round 1 keeps its own context and the trigger it posted, and stops at round 2's pass",
  );
  assert.ok(!bodies(round1).some((b) => b.includes("Round 2 context")), "round 2's context is round 2's");

  const round2 = build(snap, 2);
  assert.deepEqual(bodies(round2), ["Round 2 context: one finding."], "the latest round's window is still open-ended");
});

test("R11: commentsSincePass with no next pass is unbounded, as every caller had it", () => {
  const snap = snapshot();
  const pass = passFor(snap, 1).pass;
  assert.equal(commentsSincePass(snap, pass, BUILDER).length, 1);
  assert.equal(commentsSincePass(snap, pass, BUILDER, null).length, 1);
});

test("R12: a document with blank declared-non-empty strings is not accepted", () => {
  // Schema-valid and says nothing: chatLine() would print "agrees with the
  // builder's account" over a page with no account on it -- the favourable
  // reading of a field nothing looked at. (Codex, #81 round 3.)
  const schema = JSON.parse(
    fs.readFileSync(new URL("../../.agents/fable-roles/schemas/fable-round-translation.schema.json", import.meta.url), "utf8"),
  );
  const empty = { summary_for_david: "", what_happened: "   ", disagreements: [], could_not_assess: null, recommendation: "" };

  // The receipt-side check, which is what actually runs: the schema is handed
  // to the harness and what it enforces beyond shape is not this script's.
  assert.deepEqual(
    blankDeclaredStrings(schema, empty).sort(),
    ["recommendation", "summary_for_david", "what_happened"],
    "every blank field is named, so the re-ask says what was wrong",
  );
  // And the thing the blank document would otherwise have produced.
  assert.equal(chatLine({ round: 3, answer: empty }), "round 3: agrees with the builder's account");

  // Strings inside a disagreement item are declared too, and reported by path.
  const hollow = { ...answer(), disagreements: [{ what: "a real point", why_it_matters: "" }] };
  assert.deepEqual(blankDeclaredStrings(schema, hollow), ["disagreements[0].why_it_matters"]);

  // A complete document is clean, and an absent minLength is still no check.
  assert.deepEqual(blankDeclaredStrings(schema, answer()), []);
  assert.deepEqual(blankDeclaredStrings({ properties: { x: { type: "string" } } }, { x: "" }), []);
});

test("R13: a round-translation argument failure prints the fixed line, not a raw diagnostic", () => {
  // parseArgs throws before runTranslation can emit anything, so the log's
  // last line -- which the skill says to paste verbatim -- was a technical
  // error David has no reason to recognise. (Codex, #81 round 3.)
  const out = [];
  const err = [];
  const so = process.stdout.write;
  const se = process.stderr.write;
  process.stdout.write = (s) => (out.push(s), true);
  process.stderr.write = (s) => (err.push(s), true);
  let code;
  try {
    code = main(["--role", "round-translation", "--pr", String(PR), "--round", "3"]);
  } finally {
    process.stdout.write = so;
    process.stderr.write = se;
  }
  assert.equal(code, 1, "still non-zero, so the exit file records a failure");
  assert.equal(out.length, 1, "exactly one line for chat");
  assert.equal(out[0], "round 3: translation unavailable — role \"round-translation\" requires --mcp-snapshot\n");
  assert.match(err.join(""), /requires --mcp-snapshot/, "the diagnostic still goes to stderr");
});

test("R13: an unparseable round says so rather than inventing one, and other roles are untouched", () => {
  const run = (argv) => {
    const out = [];
    const so = process.stdout.write;
    const se = process.stderr.write;
    process.stdout.write = (s) => (out.push(s), true);
    process.stderr.write = () => true;
    try {
      return { code: main(argv), out };
    } finally {
      process.stdout.write = so;
      process.stderr.write = se;
    }
  };

  const bad = run(["--role", "round-translation", "--pr", String(PR), "--round", "not-a-number"]);
  assert.equal(bad.out.length, 1);
  assert.match(bad.out[0], /^round \?: translation unavailable — /, "`?` rather than a round the operator did not name");

  // A bare role name is not `--role`, so argv[roleAt + 1] must not be read off
  // a missing flag: the probe and every other role keep a silent stdout.
  const probe = run(["--role", "probe", "--pr"]);
  assert.equal(probe.out.length, 0, "only round-translation owes a chat line");
  const positional = run(["round-translation"]);
  assert.equal(positional.out.length, 0, "no --role flag, so no round-translation invocation to report");
});

test("R12: the emptiness check is WIRED into the dispatch, not merely exported", () => {
  // Measured, not assumed: with the call removed from the `problems` chain the
  // test above still passes, because it exercises the function directly. That
  // is the hollow-test class D0 caught on R10 in round 2, and a static check is
  // the idiom this repo already uses for the `pathToFileURL` form. Source-level
  // because the real path runs a reviewer: it cannot be driven from a unit test.
  const src = fs.readFileSync(new URL("../fable-dispatch.mjs", import.meta.url), "utf8");
  const call = /const blank = blankDeclaredStrings\(schemaParsed, result\.structured_output\);/;
  assert.match(src, call, "the accepted document is checked before it becomes a receipt");

  // And it must feed `problems` -- which earns P4's one re-ask and then its
  // refusal -- rather than throwing past it or being logged and ignored.
  const between = src.slice(src.search(call), src.indexOf("if (problems.length) {", src.search(call)));
  assert.match(between, /problems\.push\(/, "a blank document joins `problems`, so it gets the same one re-ask");

  // The schema it validates against is the role's own, read at the spawn
  // commit -- so a role that declares no minLength still gets no check.
  assert.match(src, /schemaParsed = JSON\.parse\(schemaJson\)/, "the parsed schema is kept, not discarded");
});

test("R11: the brief labels which comment window it is showing", () => {
  // The heading is the reviewer's provenance label. On a round that is not the
  // latest the window is a bounded slice, and calling it "since this round
  // returned" would present a partial view as a complete one.
  const snap = snapshot();
  snap.reviews.push({
    id: 900002,
    user: { login: BOT },
    submitted_at: T("2026-09-12T10:45:00Z"),
    commit_id: HEAD,
    body: "**Reviewed commit:** " + HEAD,
    html_url: url("pullrequestreview-900002"),
  });

  const bounded = translationBrief(build(snap, 1));
  assert.match(bounded, /## Said on the pull request itself between this round and the next one \(2026-09-12T10:00:00\.000Z to 2026-09-12T10:45:00\.000Z\)/);
  assert.ok(!bounded.includes("since this round returned"), "not described as everything that followed");

  const open = translationBrief(build(snapshot(), 1));
  assert.match(open, /## Said on the pull request itself since this round returned \(nothing has followed it\)/);
});

test("R14: a capture inside the reply's own second is refused, not read as later", () => {
  // GitHub dates comments to the second, so a reply written at 10:30:00.600
  // arrives as 10:30:00.000. A capture at 10:30:00.100 is genuinely EARLIER
  // than the reply and would miss it, while comparing as later. The repository
  // already spells this rule `<= acceptedAt + 999` in collectionsReadBefore.
  const inSameSecond = snapshot({ capturedAt: "2026-09-12T10:30:00.100Z" });
  assert.throws(() => build(inSameSecond), /not clearly after .* GitHub dates\s+comments to the second/s);

  // The exact instant is refused too: nothing shows the capture came after.
  assert.throws(() => build(snapshot({ capturedAt: "2026-09-12T10:30:00.000Z" })), /not clearly after/);

  // Clearing the whole second is enough, and is what a real capture does.
  assert.doesNotThrow(() => build(snapshot({ capturedAt: "2026-09-12T10:30:01.000Z" })));
});

test("R15: an overlapping thread page counts one finding, not two", () => {
  // Two concatenated captured pages that overlap are a supported input shape --
  // reviewerPasses deduplicates reviews by id for exactly this reason. A
  // repeated thread numbered twice tells David a finding was raised twice and
  // disagrees with every mechanical count of the same round.
  const snap = snapshot();
  const clean = build(snap);
  assert.equal(clean.findings.length, 2, "two distinct findings to begin with");

  const overlapped = snapshot();
  overlapped.reviewThreads = [...overlapped.reviewThreads, overlapped.reviewThreads[0]];
  const record = build(overlapped);
  assert.equal(record.findings.length, 2, "the repeated thread is one finding");
  assert.deepEqual(
    record.findings.map((f) => f.n),
    [1, 2],
    "and the numbering has no gap or repeat",
  );
});

test("R16: a concurrent delivery's round cannot be overwritten out of the page", () => {
  // Every round is dispatched detached, so two deliveries overlap: A
  // enumerates its own receipt only, B writes its receipt and publishes the
  // complete page, then A's write lands from its stale list and B's round is
  // gone. Waiting on every exit file does not catch it -- both rounds ran.
  const root = tmpRepo();
  const receipts = path.join(root, ".agents", "receipts");
  fs.mkdirSync(receipts, { recursive: true });
  const put = (round) =>
    fs.writeFileSync(
      path.join(receipts, `fable-round-translation-${PR}-${round}.json`),
      JSON.stringify({ role: "round-translation", pr: PR, round, output: answer() }),
    );

  put(1);
  // A is inside publishPage having seen only round 1; B lands round 2 between
  // A's enumeration and A's re-read. `publishPage` re-reads after writing, so A
  // repairs the page it just made stale.
  const realRead = fs.readdirSync;
  let calls = 0;
  fs.readdirSync = (...args) => {
    calls += 1;
    if (calls === 2) put(2); // B's receipt appears after A's first enumeration
    return realRead(...args);
  };
  let rel;
  try {
    rel = publishPage(root, PR, { runGit: () => ({ status: 0 }) });
  } finally {
    fs.readdirSync = realRead;
  }

  const html = fs.readFileSync(path.join(root, rel), "utf8");
  assert.match(html, /Round 1/, "round 1 is on the page");
  assert.match(html, /Round 2/, "and so is the round that landed mid-publish");
});

test("R16: the page is written atomically, so no reader sees it half-built", () => {
  const src = fs.readFileSync(new URL("../round-translation-page.mjs", import.meta.url), "utf8");
  assert.match(src, /fs\.renameSync\(tmp, file\)/, "rename, not a truncating write into the live path");
  assert.ok(!/fs\.writeFileSync\(file, /.test(src), "nothing writes the live page path directly");
});

// ---------------------------------------------------------------------------
// Round 5's fixes, and the re-run rule David settled on 2026-09-13:
// a re-run fills a hole, it never replaces an account.
// ---------------------------------------------------------------------------

test("R17: an old round's diff stops at the next pass's commit, not the live head", () => {
  // The catch-up case `runTranslation` supports: round 1 was never translated,
  // rounds 2+ have landed, close-out wants it. Against the live head the brief
  // carries round 2's code under round 1's heading. The comment window was
  // bounded in c11dae0 and the diff window was not -- half a fix.
  const NEXT = "1111111111111111111111111111111111111111";
  const snap = snapshot();
  snap.reviews.push({
    id: 900002,
    user: { login: BOT },
    submitted_at: T("2026-09-12T10:45:00Z"),
    commit_id: NEXT,
    body: "**Reviewed commit:** " + NEXT,
    html_url: url("pullrequestreview-900002"),
  });

  const ranges = [];
  const spy = (args) => {
    if (args[0] === "rev-parse") return `${HEAD}\n`;
    if (args[0] === "diff" && args.includes("--name-only")) return "";
    if (args[0] === "diff") {
      ranges.push(args.find((a) => a.includes("..")));
      return "diff --git a/x b/x\n+ y\n";
    }
    return "";
  };

  const old = buildTranslationRecord(snap, 1, { runGit: spy, now: () => T("2026-09-12T11:05:00Z") });
  assert.equal(old.diff.range, `${REVIEWED}..${NEXT}`, "far end is the next pass's commit");
  assert.ok(ranges.every((r) => r.endsWith(NEXT)), "git was asked for that range, not the head");
  assert.equal(old.pr.headSha, HEAD, "the PR's own head is still reported as the PR's head");

  // The latest round still runs to the live head -- there is no next pass.
  ranges.length = 0;
  const latest = buildTranslationRecord(snap, 2, { runGit: spy, now: () => T("2026-09-12T11:05:00Z") });
  assert.equal(latest.diff.range, `${NEXT}..${HEAD}`);
});

test("R18: the brief does not name who resolved a thread", () => {
  // The snapshot carries isResolved and no resolver identity; David or any
  // maintainer can resolve one. Naming the builder invented provenance inside
  // the role whose boundary is that every block says where it came from.
  const brief = translationBrief(build());
  assert.match(brief, /_This thread is marked resolved\._/);
  assert.ok(!/builder marked/i.test(brief), "no actor is attributed to the resolution");
  assert.match(brief, /_This thread is still open\._/, "the open case is unchanged");
});

test("R19: a re-run fills a hole by republishing, and never replaces an account", () => {
  const root = tmpGitRepo();
  const receipts = path.join(root, ".agents", "receipts");
  fs.mkdirSync(receipts, { recursive: true });
  const snapPath = path.join(root, "snap.json");
  fs.writeFileSync(snapPath, JSON.stringify(snapshot()));

  // `runTranslation` with an EXPLICIT root, not `main()`. `main()` resolves the
  // root with `repoRoot()`, which walks up from the script's own location and
  // ignores the working directory -- so the first version of this test chdir'd
  // into `root` and then exercised the REAL repository's receipts. It passed
  // here only because my own `.agents/receipts/` happened to hold a matching
  // receipt from a live run, and CI, which has none, caught it. Third instance
  // in this loop of a test asserting my assumption instead of the behaviour.
  const run = () => {
    const out = [];
    const so = process.stdout.write;
    const se = process.stderr.write;
    process.stdout.write = (s) => (out.push(s), true);
    process.stderr.write = () => true;
    try {
      return { code: runTranslation(root, { role: "round-translation", pr: PR, round: 1, snapshot: snapPath, timeout: 60 }), out };
    } finally {
      process.stdout.write = so;
      process.stderr.write = se;
    }
  };

  // With an account already on disk the run REPUBLISHES from it and never
  // reaches the reviewer. The earlier version of this rule refused outright,
  // which turned a failed publish into an unrecoverable state -- the receipt
  // survives `deliverTranslation`'s catch, so the retry that would have fixed
  // the page met the refusal instead. (Codex, #81 round 6.)
  const receiptPath = path.join(receipts, `fable-round-translation-${PR}-1.json`);
  fs.writeFileSync(
    receiptPath,
    JSON.stringify({ role: "round-translation", pr: PR, round: 1, output: answer() }),
  );
  const before = fs.readFileSync(receiptPath, "utf8");

  const republished = run();
  assert.equal(republished.code, 0, "republishing is success, not failure -- the round IS on the page");
  assert.equal(republished.out.length, 1, "one chat line");
  assert.equal(republished.out[0], `${chatLine({ round: 1, output: answer() })}\n`, "the EXISTING account's line");
  assert.equal(fs.readFileSync(receiptPath, "utf8"), before, "the account itself is untouched");

  const page = fs.readFileSync(pagePath(root, PR), "utf8");
  assert.match(page, /Round 1/, "and the page now carries the round the receipt describes");

  // Idempotent: running it again rebuilds the same page from the same account.
  const again = run();
  assert.equal(again.code, 0);
  assert.equal(again.out[0], republished.out[0]);
  assert.equal(fs.readFileSync(receiptPath, "utf8"), before);

  // An unreadable receipt is not an account: it cannot be republished, and
  // re-dispatching would spend money to overwrite a file nobody has read.
  fs.writeFileSync(receiptPath, "{ not json");
  const broken = run();
  assert.equal(broken.code, 1);
  assert.match(broken.out[0], /unreadable; delete it to re-translate/);

  // With no receipt at all the re-run is hole-filling, which is what every
  // legitimate re-run is -- provider down, a refusal on a stale capture, a
  // round never translated. It proceeds to the record build.
  fs.rmSync(receiptPath);
  const allowed = run();
  assert.ok(!/already has an account|unreadable/.test(allowed.out.join("")), "not short-circuited");
});

test("R19: publishPage's size comparison is sound only because no receipt is ever rewritten", () => {
  // Stated as a dependency rather than assumed. The receipt set can only GROW
  // -- an existing account is republished, never re-dispatched -- so a changed
  // count is the only change available and comparing sizes is comparing
  // contents. If anything ever lets a round's receipt be rewritten, this
  // comparison silently stops holding, which is what D0 found on round 4.
  const dispatch = fs.readFileSync(new URL("../fable-dispatch.mjs", import.meta.url), "utf8");
  assert.match(dispatch, /fs\.existsSync\(existing\)/, "an existing account is detected before the dispatch");
  assert.match(dispatch, /already has an account at/, "and reported");
  // The load-bearing half: that branch must REPUBLISH, not fall through to a
  // second reviewer run that would overwrite the account.
  const branch = dispatch.slice(dispatch.indexOf("fs.existsSync(existing)"), dispatch.indexOf("let record;"));
  assert.match(branch, /publishPage\(root, args\.pr\)/, "it republishes from the existing account");
  assert.ok(!/dispatch\(\{/.test(branch), "and never reaches the reviewer");

  const page = fs.readFileSync(new URL("../round-translation-page.mjs", import.meta.url), "utf8");
  assert.match(page, /COMPARING THE SET'S SIZE IS COMPARING ITS CONTENTS/, "the dependency is written down where it is relied on");
  assert.match(page, /NO PATH WRITES A DIFFERENT RECEIPT FOR A ROUND THAT ALREADY HAS ONE/, "and it names what it depends on");
});

test("R20: every path expansion in the pr-watch recipes is quoted", () => {
  // Not a spot-check on the one line Codex cited. An unquoted `$D` word-splits
  // before the glob expands, so on a checkout whose path contains a space the
  // close-out loop iterates fabricated fragments and then waits FOREVER on exit
  // files that can never appear -- after every translation has succeeded.
  // Measured: the unquoted form times out with all exit files present; the
  // quoted form terminates. I quoted the dispatch in c75180b and missed this
  // loop eleven lines below it, which is why the check is over the file.
  const skill = fs.readFileSync(
    new URL("../../.claude/skills/pr-watch/SKILL.md", import.meta.url),
    "utf8",
  );

  // Inside fenced blocks only: prose names `$D` legitimately.
  const shell = [...skill.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
  const uses = shell.split("\n").filter((l) => /\$D/.test(l));
  assert.ok(uses.length >= 4, "the recipes do use $D, so this test is not vacuous");

  for (const line of uses) {
    // An assignment (`D=$PWD/...`) does not word-split in bash and is fine.
    if (/^\s*D=/.test(line)) continue;
    const bare = line.match(/(?<!")\$D\/[^\s"]*/g) ?? [];
    assert.deepEqual(bare, [], `unquoted $D in: ${line.trim()}`);
  }

  // EVERY `$PWD` too, for the same reason and by the same rule -- the close-out
  // command interpolates one directly rather than through `$D`, and a path
  // with a space in it splits there exactly as it would anywhere else.
  for (const line of shell.split("\n").filter((l) => /\$PWD/.test(l))) {
    if (/^\s*D=/.test(line)) continue;
    const bare = line.match(/(?<!")\$PWD\/[^\s"]*/g) ?? [];
    assert.deepEqual(bare, [], `unquoted $PWD in: ${line.trim()}`);
  }

  // And the two that bit. The close-out glob that carried the original finding
  // is gone -- the wait is a script now -- so what stands in its place is the
  // command that replaced it, whose one path argument is quoted.
  assert.match(skill, /node scripts\/round-translation-closeout\.mjs --pr <n>\n/, "the close-out command takes the PR number and nothing else");
  assert.ok(!/round-translation-closeout\.mjs[^\n]*--mcp-snapshot/.test(skill), "and is never pointed at a snapshot file");
  assert.match(skill, /mkdir -p "\$D"/, "and so is the capture directory");
});

test("R21: the close-out recipe carries no shell loop at all", () => {
  // R21 used to measure the unmatched-glob hang directly: with no
  // snap-r*.json present bash left the pattern unexpanded, `r` became `*`,
  // and the loop waited on d0-r*.exit, which nothing ever creates. Then it
  // became a structural check that no loop globbed the directory. Both are
  // now moot for the same reason: four findings in one review loop were
  // defects in four lines of bash, so the close-out wait is a script.
  //
  // What survives is the class, checked over the whole file so a future
  // rewrite cannot quietly bring any of them back: no fenced block in this
  // skill may loop, and none may call `exit`. (Codex, #81 rounds 6, 7 and 9;
  // the `exit` was my own, caught before pushing.)
  const skill = fs.readFileSync(new URL("../../.claude/skills/pr-watch/SKILL.md", import.meta.url), "utf8");
  const blocks = [...skill.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 3, "the skill does carry fenced recipes, so this test is not vacuous");
  const shell = blocks.join("\n");
  assert.match(shell, /round-translation-closeout\.mjs/, "and close-out is one of them");

  const loops = shell.split("\n").filter((l) => /^\s*(for\b|while\b|until\b)/.test(l) && !/^\s*for c in pr reviews/.test(l));
  assert.deepEqual(loops, [], "the close-out wait is a script; a shell loop here is how every one of those bugs got in");
  assert.deepEqual(
    shell.split("\n").filter((l) => /^\s*exit\s/.test(l)),
    [],
    "`exit` in a block pasted into an interactive shell closes the operator's terminal",
  );
});

test("R22: the chat line never says 'agrees' over a round the builder has not answered", () => {
  // assertCaptureAfterResponse PERMITS an unanswered round -- it returns null
  // and the record carries that as round.respondedAt -- because translating one
  // is legitimate. What was not legitimate is the fall-through: a clean account
  // of an unanswered round has no disagreements and nothing unassessed, so it
  // landed on "agrees with the builder's account" when there was no account.
  // Round 5 of this very PR was an unanswered round.
  const clean = {
    summary_for_david: "s",
    what_happened: "w",
    disagreements: [],
    could_not_assess: "",
    recommendation: "r",
  };

  // `builderAnsweredAt`, not `respondedAt`: round 8 found that the wide
  // predicate counts a maintainer's comment as the builder answering.
  const unanswered = { round: 7, output: clean, record: { round: { respondedAt: null, builderAnsweredAt: null } } };
  assert.match(chatLine(unanswered), /no builder account yet/);
  assert.doesNotMatch(chatLine(unanswered), /agrees/);
  assert.equal(facts(unanswered).answered, false);

  // The page carries the same claim off the same facts, so it moves too.
  assert.match(renderPage([unanswered]), /unanswered<\/span>/);
  assert.doesNotMatch(renderPage([unanswered]), />agrees</);

  // ANSWERED still agrees -- otherwise the fix would have deleted the shape
  // rather than bounded it.
  const answered = { round: 6, output: clean, record: { round: { respondedAt: "2026-09-13T00:46:31.000Z", builderAnsweredAt: "2026-09-13T00:46:31.000Z" } } };
  assert.match(chatLine(answered), /agrees with the builder's account/);
  assert.equal(facts(answered).answered, true);

  // And the two shapes that were already honest are untouched on an unanswered
  // round: both are supported by the receipt's own fields either way, which is
  // why this class has exactly one member.
  const differs = { ...unanswered, output: { ...clean, disagreements: [{ what: "x", why_it_matters: "y" }] } };
  assert.match(chatLine(differs), /differs on 1 point/);
  const partial = { ...unanswered, output: { ...clean, could_not_assess: "the diff was truncated" } };
  assert.match(chatLine(partial), /partial/);

  // A receipt written before this field existed has no `record` at all. That
  // must read as "not established", never as "unanswered" -- inventing an
  // unanswered round over an old receipt is the same wrong account facing the
  // other way.
  assert.equal(facts({ round: 1, output: clean }).answered, true);
});

test("R23: no builder-account claim survives on an unanswered round, anywhere on the page", () => {
  // WRITTEN AS A SEARCH, NOT AS AN ENUMERATION. Round 8's fix asserted the
  // class "has exactly one member and this is all of it" and was wrong twice
  // over: the page's heading and its no-disagreements prose both still claimed
  // an account, and the verdict chip carries the same claim while containing
  // none of the words a grep would find. So this test renders the page and
  // scans the OUTPUT for any sentence that presupposes a builder account,
  // rather than checking the strings I happened to think of.
  const clean = {
    summary_for_david: "s",
    what_happened: "w",
    disagreements: [],
    could_not_assess: "",
    recommendation: "r",
  };
  const unanswered = {
    round: 9,
    finishedAt: "2026-09-13T04:00:00Z",
    record: { round: { respondedAt: "2026-09-13T03:05:00.000Z", builderAnsweredAt: null } },
    output: clean,
  };

  // The fixture is the defect's own shape: respondedAt NON-null (a maintainer
  // commented) while the builder never did. Before this fix that combination
  // read as answered.
  assert.equal(facts(unanswered).answered, false, "a maintainer's comment is not a builder account");

  const html = renderPage([unanswered], { pr: 81 });
  const round = html.slice(html.indexOf('<section class="round"'));

  // Every claim of agreement or of a builder-authored account, however phrased.
  for (const claim of [
    /agrees/i,
    /same way the builder/i,
    /\bWhere the translator differs from the builder\b(?! — no account)/,
    />\s*differs on/i,
  ]) {
    assert.doesNotMatch(round, claim, `an unanswered round must not render ${claim}`);
  }
  assert.match(round, /unanswered<\/span>/, "and it says so where the verdict goes");
  assert.match(round, /no account to compare/);

  // ANSWERED IS UNTOUCHED -- the fix bounds the claim rather than deleting it.
  const answered = { ...unanswered, round: 6, record: { round: { respondedAt: "x", builderAnsweredAt: "2026-09-13T00:46:31.000Z" } } };
  const ok = renderPage([answered], { pr: 81 });
  assert.match(ok, /It read the round the same way the builder described it\./);
  assert.match(ok, />agrees</);
  assert.match(chatLine(answered), /agrees with the builder's account/);

  // DISAGREEMENTS STILL RENDER on an unanswered round. Suppressing what the
  // translator actually wrote would lose paid-for content, which is this same
  // class of defect facing the other way.
  const withDiffs = {
    ...unanswered,
    output: { ...clean, disagreements: [{ what: "THE-DISAGREEMENT-BODY", why_it_matters: "THE-STAKES" }] },
  };
  const diffHtml = renderPage([withDiffs], { pr: 81 });
  assert.match(diffHtml, /THE-DISAGREEMENT-BODY/);
  assert.match(diffHtml, /THE-STAKES/);
  assert.doesNotMatch(diffHtml, /same way the builder/i);

  // A receipt from before builderAnsweredAt existed reads as NOT ESTABLISHED,
  // never as unanswered.
  assert.equal(facts({ round: 1, output: clean }).answered, true);
  assert.equal(facts({ round: 2, output: clean, record: { round: { respondedAt: "x" } } }).answered, true);
});

test("R23: the record derives builderAnsweredAt from builder comments alone", () => {
  // The half of the same defect that lives in the record. respondedAt stays
  // wide -- capture freshness must beat EVERY comment on the round -- and the
  // account-present question gets its own predicate.
  const threads = [
    {
      comments: [
        { role: "reviewer", author: "chatgpt-codex-connector", at: "2026-09-13T03:00:00Z" },
        { role: "other", author: "SomeMaintainer", at: "2026-09-13T03:05:00Z" },
      ],
    },
  ];
  assert.equal(builderAnsweredAt(threads, []), null, "a maintainer's comment is not the builder answering");

  const snapshot = {
    fetchedAt: "2026-09-13T03:10:00Z",
    capturedAt: {
      pr: "2026-09-13T03:10:00Z",
      reviews: "2026-09-13T03:10:00Z",
      issueComments: "2026-09-13T03:10:00Z",
      reviewThreads: "2026-09-13T03:10:00Z",
    },
  };
  assert.equal(
    assertCaptureAfterResponse(snapshot, threads, []),
    "2026-09-13T03:05:00.000Z",
    "while freshness still has to beat that same maintainer comment",
  );

  // And the builder's own word is found wherever it sits -- a thread reply or
  // a PR comment in the round's window.
  const answeredInThread = [
    { comments: [{ role: "builder", author: "TheAnswerManIsHere", at: "2026-09-13T03:07:00Z" }] },
  ];
  assert.equal(builderAnsweredAt(answeredInThread, []), "2026-09-13T03:07:00.000Z");
  assert.equal(
    builderAnsweredAt(threads, [{ role: "builder", author: "TheAnswerManIsHere", at: "2026-09-13T03:09:00Z" }]),
    "2026-09-13T03:09:00.000Z",
  );
});

test("R24: an overlapping comment page is one comment in the brief, not two", () => {
  // `pagedArray()` refuses an incomplete LAST page and does nothing about an
  // overlapping one, so `pages.flat()` can repeat a record -- the input shape
  // `reviewerPasses` and `roundThreads` already deduplicate for. This
  // collection read straight through, so a repeated builder comment reached
  // the translator as two separate replies and inflated what the builder
  // appeared to have said. (Codex, #81 round 9.)
  const snap = snapshot();
  const pass = passFor(snap, 1).pass;
  const before = commentsSincePass(snap, pass, BUILDER);
  assert.equal(before.length, 1, "one context comment to start with, so this test is not vacuous");

  // The same record twice, exactly as two overlapping pages concatenate.
  snap.issueComments.push({ ...snap.issueComments.find((c) => c.id === 800001) });
  assert.equal(
    snap.issueComments.filter((c) => c.id === 800001).length,
    2,
    "the fixture really does carry the duplicate",
  );

  const after = commentsSincePass(snap, pass, BUILDER);
  assert.deepEqual(
    after.map((c) => c.body),
    before.map((c) => c.body),
    "a repeated comment is one comment",
  );

  // AND NOTHING IS DROPPED for want of an id. Keying on `undefined` would
  // collapse every id-less comment into one, which is the worse failure of
  // the two: a duplicate reads as emphasis, a dropped comment reads as
  // silence. Two distinct id-less comments must both survive.
  snap.issueComments.push(
    { user: { login: BUILDER }, body: "no id, first", created_at: T("2026-09-12T10:41:00Z"), html_url: url("issuecomment-0") },
    { user: { login: BUILDER }, body: "no id, second", created_at: T("2026-09-12T10:42:00Z"), html_url: url("issuecomment-0") },
  );
  const bodies = commentsSincePass(snap, pass, BUILDER).map((c) => c.body);
  assert.ok(bodies.includes("no id, first") && bodies.includes("no id, second"), "id-less comments are kept, not collapsed");
});

test("R24: every snapshot collection the record reads is deduplicated", () => {
  // The completeness claim this loop keeps getting wrong, stated as a command
  // rather than as a memory: `grep -n` for every read of a snapshot collection
  // in the record builder, then account for each one. Round 8 falsified the
  // same kind of claim made from enumeration alone, so it is made here from a
  // search that the test itself re-runs.
  const src = fs.readFileSync(new URL("../round-translation-record.mjs", import.meta.url), "utf8");
  const reads = src
    .split("\n")
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /snapshot\.(issueComments|reviewThreads|reviews)\b/.test(l));
  assert.equal(reads.length, 5, `the record reads five snapshot collections; found ${reads.length} -- account for the new one`);

  // Named, so a sixth read fails the count above and lands here to be argued:
  //  127  reviewerPasses(...)      -- deduped upstream, reviews AND comments
  //  161  flattenMcpThreads(...)   -- feeds a Map keyed by comment id, idempotent
  //  191  roundThreads(...)        -- `seen` set on the thread root id
  //  ~242 commentsSincePass(...)   -- `seen` set on the comment id (this fix)
  //  ~371 assertThreadProvenance() -- per-thread validation; a duplicate cannot change its verdict
  assert.match(src, /const seen = new Set\(\);[\s\S]{0,80}for \(const thread of snapshot\.reviewThreads/, "roundThreads dedupes");
  assert.match(src, /const seen = new Set\(\);\n  return \(snapshot\.issueComments/, "commentsSincePass dedupes");
});

test("R25: the loop position is derived from the evidence, and the round follows it", () => {
  // Gap 16's hole was close-out enumerating snapshots that exist rather than
  // rounds that happened. Counting rounds fixed that; a count the OPERATOR
  // typed reintroduced it (Codex, #82 round 1); a snapshot the operator NAMED
  // reintroduced it again (D0, #82 round 1). So the round is not derived at
  // the point of use at all. It is derived once, where evidence enters, and
  // written to one file. (David, 2026-09-13.)
  const one = snapshot();
  const p1 = derivePosition(one);
  assert.equal(p1.round, 1, "the base fixture records one pass, so this test is not vacuous");
  assert.equal(p1.pr, PR);
  assert.equal(p1.head, HEAD);
  assert.equal(p1.lastPassCommit, REVIEWED);
  assert.equal(p1.pendingRequest, false);
  assert.equal(p1.tier, null, "no budget yet is a legitimate state -- internal tiers declare at the first re-request");
  assert.equal(p1.allowance, null);
  assert.equal(p1.capturedAt, capturedAtOf(one), "stamped with the evidence's own (oldest) capture time, not the clock");

  // A second pass in the evidence moves the round by itself.
  one.reviews.push({
    id: 900009, user: { login: BOT }, state: "COMMENTED", submitted_at: T("2026-09-12T11:45:00Z"),
    commit_id: HEAD, body: "**Reviewed commit:** " + HEAD, html_url: url("pullrequestreview-900009"),
  });
  assert.equal(derivePosition(one).round, 2, "the round follows the evidence, with nothing passed in");

  // A budget, when one exists, gives the allowance -- through the same
  // `allowance()` the guard uses, never a second formula.
  const budgeted = derivePosition(one, { loop: { tier: "internal", extensions: [] } });
  assert.equal(budgeted.tier, "internal");
  assert.equal(budgeted.allowance, 3);
});

test("R25: one writer, one reader, and staleness is a field rather than a guess", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-pos-"));
  const snap = snapshot();
  const io = { durableRef: () => null }; // no upstream: the round still gets written
  const written = writeLoopPosition(root, snap, { snapshotPath: "/x/snap-r1.json", io });
  assert.equal(written.path, positionPath(root, PR));
  assert.ok(fs.existsSync(written.path), "the position lands in the PR's reviews directory");

  const evidenceAt = Date.parse(capturedAtOf(snap));
  const fresh = loopPosition(root, PR, { now: evidenceAt + 60_000 });
  assert.equal(fresh.round, 1);
  assert.equal(fresh.snapshot, "/x/snap-r1.json");
  assert.equal(fresh.stale, false);
  assert.equal(fresh.ageMs, 60_000);
  assert.match(describePosition(fresh), /^PR #81: round 1 \(no budget declared yet\), head f00dcaf, as of .* \(1 min ago\)$/);

  // THE SAME FILE, READ AFTER THE BOUND, SAYS SO. A stale answer must not be
  // mistakable for a current one -- that is the whole hole a hand-named
  // snapshot had.
  const later = loopPosition(root, PR, { now: evidenceAt + MAX_SNAPSHOT_AGE_MS + 1 });
  assert.equal(later.stale, true);
  assert.match(describePosition(later), /STALE, assemble a fresh snapshot/);

  // No file, no position: null, never a fabricated zero.
  assert.equal(loopPosition(root, 999), null);
  assert.match(describePosition(null), /no snapshot has been assembled/);

  // The CLI reports the same, and its exit code carries staleness.
  const said = []; const out = [];
  const okExit = positionMain(["--pr", String(PR)], { root, slug: SLUG, log: { write: (t) => said.push(t) }, out: { write: (t) => out.push(t) } });
  assert.equal(positionMain(["--pr", String(PR)], { root, slug: "Other/Repo", log: { write: (t) => said.push(t) }, out: { write: () => {} } }), 2, "a position written for another repository is refused");
  assert.equal(okExit, 1, "the fixture is dated 2026-09-12, so by the time this test runs it is stale and the CLI says so");
  assert.match(out.join(""), /STALE/);
  assert.equal(positionMain(["--pr", "abc"], { root, log: { write: (t) => said.push(t) }, out: { write: () => {} } }), 2);
  assert.equal(positionMain(["--pr", "1", "--rounds", "4"], { root, log: { write: (t) => said.push(t) }, out: { write: () => {} } }), 2, "there is no way to hand it a round");

  fs.rmSync(root, { recursive: true, force: true });
});

test("R25: the snapshot assembler is the writer, checked as wiring rather than assumed", () => {
  // The direct tests above pass with the call removed from the assembler --
  // the hollow-test shape this suite has been burned by (#81 round 2). So the
  // wiring is asserted against the source: the one place fresh evidence
  // enters this machinery is the one place the position is written.
  const src = fs.readFileSync(new URL("../snapshot-from-captures.mjs", import.meta.url), "utf8");
  assert.match(src, /import \{ writeLoopPosition[^}]*\} from "\.\/loop-position\.mjs"/, "the assembler imports the writer");
  assert.match(src, /writeFileSync\(out, [^\n]*\n[\s\S]{0,900}writeLoopPosition\(root, snapshot/, "and calls it right after writing the snapshot");
  // The root is a SEAM, not a constant: hardcoding it is what let the shipped
  // suite write a position into the working checkout. (Codex, #82 round 3.)
  assert.match(src, /export function main\(argv = process\.argv\.slice\(2\), \{ root = REPO_ROOT \} = \{\}\)/, "the assembler takes an injectable root");
  assert.ok(!/writeLoopPosition\(REPO_ROOT/.test(src), "and never writes the position to a hardcoded root");

  // And nothing else writes it. `positionPath` has exactly one writer.
  const files = fs.readdirSync(new URL("..", import.meta.url)).filter((f) => f.endsWith(".mjs"));
  const writers = files.filter((f) => /writeLoopPosition\(/.test(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8")));
  assert.deepEqual(writers.sort(), ["loop-position.mjs", "snapshot-from-captures.mjs"], "one definition, one caller");
});

test("R26: every suite that calls the assembler roots its position write", () => {
  // A SEAM ONLY CONTAINS WHAT GOES THROUGH IT. The root option was added, and
  // one suite was wrapped -- but `review-loop-record.test.mjs` imported and
  // called the same `main()` without it, so running the required core suite
  // still wrote `.agents/reviews/pr-43/loop-position.json` into the live
  // checkout. In a synced consumer that file is stamped for AI-Handbook, so
  // every reader there refuses PR 43 as foreign until another capture repairs
  // it. A fix narrower than its class, which is this repo's most expensive
  // recurring shape, so the class is closed with a check rather than with a
  // second wrapper and a hope. (Codex, #83 round 1.)
  //
  // AND THE CHECK ITSELF HAD THAT SHAPE. Its first version recognised only
  // `main as <name>`, so a suite importing `main` under its own name, or the
  // module as a namespace, was invisible to it -- a guard with a blind spot
  // exactly where it claimed to close a class. It now understands every static
  // shape, and REFUSES a shape it does not understand rather than passing
  // quietly, because passing quietly is the failure being guarded against.
  // (Fable round translation, #83 round 1.)
  const dir = new URL("./", import.meta.url);
  const suites = fs.readdirSync(dir).filter((f) => f.endsWith(".test.mjs"));
  const MODULE = /["']\.\.\/snapshot-from-captures\.mjs["']/;

  // Every local name in a file that reaches the assembler's `main`.
  const bindings = (text) => {
    const found = [];
    // The clause charset is bounded to what an import clause can actually
    // contain -- no quotes, parentheses or semicolons -- so the match cannot
    // run backwards across statements to the file's first `import`, and a bare
    // mention of the module path in a string (R25 reads its source) is not an
    // import at all.
    const clauses = [...text.matchAll(/\bimport\s+([\w\s{},*]*?)\s*from\s*["']\.\.\/snapshot-from-captures\.mjs["']/g)];
    for (const [, clause] of clauses) {
      const namespace = /^\*\s+as\s+(\w+)$/.exec(clause);
      if (namespace) {
        found.push({ call: `${namespace[1]}.main`, ok: true });
        continue;
      }
      if (clause.startsWith("{") && clause.endsWith("}")) {
        for (const spec of clause.slice(1, -1).split(",")) {
          const t = spec.trim();
          const aliased = /^main\s+as\s+(\w+)$/.exec(t);
          if (aliased) found.push({ call: aliased[1], ok: true });
          else if (t === "main") found.push({ call: "main", ok: true });
        }
        continue;
      }
      // A default or bare import of this module reaches `main` by some route
      // this check cannot follow.
      found.push({ call: null, ok: false, clause });
    }
    if (/import\s*\(\s*["'][^"']*snapshot-from-captures\.mjs["']/.test(text)) {
      found.push({ call: null, ok: false, clause: "dynamic import()" });
    }
    return found;
  };

  // Every call of a bound name, with its full argument list, however many
  // lines it spans.
  const calls = (text, name) => {
    const out = [];
    const re = new RegExp(`(?<![\\w.])${name.replace(".", "\\.")}\\(`, "g");
    for (let m = re.exec(text); m; m = re.exec(text)) {
      let depth = 0;
      let i = m.index + m[0].length - 1;
      for (; i < text.length; i += 1) {
        if (text[i] === "(") depth += 1;
        else if (text[i] === ")" && (depth -= 1) === 0) break;
      }
      out.push({ line: text.slice(0, m.index).split("\n").length, text: text.slice(m.index, i + 1) });
    }
    return out;
  };

  const audit = (suite, text) => {
    const offenders = [];
    for (const binding of bindings(text)) {
      if (!binding.ok) {
        offenders.push(`${suite}: imports the assembler as \`${binding.clause}\`, a shape this check cannot follow`);
        continue;
      }
      for (const call of calls(text, binding.call)) {
        // `{ root }` shorthand counts as much as `{ root: tmp }` does.
        if (!/\broot\s*[:,}]/.test(call.text)) offenders.push(`${suite}:${call.line}`);
      }
    }
    return offenders;
  };

  const offenders = [];
  let checked = 0;
  for (const suite of suites) {
    const text = fs.readFileSync(new URL(suite, dir), "utf8");
    if (!MODULE.test(text)) continue;
    const found = bindings(text);
    if (found.length) checked += 1;
    offenders.push(...audit(suite, text));
  }

  assert.ok(checked >= 2, `both known callers were found, not zero (found ${checked})`);
  assert.deepEqual(
    offenders,
    [],
    "every call of the assembler's main() passes a root, so no suite can write a position into the checkout that ran it",
  );

  // THE CHECK IS NOT VACUOUS ON ANY SHAPE. Each of these is a suite that would
  // have slipped past the first version of this test.
  //
  // THE FIXTURES BUILD THEIR OWN SPECIFIER rather than spelling it out. A
  // literal one here would be indistinguishable from a real import when this
  // very file is swept, and the check would then audit its own fixtures and
  // bind every `main(` in the suite. The check has to survive reading itself.
  const M = "../snapshot-from-captures.mjs";
  const shapes = {
    "an unaliased named import": `import { main } from "${M}";\nmain(argv, { out });\n`,
    "a namespace import": `import * as assembler from "${M}";\nassembler.main(argv, { out });\n`,
    "an aliased import": `import { main as go } from "${M}";\ngo(argv, { out });\n`,
    "a default import": `import assembler from "${M}";\nassembler.main(argv);\n`,
    "a dynamic import": `const m = await import("${M}");\nm.main(argv, { out });\n`,
  };
  for (const [name, text] of Object.entries(shapes)) {
    assert.ok(audit("hostile.test.mjs", text).length > 0, `an unrooted call through ${name} is caught`);
  }
  // And each static shape passes once it roots the call, so the check refuses
  // the missing root rather than the import.
  for (const [name, text] of Object.entries(shapes)) {
    if (name === "a default import" || name === "a dynamic import") continue;
    assert.deepEqual(audit("ok.test.mjs", text.replace("{ out }", "{ out, root }")), [], `${name} passes once it roots the call`);
  }
});

test("R25: the close-out wait reports every missing round and never waits on one", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d0-closeout-"));
  fs.writeFileSync(path.join(dir, "snap-r1.json"), "{}");
  fs.writeFileSync(path.join(dir, "d0-r1.exit"), "0\n");
  assert.equal(roundState(dir, 1), "done");
  assert.equal(roundState(dir, 2), "missing", "a round with neither snapshot nor exit file is missing, not pending");

  // Rounds 2 and 3 happened and produced nothing. Both are named -- a
  // close-out told about one gap at a time is a close-out run twice -- and
  // neither is waited on, because no exit file is coming for them.
  let slept = 0;
  const both = await waitForRounds(dir, 3, { sleep: async () => { slept += 1; } });
  assert.deepEqual(both.missing, [2, 3], "every missing round is named, not just the first");
  assert.deepEqual(both.timedOut, []);
  assert.equal(slept, 0, "a missing round is reported immediately, never waited on");

  // A DISPATCHED round IS waited on, and the wait ends when the exit file
  // lands -- a check that reported everything missing would pass the
  // assertions above and break the step's actual job.
  fs.writeFileSync(path.join(dir, "snap-r2.json"), "{}");
  assert.equal(roundState(dir, 2), "pending", "dispatched and not yet returned is its own state, never 'missing'");
  let ticks = 0;
  const landed = await waitForRounds(dir, 2, {
    sleep: async () => {
      ticks += 1;
      if (ticks === 2) fs.writeFileSync(path.join(dir, "d0-r2.exit"), "1\n");
    },
  });
  assert.deepEqual(landed.missing, []);
  assert.deepEqual(landed.timedOut, [], "a round that exited non-zero still counts as accounted for");
  assert.equal(ticks, 2, "it polled until the exit file appeared");

  // AND IT IS BOUNDED. Two earlier versions of this step could wait forever;
  // a dispatch that never returns must end as a report, not as a hang.
  fs.rmSync(path.join(dir, "d0-r2.exit"));
  let clock = 0;
  const stuck = await waitForRounds(dir, 2, { timeoutMs: 30, pollMs: 10, now: () => (clock += 10), sleep: async () => {} });
  assert.deepEqual(stuck.timedOut, [2], "an unfinished dispatch is reported, not waited on forever");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("R25: close-out reads the position and refuses a missing, stale or foreign one", async () => {
  // The undercount and the mis-named snapshot were the same hole: a bound
  // the operator could get wrong. Now there is nothing to get wrong -- no
  // argument carries a round, and the position is refused when it could
  // predate one.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "d0-closeout-"));
  const said = [];
  const log = { write: (t) => said.push(t) };
  const run = (argv, opts = {}) => closeoutMain(argv, { root, log, slug: SLUG, ...opts });

  assert.equal(await run(["--pr", String(PR), "--rounds", "4"]), 2, "there is no way to hand it a round count");
  assert.match(said.join(""), /unknown argument/); said.length = 0;

  assert.equal(await run(["--pr", String(PR)]), 1, "no position: refused, with the remedy named");
  assert.match(said.join(""), /no snapshot has been assembled/); said.length = 0;

  const snap = snapshot();
  snap.reviews.push({
    id: 900009, user: { login: BOT }, state: "COMMENTED", submitted_at: T("2026-09-12T11:45:00Z"),
    commit_id: HEAD, body: "**Reviewed commit:** " + HEAD, html_url: url("pullrequestreview-900009"),
  });
  writeLoopPosition(root, snap, { io: { durableRef: () => null } });
  const fresh = Date.parse(capturedAtOf(snap)) + 1000;

  // THE POSITION IS THE BOUND. Two passes in the evidence, one round on disk:
  // round 2 is named as missing, exactly the undercount case made mechanical.
  const dir = path.join(root, ".agents", "reviews", `pr-${PR}`);
  fs.writeFileSync(path.join(dir, "snap-r1.json"), "{}");
  fs.writeFileSync(path.join(dir, "d0-r1.exit"), "0\n");
  assert.equal(await run(["--pr", String(PR), "--timeout-sec", "1"], { now: fresh }), 1);
  assert.match(said.join(""), /PR #81: round 2 \(no budget declared yet\)/, "the bound came from the position, budget or no budget");
  assert.match(said.join(""), /round\(s\) 2 --/, "and round 2 is named");
  said.length = 0;

  fs.writeFileSync(path.join(dir, "snap-r2.json"), "{}");
  fs.writeFileSync(path.join(dir, "d0-r2.exit"), "0\n");
  assert.equal(await run(["--pr", String(PR)], { now: fresh }), 0, "both rounds accounted for");
  said.length = 0;

  // STALE: the same file, read an hour on, is refused rather than trusted.
  assert.equal(await run(["--pr", String(PR)], { now: fresh + MAX_SNAPSHOT_AGE_MS + 1 }), 1);
  assert.match(said.join(""), /older than 60 minutes/); said.length = 0;

  // FOREIGN: a position written for another repository never bounds this one.
  assert.equal(await run(["--pr", String(PR)], { now: fresh, slug: "Other/Repo" }), 2);
  assert.match(said.join(""), /written for TestOwner\/TestRepo, not Other\/Repo/);

  fs.rmSync(root, { recursive: true, force: true });
});

test("R26: the round never goes backwards, and a floored round says so", () => {
  // THE LAST HOLE IN GAP 16, reached from the opposite side to the one that
  // opened it. `reviewerPasses` is lossy in one shape: where the connector
  // emits no `Reviewed commit` marker and REWRITES its single summary comment
  // in place, two clean automatic passes collapse to one. A count that can
  // fall makes close-out's bound fall with it, so a round that already has a
  // snapshot and an exit file on disk stops being checked and close-out
  // reports success with that round's translation unaccounted for.
  // (Codex, #82 round 3.)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-pos-"));
  const io = { durableRef: () => null };

  // Two passes observed, written.
  const two = snapshot();
  two.reviews.push({
    id: 900009, user: { login: BOT }, state: "COMMENTED", submitted_at: T("2026-09-12T11:45:00Z"),
    commit_id: HEAD, body: "**Reviewed commit:** " + HEAD, html_url: url("pullrequestreview-900009"),
  });
  assert.equal(derivePosition(two).round, 2, "two passes in the evidence, so this test is not vacuous");
  writeLoopPosition(root, two, { io });
  assert.equal(loopPosition(root, PR).round, 2);

  // Now the evidence REGRESSES -- the same PR, one pass visible.
  const one = snapshot();
  assert.equal(derivePosition(one).round, 1, "the regressed evidence really does derive a lower round");
  writeLoopPosition(root, one, { io });

  const held = loopPosition(root, PR);
  assert.equal(held.round, 2, "the round is floored at the highest ever observed");
  assert.equal(held.observedRound, 1, "and what the latest evidence actually derived is kept beside it");
  assert.match(
    describePosition(held),
    /held at 2; the latest evidence derives only 1/,
    "a floored round is said out loud rather than papered over",
  );

  // THE FRESH FIELDS ARE STILL FRESH. Only the round is floored; a floored
  // capture time would be a lie about the capture.
  assert.equal(held.capturedAt, capturedAtOf(one, null, { require: ["pr", "reviews", "issueComments"] }));
  assert.equal(held.head, one.pr.head.sha);

  // AND IT STILL RISES. A floor that pinned the round would be worse than the
  // regression it fixes.
  const three = snapshot();
  for (const [i, at] of [[900009, "2026-09-12T11:45:00Z"], [900010, "2026-09-12T12:45:00Z"]]) {
    three.reviews.push({
      id: i, user: { login: BOT }, state: "COMMENTED", submitted_at: T(at),
      commit_id: HEAD, body: "**Reviewed commit:** " + HEAD, html_url: url(`pullrequestreview-${i}`),
    });
  }
  writeLoopPosition(root, three, { io });
  const risen = loopPosition(root, PR);
  assert.equal(risen.round, 3);
  assert.equal(risen.observedRound, 3, "no floor applies when the evidence leads");
  assert.ok(!/held at/.test(describePosition(risen)), "and nothing is announced when nothing was held");

  fs.rmSync(root, { recursive: true, force: true });
});

test("R26: a pass landing after a loss still counts, and a restored capture does not inflate", () => {
  // THE REPORTED ONE-STEP ADVANCE. The first fix for the lossy history floored
  // the COUNT at the highest ever seen. That holds a regression, and then fails
  // forever after it: once a pass is lost, every later real pass raises the
  // fresh count by one too, so `max(previous.round, observed)` never picks the
  // floor again and the recorded round stays permanently one behind. Worse,
  // `observedRound` catches back up to `round`, so the announcement that made
  // the loss visible disappears at exactly the moment the loss stops being
  // transient. The old test only jumped fresh evidence ABOVE the floor, which
  // is the one advance that cannot expose this. (Codex, #83 round 1.)
  //
  // Each round reviews its own head -- a re-request needs a behavioural change
  // since the last reviewed commit -- so successive passes never share a
  // commit, and that is what makes a per-commit tally able to carry the lost
  // one.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-pos-"));
  const io = { durableRef: () => null };
  const commit = (n) => String(n).repeat(40);
  const pass = (n) => ({
    id: 900100 + n,
    user: { login: BOT },
    state: "COMMENTED",
    submitted_at: T(`2026-09-12T1${n}:00:00Z`),
    commit_id: commit(n),
    body: "**Reviewed commit:** " + commit(n),
    html_url: url(`pullrequestreview-${900100 + n}`),
  });
  // A snapshot showing exactly the passes named, and nothing else.
  const showing = (...ns) => {
    const s = snapshot();
    s.reviews = ns.map(pass);
    return s;
  };
  const after = (...ns) => {
    writeLoopPosition(root, showing(...ns), { io });
    return loopPosition(root, PR);
  };

  assert.equal(after(1, 2).round, 2, "two passes, both visible");

  const lost = after(2);
  assert.equal(lost.observedRound, 1, "the summary row was rewritten and pass 1 is gone from the evidence");
  assert.equal(lost.round, 2, "but the round holds");

  // THE BUG: a third pass lands while pass 1 is still missing.
  const advanced = after(2, 3);
  assert.equal(advanced.observedRound, 2, "the evidence shows two passes");
  assert.equal(advanced.round, 3, "and the round is three, because pass 1 is carried rather than compared away");
  assert.match(
    describePosition(advanced),
    /held at 3; the latest evidence derives only 2/,
    "the disagreement is still announced -- it is permanent now, so it is said permanently",
  );

  assert.equal(after(2, 3, 4).round, 4, "and it keeps up with every later round rather than trailing by one forever");

  // A CAPTURE THAT SEES LESS IS NOT A PASS THAT NEVER HAPPENED, and a capture
  // that sees them again is not new passes. Carrying a per-commit tally gets
  // both: an incomplete capture cannot lower the round, and the full capture
  // after it cannot inflate one -- which a running offset added to the fresh
  // count would have done, permanently, wedging close-out on a round that
  // never existed.
  assert.equal(after(4).round, 4, "an incomplete capture does not lower the round");
  assert.equal(after(2, 3, 4).round, 4, "and restoring what it missed does not raise it either");

  fs.rmSync(root, { recursive: true, force: true });
});

test("R26: a position written before the tally existed keeps its round", () => {
  // THE UPGRADE IS ITSELF A ROUND THAT CAN BE LOST. Every position on disk
  // anywhere carries `round` and no `observedPasses`, so the first assembly
  // under this version finds a carry it cannot read. Carrying nothing there
  // drops the round to the fresh derivation -- and if the evidence is lossy at
  // that moment the drop is silent and permanent, because the deficit is gone
  // for good. Measured before the fix: a legacy round 2 became 1, and the next
  // real pass made it 2 when the truth was 3. (Codex, #83 round 2.)
  const commit = (n) => String(n).repeat(40);
  const pass = (n) => ({
    id: 900200 + n,
    user: { login: BOT },
    state: "COMMENTED",
    submitted_at: T(`2026-09-12T1${n}:00:00Z`),
    commit_id: commit(n),
    body: "**Reviewed commit:** " + commit(n),
    html_url: url(`pullrequestreview-${900200 + n}`),
  });
  const showing = (...ns) => {
    const s = snapshot();
    s.reviews = ns.map(pass);
    return s;
  };
  // A parent-version position: a round, and no tally to read.
  const legacy = (round) => ({ pr: PR, repo: SLUG, round, observedRound: round });

  // The evidence is lossy on the very write that upgrades the file.
  const upgraded = derivePosition(showing(2), { previous: legacy(2) });
  assert.equal(upgraded.observedRound, 1, "the fresh evidence really has lost a pass");
  assert.equal(upgraded.round, 2, "and the legacy round survives the upgrade");
  assert.equal(upgraded.observedPasses["pre-tally"], 1, "the shortfall is booked, since the legacy file cannot say which commit it was");

  // AND IT RECOVERS. The booked shortfall is carried like any other entry, so
  // the next real pass lands on top of it rather than filling the hole.
  const next = derivePosition(showing(2, 3), { previous: upgraded });
  assert.equal(next.round, 3, "a pass after the upgrade counts on top of the carried shortfall");

  // NOTHING IS BOOKED WHEN NOTHING IS MISSING, which is what stops the legacy
  // round being counted a second time on top of the passes it was counting.
  const complete = derivePosition(showing(1, 2), { previous: legacy(2) });
  assert.equal(complete.round, 2, "a complete capture at the upgrade is not inflated by the legacy round");
  assert.ok(!("pre-tally" in complete.observedPasses), "and nothing is booked at all");

  // A legacy round the fresh evidence already exceeds books nothing either.
  assert.equal(derivePosition(showing(1, 2), { previous: legacy(1) }).round, 2, "the evidence still leads when it is ahead");

  // AND A LEGACY ROUND IS STILL ONLY CARRIED FROM OUR OWN POSITION.
  assert.equal(derivePosition(showing(2), { previous: { ...legacy(9), repo: "Other/Repo" } }).round, 1, "not another repository's");
  assert.equal(derivePosition(showing(2), { previous: { ...legacy(9), pr: 999 } }).round, 1, "not another PR's");
  for (const junk of [undefined, null, "2", 0, -1, 1.5, NaN]) {
    assert.equal(
      derivePosition(showing(2), { previous: { pr: PR, repo: SLUG, round: junk } }).round,
      1,
      `a legacy position with an unusable round books nothing: ${String(junk)}`,
    );
  }
});

test("R26: one pass seen in both announcement shapes is one pass, not two", () => {
  // THE CARRY'S OWN WAY OF BEING WRONG, and it faces the opposite way to the
  // undercount it fixes. A pass announces itself with a `Reviewed commit`
  // marker carrying the full forty characters, or -- on a clean automatic
  // round -- only through the connector's summary row, which carries the
  // abbreviated sha it renders. `reviewerPasses` reconciles the two inside a
  // single snapshot, so they never both appear there. Across snapshots they
  // do, and an exact-key tally would read one pass seen in both shapes as two
  // and inflate the round permanently, wedging close-out on a round that never
  // happened. Matched by prefix, through `review-counting`'s own `sameCommit`.
  const one = snapshot();
  const carry = (observedPasses) =>
    derivePosition(one, { previous: { pr: PR, repo: SLUG, observedPasses } });

  assert.equal(derivePosition(one).round, 1, "the fixture is one pass, so none of this is vacuous");

  const abbreviated = carry({ [REVIEWED.slice(0, 7)]: 1 });
  assert.equal(abbreviated.round, 1, "the same pass, carried in its short form, is not a second pass");
  assert.deepEqual(
    Object.keys(abbreviated.observedPasses),
    [REVIEWED],
    "and the full sha is what survives, because it is the key that identifies the commit",
  );

  // THE FOLD MUST NOT SWALLOW A REAL SECOND PASS. A different commit is a
  // different round, however the carry is written.
  assert.equal(carry({ ["1".repeat(40)]: 1 }).round, 2, "a genuinely different commit still counts");
  assert.equal(carry({ [REVIEWED]: 2 }).round, 2, "and a commit the evidence once showed twice still counts twice");

  // AN ARRAY IS NOT A TALLY, rejected as a class rather than only when empty:
  // its indices would otherwise enter the tally as commit keys.
  assert.equal(carry([3, 4]).round, 1, "an array carries nothing");
});

test("R26: a carried tally is never taken from another PR, another repo, or an unreadable file", () => {
  // The carry reaches back into a file on disk, so it needs the same identity
  // discipline every other read in this machinery has. A position for #999, or
  // for another repository, must not raise this one.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-pos-"));
  const one = snapshot();

  // Eight passes on a commit the current evidence never mentions, so a carry
  // that is wrongly honoured is unmistakable in the round rather than subtle.
  const ELSEWHERE = "1".repeat(40);
  const carried = { [ELSEWHERE]: 8 };
  const prev = (over) => derivePosition(one, { previous: { pr: PR, repo: SLUG, observedPasses: carried, ...over } }).round;

  assert.equal(prev({ repo: "Other/Repo" }), 1, "another repository's tally is not carried");
  assert.equal(prev({ pr: 999 }), 1, "another PR's tally is not carried");
  assert.equal(prev({}), 9, "ours is, so the guards above are not vacuous");

  // A MALFORMED TALLY CONTRIBUTES NOTHING rather than throwing or poisoning
  // the sum. The round is a number close-out trusts; a string, a float or a
  // negative reaching it would be worse than a lost pass.
  for (const junk of [null, undefined, "8", 8, [], { [ELSEWHERE]: -3 }, { [ELSEWHERE]: 1.5 }, { [ELSEWHERE]: "8" }, { [ELSEWHERE]: NaN }]) {
    assert.equal(prev({ observedPasses: junk }), 1, `a malformed carried tally is ignored: ${JSON.stringify(junk) ?? "undefined"}`);
  }

  // AN UNREADABLE PREVIOUS POSITION CARRIES NOTHING, NEVER THROWS. This runs
  // inside the snapshot assembler, and a corrupt evidence file must not fail
  // an assembly that otherwise succeeded.
  fs.mkdirSync(path.dirname(positionPath(root, PR)), { recursive: true });
  fs.writeFileSync(positionPath(root, PR), "{ not json");
  const written = writeLoopPosition(root, one, { io: { durableRef: () => null } });
  assert.equal(written.position.round, 1, "a corrupt previous position is ignored");
  assert.equal(JSON.parse(fs.readFileSync(written.path, "utf8")).round, 1, "and it is replaced with a readable one");

  fs.rmSync(root, { recursive: true, force: true });
});

test("R26: close-out's bound is the floored round, so a regressed pass history cannot shrink it", () => {
  // The finding's actual consequence, end to end: with the round floored at 2,
  // close-out must still demand round 2's account even when the latest
  // evidence only derives 1.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "d0-closeout-"));
  const io = { durableRef: () => null };
  const said = [];
  const log = { write: (t) => said.push(t) };

  const two = snapshot();
  two.reviews.push({
    id: 900009, user: { login: BOT }, state: "COMMENTED", submitted_at: T("2026-09-12T11:45:00Z"),
    commit_id: HEAD, body: "**Reviewed commit:** " + HEAD, html_url: url("pullrequestreview-900009"),
  });
  writeLoopPosition(root, two, { io });
  const fresh = Date.parse(capturedAtOf(two, null, { require: ["pr", "reviews", "issueComments"] })) + 1000;

  // Round 1 accounted for, round 2 not. Regress the evidence, then close out.
  const dir = path.join(root, ".agents", "reviews", `pr-${PR}`);
  fs.writeFileSync(path.join(dir, "snap-r1.json"), "{}");
  fs.writeFileSync(path.join(dir, "d0-r1.exit"), "0\n");
  writeLoopPosition(root, snapshot(), { io });

  return closeoutMain(["--pr", String(PR), "--timeout-sec", "1"], { root, log, slug: SLUG, now: fresh }).then((code) => {
    assert.equal(code, 1, "close-out still refuses");
    assert.match(said.join(""), /round\(s\) 2 --/, "and still names round 2, which the regressed history had dropped");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildTranslationRecord,
  translationBrief,
  skipReason,
  passFor,
  authorRole,
  assertCaptureAfterResponse,
  assertCheckoutAtHead,
  assertSnapshotIsForPr,
  roundThreads,
  COMMENT_CAP_CHARS,
} from "../round-translation-record.mjs";
import { facts, chatLine, renderPage, receiptsFor, writePage, pagePath, unavailable } from "../round-translation-page.mjs";
import { reviewerFindings } from "../review-loop-record.mjs";
import { parseArgs, receiptPathFor, canDispatch, dispatchableRoles, roleContract } from "../fable-dispatch.mjs";

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
    /captured at .* before .* commented at .*Read the collections again/s,
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

test("a checkout on another branch produces neither a translation nor a skip receipt", () => {
  const elsewhere = "a".repeat(40);
  assert.throws(() => build(snapshot(), 1, gitAt(elsewhere)), /checkout is at aaaaaaa but this snapshot's pull request head is f00dcaf/);
});

test("the diff runs from the round's reviewed commit to the snapshot's head", () => {
  const record = build();
  assert.equal(record.diff.range, `${REVIEWED}..${HEAD}`);
  assert.match(record.diff.patch, /the fix/);
});

test("a round whose response was replies only reports no diff, and says why", () => {
  const snap = snapshot();
  snap.reviews[0].commit_id = HEAD;
  const record = build(snap);
  assert.equal(record.diff.range, null);
  assert.match(record.diff.note, /replies, not code/);
});

test("assertCheckoutAtHead refuses when git cannot be read at all", () => {
  assert.throws(
    () => assertCheckoutAtHead(HEAD, {
      runGit: () => {
        throw new Error("not a git repository");
      },
    }),
    /could not read HEAD \(not a git repository\)/,
  );
  assert.throws(() => assertCheckoutAtHead(HEAD, { runGit: () => "" }), /could not read HEAD/);
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
  assert.deepEqual(contract.tools, ["Read"]);
  assert.equal(contract.modelTier, "strongestClaude", "a tier, never a version");
  assert.ok(contract.budgetUsd > 0);
  const schema = JSON.parse(fs.readFileSync(path.join(dir, contract.schemaPath), "utf8"));
  assert.deepEqual(schema.required.sort(), ["could_not_assess", "disagreements", "recommendation", "summary_for_david", "what_happened"]);
  assert.equal(schema.additionalProperties, false);
  assert.match(contract.systemPrompt, /cannot read code/, "the role's own text names its reader");
});

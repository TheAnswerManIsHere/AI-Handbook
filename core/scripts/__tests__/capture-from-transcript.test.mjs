// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  COLLECTIONS,
  CAPTURES_DIR,
  capturePath,
  projectSlug,
  findTranscript,
  readCalls,
  resultText,
  spilledPath,
  selectCall,
  selectVerdictCall,
  parseVerdict,
  assertConformance,
  verdictPathFor,
  recoverCapture,
  recoverVerdict,
  parseArgs,
} from "../capture-from-transcript.mjs";
import { captureSource } from "../snapshot-from-captures.mjs";

// A transcript is a file the harness wrote, so these tests use real files in a
// temporary home. Faking the read would leave the one thing this module does
// -- read what the harness actually recorded -- untested.

const use = (id, name, input) => ({
  type: "assistant",
  timestamp: "2026-09-11T10:00:00.000Z",
  message: { content: [{ type: "tool_use", id, name, input }] },
});

const result = (id, text, at = "2026-09-11T10:00:01.000Z") => ({
  type: "user",
  timestamp: at,
  message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }] },
});

const REPO = "o/r";

const prCall = (id, method, extra = {}) =>
  use(id, "mcp__github__pull_request_read", { method, owner: "o", repo: "r", pullNumber: 80, ...extra });

function transcript(events) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
  return file;
}

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-"));
  fs.mkdirSync(path.join(root, ".agents"), { recursive: true });
  return root;
}

test("a recovered capture is the transcript's bytes, exactly", () => {
  const body = '[{"id":1,"state":"COMMENTED"}]';
  const file = transcript([prCall("t1", "get_reviews", { perPage: 100 }), result("t1", body)]);
  const root = repo();

  const out = recoverCapture({ root, pr: 80, collection: "reviews", transcript: file, repo: REPO });

  assert.equal(out.source, "transcript-recovered");
  assert.equal(out.path, capturePath(80, "reviews", 1));
  assert.equal(fs.readFileSync(path.join(root, out.path), "utf8"), body);
  // The class the record will carry follows from the path the script chose.
  assert.equal(captureSource(path.join(root, out.path)), "transcript-recovered");
});

test("the capture time is the transcript's, not the file's", () => {
  const file = transcript([prCall("t1", "get_reviews", { perPage: 100 }), result("t1", "[]", "2026-09-11T09:30:00.000Z")]);
  const out = recoverCapture({ root: repo(), pr: 80, collection: "reviews", transcript: file, repo: REPO });
  assert.equal(out.capturedAt, "2026-09-11T09:30:00.000Z");
});

test("a spilled result resolves to the harness's own file, and is not copied", () => {
  const spill = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "spill-")), "big.txt");
  fs.writeFileSync(spill, "[]");
  const notice = `<persisted-output>\nOutput too large (46.5KB). Full output saved to: ${spill}\n\nPreview (first 2KB):\n[]`;
  const file = transcript([prCall("t1", "get_reviews", { perPage: 100 }), result("t1", notice)]);
  const root = repo();

  const out = recoverCapture({ root, pr: 80, collection: "reviews", transcript: file, repo: REPO });

  assert.equal(out.source, "harness-capture");
  assert.equal(out.path, spill);
  assert.equal(out.spilled, true);
  assert.equal(fs.existsSync(path.join(root, CAPTURES_DIR)), false, "nothing is copied when the original is on disk");
});

test("a spill notice naming a file that is gone refuses rather than copying the preview", () => {
  const notice = "<persisted-output>\nOutput too large. Full output saved to: /nope/gone.txt\n\nPreview (first 2KB):\n[]";
  const file = transcript([prCall("t1", "get_reviews", { perPage: 100 }), result("t1", notice)]);
  assert.throws(() => recoverCapture({ root: repo(), pr: 80, collection: "reviews", transcript: file, repo: REPO }), /no longer there/);
});

test("a later short-page call never displaces an earlier full-page one", () => {
  const full = '[{"id":1}]';
  const file = transcript([
    prCall("t1", "get_reviews", { perPage: 100 }),
    result("t1", full),
    prCall("t2", "get_reviews", { perPage: 10 }),
    result("t2", '[{"id":2}]'),
  ]);
  const root = repo();

  const out = recoverCapture({ root, pr: 80, collection: "reviews", transcript: file, repo: REPO });

  assert.equal(fs.readFileSync(path.join(root, out.path), "utf8"), full);
});

test("only a short-page call exists: refuse, naming what eligibility means", () => {
  const file = transcript([prCall("t1", "get_reviews", { perPage: 10 }), result("t1", "[]")]);
  assert.throws(
    () => recoverCapture({ root: repo(), pr: 80, collection: "reviews", transcript: file, repo: REPO }),
    /no eligible reviews call for o\/r PR 80 page 1[\s\S]*perPage 100/,
  );
});

test("the latest eligible call wins among equals", () => {
  const file = transcript([
    prCall("t1", "get_reviews", { perPage: 100 }),
    result("t1", '["stale"]'),
    prCall("t2", "get_reviews", { perPage: 100 }),
    result("t2", '["fresh"]'),
  ]);
  const root = repo();
  const out = recoverCapture({ root, pr: 80, collection: "reviews", transcript: file, repo: REPO });
  assert.equal(fs.readFileSync(path.join(root, out.path), "utf8"), '["fresh"]');
});

test("selection is pinned to the pull request and the page", () => {
  const calls = readCalls(
    transcript([
      prCall("t1", "get_reviews", { perPage: 100 }),
      result("t1", "[]"),
      use("t2", "mcp__github__pull_request_read", { method: "get_reviews", owner: "o", repo: "r", pullNumber: 99, perPage: 100 }),
      result("t2", "[]"),
      prCall("t3", "get_reviews", { perPage: 100, page: 2 }),
      result("t3", "[]"),
    ]),
  );

  assert.equal(selectCall(calls, { collection: "reviews", pr: 80, page: 1, repo: REPO }).id, "t1");
  assert.equal(selectCall(calls, { collection: "reviews", pr: 99, page: 1, repo: REPO }).id, "t2");
  // And pinned to the REPOSITORY: every repo has an #80, and a foreign empty
  // collection carries no urls for the downstream checks to reject.
  assert.throws(() => selectCall(calls, { collection: "reviews", pr: 80, page: 1, repo: "someone/else" }), /no eligible/);
  assert.equal(selectCall(calls, { collection: "reviews", pr: 80, page: 2, repo: REPO }).id, "t3");
  assert.throws(() => selectCall(calls, { collection: "reviews", pr: 80, page: 3, repo: REPO }), /no eligible/);
});

test("the unpaged collection needs no page size", () => {
  const calls = readCalls(transcript([prCall("t1", "get"), result("t1", "{}")]));
  assert.equal(selectCall(calls, { collection: "pr", pr: 80, repo: REPO }).id, "t1");
  assert.equal(COLLECTIONS.pr.paged, false);
});

test("a call with no recorded result refuses rather than writing an empty capture", () => {
  const file = transcript([prCall("t1", "get_reviews", { perPage: 100 })]);
  assert.throws(() => recoverCapture({ root: repo(), pr: 80, collection: "reviews", transcript: file, repo: REPO }), /no recorded result/);
});

test("a partial last line does not stop the reader", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "partial-"));
  const file = path.join(dir, "s.jsonl");
  fs.writeFileSync(
    file,
    `${JSON.stringify(prCall("t1", "get_reviews", { perPage: 100 }))}\n${JSON.stringify(result("t1", "[]"))}\n{"half":`,
  );
  assert.equal(readCalls(file).length, 1);
});

// --- the adjudicator's answer ---------------------------------------------

const RECORD = JSON.stringify({ pr: 80, findings: { items: [{ threadId: "T1" }, { threadId: "T2" }] } }, null, 2);

function repoWithRecord() {
  const root = repo();
  fs.mkdirSync(path.join(root, ".agents", "adjudications"), { recursive: true });
  fs.writeFileSync(path.join(root, ".agents/adjudications/80-1.json"), RECORD);
  return root;
}

const agentCall = (id, promptPath) =>
  use(id, "Agent", { subagent_type: "review-loop-adjudicator", description: "Adjudicate", prompt: `Read ${promptPath} in full.` });

const CONFORMANCE = [
  { threadId: "T1", class: "in-scope", citation: "", why: "a real defect" },
  { threadId: "T2", class: "out-of-threat-model", citation: "threatModel:12", why: "operator's own argv" },
];
const VERDICT = { verdict: "ship-with-gaps-recorded", grant: 0, risk: "", reasoning: "because", gaps: ["one"], conformance: CONFORMANCE };

test("the verdict file carries the judge's own answer, out of the harness's record of it", () => {
  const root = repoWithRecord();
  const file = transcript([
    agentCall("a1", ".agents/adjudications/80-1.json"),
    result("a1", `\`\`\`json\n${JSON.stringify(VERDICT, null, 2)}\n\`\`\``, "2026-09-11T11:00:00.000Z"),
  ]);

  const out = recoverVerdict({ root, pr: 80, recordPath: ".agents/adjudications/80-1.json", transcript: file });

  assert.equal(out.path, ".agents/adjudications/80-1.verdict.json");
  const written = JSON.parse(fs.readFileSync(path.join(root, out.path), "utf8"));
  assert.deepEqual(written.verdict, VERDICT);
  assert.equal(written.decidedAt, "2026-09-11T11:00:00.000Z");
  assert.equal(written.toolUseId, "a1");
  assert.equal(written.recordPath, ".agents/adjudications/80-1.json");
});

test("a verdict answer that is not the verdict refuses", () => {
  const root = repoWithRecord();
  const file = transcript([agentCall("a1", ".agents/adjudications/80-1.json"), result("a1", "I think you should keep going.")]);
  assert.throws(
    () => recoverVerdict({ root, pr: 80, recordPath: ".agents/adjudications/80-1.json", transcript: file }),
    /does not parse as a JSON object carrying a `verdict` field/,
  );
});

test("a dispatch naming another record is not this record's verdict", () => {
  const root = repoWithRecord();
  const file = transcript([
    agentCall("a1", ".agents/adjudications/79-2.json"),
    result("a1", JSON.stringify(VERDICT)),
  ]);
  assert.throws(
    () => recoverVerdict({ root, pr: 80, recordPath: ".agents/adjudications/80-1.json", transcript: file }),
    /no review-loop-adjudicator dispatch naming/,
  );
});

test("a verdict file sits beside a record that exists", () => {
  const file = transcript([agentCall("a1", ".agents/adjudications/80-1.json"), result("a1", JSON.stringify(VERDICT))]);
  assert.throws(
    () => recoverVerdict({ root: repo(), pr: 80, recordPath: ".agents/adjudications/80-1.json", transcript: file }),
    /does not exist -- a verdict file sits beside its record/,
  );
});

test("the latest adjudication on one record wins", () => {
  const root = repoWithRecord();
  const second = { ...VERDICT, verdict: "continue", grant: 1, risk: "a real one" };
  const file = transcript([
    agentCall("a1", ".agents/adjudications/80-1.json"),
    result("a1", JSON.stringify(VERDICT)),
    agentCall("a2", ".agents/adjudications/80-1.json"),
    result("a2", JSON.stringify(second)),
  ]);
  const out = recoverVerdict({ root, pr: 80, recordPath: ".agents/adjudications/80-1.json", transcript: file });
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, out.path), "utf8")).verdict.verdict, "continue");
});

test("an unfenced answer parses too", () => {
  assert.equal(parseVerdict(JSON.stringify(VERDICT)).verdict, "ship-with-gaps-recorded");
  assert.equal(parseVerdict(`\`\`\`\n${JSON.stringify(VERDICT)}\n\`\`\``).verdict, "ship-with-gaps-recorded");
});

// --- plumbing --------------------------------------------------------------

test("no transcript directory is its own diagnosis, distinct from no matching call", () => {
  assert.throws(() => findTranscript("/tmp/nowhere-at-all", { home: "/tmp/no-home-here" }), /no harness transcript directory/);
});

test("the project slug matches the harness's own directory naming", () => {
  assert.equal(projectSlug("/home/user/AI-Handbook"), "-home-user-AI-Handbook");
});

test("the newest transcript in the project directory is this session's", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "home-"));
  const root = "/srv/thing";
  const dir = path.join(home, ".claude", "projects", projectSlug(root));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "old.jsonl"), "");
  fs.writeFileSync(path.join(dir, "new.jsonl"), "");
  fs.utimesSync(path.join(dir, "old.jsonl"), new Date(1), new Date(1));
  assert.equal(path.basename(findTranscript(root, { home })), "new.jsonl");
});

test("result text is joined whatever shape the harness used", () => {
  assert.equal(resultText({ content: "plain" }), "plain");
  assert.equal(resultText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }), "ab");
  assert.equal(resultText({ content: 7 }), null);
});

test("a spill notice is recognised only in the harness's own shape", () => {
  assert.equal(spilledPath("<persisted-output>\nFull output saved to: /x/y.txt\n"), "/x/y.txt");
  assert.equal(spilledPath("a line mentioning Full output saved to: /x/y.txt"), null);
});

test("verdict paths are derived from the record's own name", () => {
  assert.equal(verdictPathFor(".agents/adjudications/80-1.json"), ".agents/adjudications/80-1.verdict.json");
});

test("the capture path carries the page only when there is one", () => {
  assert.equal(capturePath(80, "reviews", 1), ".agents/captures/pr-80-reviews.json");
  assert.equal(capturePath(80, "reviews", 2), ".agents/captures/pr-80-reviews-p2.json");
});

test("an unknown collection names the ones that exist", () => {
  assert.throws(() => selectCall([], { collection: "nope", pr: 1 }), /unknown collection[\s\S]*reviewThreads/);
});

test("the command line takes flags only, and says what each mode needs", () => {
  assert.deepEqual(parseArgs(["--pr", "80", "--collection", "reviews"]).collection, "reviews");
  assert.equal(parseArgs(["--pr", "80", "--verdict", "--record", "r.json"]).verdict, true);
  assert.throws(() => parseArgs(["--pr", "80"]), /--collection is required/);
  assert.throws(() => parseArgs(["--pr", "80", "--verdict"]), /--verdict needs --record/);
  assert.throws(() => parseArgs(["--collection", "reviews"]), /--pr is required/);
  assert.throws(() => parseArgs(["--pr", "80", "--out", "x"]), /unknown argument/);
  assert.throws(() => parseArgs(["some text"]), /unknown argument/);
});

// --- #79 round 1 -----------------------------------------------------------

test("a foreign repository's call for the same PR number never wins", () => {
  // Every repository has an #80. A foreign EMPTY collection carries no urls
  // for the downstream provenance checks to reject, so it would assemble as a
  // complete empty collection for THIS repository and undercount the loop.
  const ours = '[{"id":1}]';
  const file = transcript([
    prCall("t1", "get_reviews", { perPage: 100 }),
    result("t1", ours),
    use("t2", "mcp__github__pull_request_read", {
      method: "get_reviews",
      owner: "someone",
      repo: "other",
      pullNumber: 80,
      perPage: 100,
    }),
    result("t2", "[]"),
  ]);
  const root = repo();

  const out = recoverCapture({ root, pr: 80, collection: "reviews", transcript: file, repo: REPO });

  assert.equal(fs.readFileSync(path.join(root, out.path), "utf8"), ours, "the later foreign call did not displace ours");
});

test("the conformance check refuses every shape the contract calls malformed", () => {
  // The adjudicator's definition already said coverage is total and that a
  // missing, extra or duplicated threadId is refused. Recovery accepted any
  // object with a string `verdict`, so the contract asserted a refusal that
  // did not exist -- the defect attempt 1 was withdrawn for, one level up.
  const record = { findings: { items: [{ threadId: "A" }, { threadId: "B" }] } };
  const entry = (threadId, cls = "in-scope") => ({ threadId, class: cls, citation: "", why: "w" });

  assertConformance({ verdict: "stop", conformance: [entry("A"), entry("B")] }, record);

  for (const [bad, re] of [
    [{ verdict: "stop" }, /carries no `conformance` array/],
    [{ verdict: "stop", conformance: [entry("A")] }, /omits 1 finding/],
    [{ verdict: "stop", conformance: [entry("A"), entry("B"), entry("C")] }, /names 1 thread\(s\) the record does not carry/],
    [{ verdict: "stop", conformance: [entry("A"), entry("B"), entry("A")] }, /names A more than once/],
    [{ verdict: "stop", conformance: [entry("A", "invented"), entry("B")] }, /which is not one of/],
    [{ verdict: "stop", conformance: [{ class: "in-scope" }] }, /carries no `threadId`/],
  ]) {
    assert.throws(() => assertConformance(bad, record), re);
  }
});

test("a record with no findings block still requires the array, and checks no coverage", () => {
  // A plan loop returns an empty conformance by contract; there is no code-loop
  // findings list to cover.
  assertConformance({ verdict: "stop", conformance: [] }, { pr: 80 });
  assert.throws(() => assertConformance({ verdict: "stop" }, { pr: 80 }), /carries no `conformance` array/);
});

test("a malformed verdict is refused before any file is written", () => {
  const root = repoWithRecord();
  const file = transcript([
    agentCall("a1", ".agents/adjudications/80-1.json"),
    result("a1", JSON.stringify({ ...VERDICT, conformance: [{ threadId: "T1", class: "in-scope" }] })),
  ]);
  assert.throws(() => recoverVerdict({ root, pr: 80, recordPath: ".agents/adjudications/80-1.json", transcript: file }), /omits 1 finding/);
  assert.equal(fs.existsSync(path.join(root, ".agents/adjudications/80-1.verdict.json")), false, "nothing was written");
});

#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * The mechanical record a review loop hands to its fresh-context adjudicator.
 *
 * WHY A SCRIPT AND NOT A SUMMARY
 * ------------------------------
 * The whole point of the tier-1 tripwire is that the loop's own account of
 * itself is the thing that failed. A loop that has run 12 rounds narrates
 * those rounds as 12 locally-reasonable decisions, because that is exactly
 * what they were -- so a summary written from inside the loop hands the
 * adjudicator the same frame that produced the problem, and the adjudication
 * becomes a second opinion on a conclusion it was already given.
 *
 * So the adjudicator is fed COUNTED numbers only. This repo has measured that
 * distinction: recalled numbers have been wrong 3 times out of 3, counted ones
 * right 3 out of 3 (see the loop-ledger contract in working-modes.md). Every
 * field below is derived from GitHub's own records or from git, and the
 * counting logic is `review-counting.mjs`'s -- the same functions the budget guard uses,
 * already hardened against the round-counting mistakes that cost that file
 * four rounds of review to find.
 *
 * WHAT IT CANNOT DERIVE, SAID OUT LOUD
 * ------------------------------------
 * The bucket rubric in working-modes.md sorts findings on two axes: CAUSE
 * (new ground / propagation / wrong-fix / re-raised) and TERRITORY (inside
 * this loop's diff, or outside it).
 *
 *   - TERRITORY is mechanical, and is derived here: a finding's file path
 *     against the PR's own changed-file list.
 *   - CAUSE is not. "Re-raised" and "wrong-fix" are prose conventions with no
 *     machine-readable marker, and `review-counting.mjs` refuses to regex them
 *     for exactly that reason -- a regex over prose is a guess wearing the
 *     costume of a measurement. So this record reports cause as null and says
 *     why, rather than shipping a fabricated classification to the one reader
 *     who is supposed to be immune to the loop's own storytelling.
 *
 * TRANSPORT
 * ---------
 * `--mcp-snapshot` only. No bash transport in this container reaches the
 * GitHub API: `curl` gets a 403 from the agent proxy, Node `fetch` gets a 401
 * with the git-scoped GITHUB_TOKEN (measured 2026-08-16, see
 * .agents/memory/github-rest-api-blocked-from-bash.md). The session assembles
 * the snapshot through the MCP tools and passes the file, exactly as
 * `review-counting.mjs`'s snapshot adapter already requires -- and inherits that
 * file's completeness assertions, which refuse a snapshot that was not
 * paginated to the end.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  fromMcp,
  reviewerPasses,
  findingsByRound,
  countFindings,
  artifactSize,
  REVIEWER_LOGINS,
  normalizeLogin,
  MAX_SNAPSHOT_AGE_MS,
  capturedAtDetail,
  capturedAtOf,
  collectionsReadBefore,
  headRepoOf,
} from "./review-counting.mjs";
import {
  loadLoop,
  allowance,
  countRounds,
  tierCap,
  nodeIo,
  REPO_ROOT,
  TIERS,
} from "./review-budget.mjs";

export const ADJUDICATIONS_DIR = ".agents/adjudications";

// ---------------------------------------------------------------------------
// Behavioral vs. prose
// ---------------------------------------------------------------------------

/**
 * Three classes, because two would lie.
 *
 * A skill file, CLAUDE.md, or a `docs/ai-context/` contract is markdown that
 * CHANGES AGENT BEHAVIOUR -- calling it "prose" would let a loop keep
 * re-requesting review on a diff of pure contract edits while reporting
 * "prose-only, no behavioural change", which is the opposite of true in this
 * repo. And calling it "code" would hide the distinction the adjudicator
 * actually needs when the diff is documentation of a shipped mechanism.
 *
 * Anything unrecognised classifies as `code`. Unknown-is-behavioural is the
 * conservative direction for THIS question: it never lets a real change be
 * reported as inert, and its cost is only that a genuinely inert file may be
 * counted as behavioural, which errs toward the loop continuing rather than
 * toward a change being waved past unreviewed.
 */
export function classifyPath(file) {
  if (/^\.agents\/(metrics|receipts|adjudications)\//.test(file)) return "record";
  if (/^\.claude\//.test(file)) return "agent-contract";
  if (/^(CLAUDE|AGENTS)\.md$/.test(file)) return "agent-contract";
  if (/^docs\/(ai-context|engineering)\//.test(file)) return "agent-contract";
  if (/^\.agents\//.test(file)) return "agent-contract";
  // A plan under review IS the artifact of a [PLAN REVIEW] loop: revising it
  // changes what gets built, which is as behavioral as a plan gets. Classing
  // it "prose" made the adjudicator structurally unable to continue an
  // unresolved plan review -- proseOnly read as nothing-to-review on the very
  // file the loop exists to review. (Codex, #543 round 2.)
  if (/^docs\/plans\//.test(file)) return "plan";
  if (/\.(md|txt)$/.test(file)) return "prose";
  if (/^docs\//.test(file)) return "prose";
  return "code";
}

/** Which classes count as a behavioural change for the re-request rule. */
export const BEHAVIORAL_CLASSES = new Set(["code", "agent-contract", "plan"]);

// ---------------------------------------------------------------------------
// Git side: what changed since the last reviewed commit
// ---------------------------------------------------------------------------

function git(args, { cwd = REPO_ROOT } = {}) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/**
 * `git diff --numstat <since>..HEAD`, classified.
 *
 * Returns `{ resolved: false, reason }` rather than an empty diff when the
 * commit cannot be resolved. An unresolvable base and a genuinely empty diff
 * are opposite facts -- "nothing changed since the last review" is the single
 * strongest argument for stopping, so reporting it because a sha lookup failed
 * would be the most consequential possible false statement in this record.
 */
export const PATCH_CAP_CHARS = 60_000;

/**
 * The filename shapes this machinery GENERATES: the five the receipts README
 * documents, plus the adjudication records `nextRecordPath` writes.
 *
 * NOT `classifyPath(file) === "record"`, which is the obvious shortcut and is
 * wrong here. That function answers a different question -- is this file
 * behavioural -- and to answer it, it calls every path under these directories
 * a record. But the sync DELIVERS tracked scaffolding into them:
 * `.agents/receipts/README.md`, `.agents/receipts/.gitignore` and
 * `.agents/adjudications/README.md`. Excluding those would hide real contract
 * changes from the adjudicator and announce them as bookkeeping -- the same
 * blindness this filter exists to remove, aimed at a different target. The
 * receipts `.gitignore` is the sharpest case: it decides which receipts are
 * committed at all, and a PR changing it is exactly one the judge must see.
 * (Codex, #14 round 1.)
 *
 * A new record shape has to be added here -- and the maintenance story is that
 * it has to be added to that README and that `.gitignore` in the same change
 * anyway, so this list travels with them. `.agents/metrics/` is deliberately
 * absent: the loop ledger is a maintained document, not a per-run artifact.
 */
const GENERATED_RECORD_SHAPES = [
  /^\.agents\/receipts\/pr-\d+\.json$/,
  /^\.agents\/receipts\/loop-round-check-\d+\.json$/,
  /^\.agents\/receipts\/loop-round-check-\d+\.json(\..+)?\.claim$/,
  /^\.agents\/receipts\/loop-budget-\d+\.json$/,
  /^\.agents\/receipts\/loop-extension-\d+-\d+\.json$/,
  /^\.agents\/adjudications\/\d+-\d+\.json$/,
];

export const isGeneratedRecord = (file) => GENERATED_RECORD_SHAPES.some((re) => re.test(file));

/** How many excluded paths the notice names before it summarises the rest. */
const EXCLUSION_LIST_CAP = 12;

/**
 * The notice that goes above a filtered patch, naming what was withheld so the
 * adjudicator can audit the omission rather than take it on trust.
 */
function exclusionNote(records) {
  const shown = records.slice(0, EXCLUSION_LIST_CAP);
  const rest = records.length - shown.length;
  return (
    `[excluded ${records.length} generated record file${records.length === 1 ? "" : "s"} -- ` +
    `this machinery's own receipts and adjudication records, which are bookkeeping rather than ` +
    `the artifact under review: ${shown.join(", ")}${rest ? `, and ${rest} more` : ""}]\n`
  );
}

/**
 * The generated-record paths changed in `range`.
 *
 * `--no-renames` because rename detection reports only the DESTINATION of a
 * rename, which would leave the source to survive as a deletion hunk and
 * consume the cap by itself -- the very failure this filter exists to stop,
 * reintroduced by a default. Verified against real git. (Codex, #14 round 1.)
 *
 * `-z` because the paths become pathspecs below: git's default output quotes
 * anything with a space, quote or newline in it, and a quoted path excludes
 * nothing.
 */
function recordPathsIn(runGit, range) {
  return runGit(["diff", "--name-only", "--no-renames", "-z", range])
    .split("\0")
    .filter(Boolean)
    .filter(isGeneratedRecord);
}

/**
 * A capped, git-derived unified diff for `range`, or a stated reason it is
 * absent. Never silent: truncation, exclusion and failure all say so, because
 * the adjudicator is told to weigh missing evidence as uncertainty rather than
 * fill it by inference. (Codex, #553 rounds 2 and 4.)
 *
 * RECORDS ARE EXCLUDED BEFORE THE CAP IS APPLIED, and that ordering is the
 * whole fix. A diff is emitted in lexicographic path order, `.agents/` sorts
 * ahead of almost every implementation path, and a loop commits its own
 * receipts and adjudication records AS IT RUNS -- records which themselves
 * embed the previous record's patch, so they grow with every dispatch. Capping
 * first therefore retained this machinery's own bookkeeping and dropped the
 * code the round's findings were about, on exactly the long loops that reach
 * an adjudicator at all.
 *
 * Measured on PR #10 before this: a 242,289-character diff capped to 60,000
 * with `+++ b/.claude/settings.json` absent entirely. Two verdicts were
 * returned on that evidence and both had to be withdrawn -- one of them had
 * waved through a P1 that silently disarmed every guard. A truncation notice
 * did not save it: a fresh-context judge cannot know that the one file it
 * needed is the one that fell off the end. (Codex, #12.)
 *
 * Excluding regardless of size is deliberate. Records are not the artifact
 * under review at any length, and a rule that only applies over some threshold
 * is one nobody can reason about at the moment it matters.
 */
export function cappedDiff(runGit, range, { onTruncate = null } = {}) {
  try {
    const records = recordPathsIn(runGit, range);
    const raw = runGit([
      "diff",
      "--no-color",
      // THE SAME RENAME SETTING AS THE NUMSTAT SOURCE. `artifactFileList`
      // disables rename detection so both sides of a rename land in the set;
      // leaving it on here emitted the same rename as one zero-line rename
      // hunk while `artifact` reported two files and every line added and
      // removed. The judge weighs size and patch together, so the two must
      // describe the same thing. (Codex, #38 round 5.)
      "--no-renames",
      range,
      // Exclude-only pathspecs need no positive counterpart; git applies them
      // to the whole result set. Verified rather than assumed.
      ...(records.length ? ["--", ...records.map((file) => `:(exclude,literal)${file}`)] : []),
    ]);
    // Prepended, not appended: an exclusion notice that the cap could itself
    // truncate would be missing exactly when it matters most.
    //
    // It NAMES what it withheld. An earlier draft pointed at "the numstat
    // fields" instead, which was simply untrue -- `artifact` carries counts
    // (files/added/removed), not a list, and `sinceLastReview.files` covers a
    // different range and is empty exactly when the judge is dispatched. A
    // notice that tells a fresh-context reader to go look somewhere there is
    // nothing to find is worse than one that admits the gap, because it reads
    // as an assurance. (Codex, #14 round 1.)
    const note = records.length ? exclusionNote(records) : "";
    if (raw.length <= PATCH_CAP_CHARS) return note + raw;
    // THE CUT IS REPORTED, not just marked inside the text. This cap fires
    // before `applyCaps` assembles `truncation.fields`, so a patch cut here
    // used to leave `fields` empty on a record whose note promises that an
    // empty `fields` means nothing was withheld. The judge weighs its own
    // uncertainty from that summary; an assurance that is false exactly when
    // 60,000 characters of the artifact are missing is worse than no summary
    // at all. (Codex, #38 round 6.)
    onTruncate?.({ keptChars: PATCH_CAP_CHARS, fullChars: raw.length });
    return (
      note +
      raw.slice(0, PATCH_CAP_CHARS) +
      `\n[TRUNCATED at ${PATCH_CAP_CHARS} chars of ${raw.length} -- the full diff exceeds the record cap; ` +
      `weigh the truncation itself as uncertainty]`
    );
  } catch {
    return `[unavailable -- git diff ${range} failed; weigh the absence as uncertainty]`;
  }
}

/**
 * The diff of the artifact under review: `base...head`, the PR's own change.
 *
 * THIS, not `sinceLastReview.patch`, is the code the current round's findings
 * are about -- and under the write-gate rule it is the ONLY one that can be
 * (Codex, #553 round 4). The judge is now dispatched after a completed pass
 * on the current head, so `lastReviewedCommit === head` and the
 * since-last-review diff is empty by construction: exactly when the rubric
 * asks "is there a critical flaw here", the old field showed nothing.
 * Three-dot so a base-branch merge does not drag in changes reviewed on main.
 */
export function artifactDiff(base, head, { runGit = git, onTruncate = null } = {}) {
  if (!base || !head) {
    return "[unavailable -- the snapshot carries no base or head sha; weigh the absence as uncertainty]";
  }
  return cappedDiff(runGit, `${base}...${head}`, { onTruncate });
}

// ---------------------------------------------------------------------------
// The artifact's own file list -- ONE git-derived source for size, territory
// and patch
// ---------------------------------------------------------------------------

/**
 * Both endpoints of `base...head`, validated as resolvable commits BEFORE any
 * derivation runs.
 *
 * The snapshot never validated these. `assertAdjudicationSnapshot` checks the
 * PR number, the repository and the capture metadata; `changesSince` checks
 * the head only, for its own separate range; and `artifactDiff` deliberately
 * returns an "unavailable" marker rather than failing. That tolerance was
 * harmless while the file list came from the snapshot -- a missing endpoint
 * cost the patch and nothing else. It stops being harmless now the same range
 * is authoritative for SIZE and TERRITORY: an incidental git failure would
 * present as an artifact of zero files with every finding outside the diff,
 * which is #34 gap 2 wearing a different hat. (Codex, #37 round 2.)
 */
export function assertArtifactEndpoints(base, head, { runGit = git } = {}) {
  for (const [label, ref] of [
    ["pr.base.sha", base],
    ["pr.head.sha", head],
  ]) {
    if (typeof ref !== "string" || ref.trim() === "") {
      throw new Error(
        `the snapshot carries no ${label}, and the artifact's size, territory and patch are all derived ` +
          `from base...head -- without both endpoints there is nothing to derive them from`,
      );
    }
    // A FULL OBJECT ID, not any commit-ish. `git cat-file -e` resolves
    // `HEAD`, `main` and abbreviated shas alike (verified), so a snapshot
    // carrying a symbolic ref would pass this check and then derive the
    // artifact range -- and `dispatchDeclaration(head)` -- from whatever the
    // checkout currently points at, while the record stored the mutable
    // spelling as though it were pinned. The endpoints must name commits
    // GitHub reported, not names this container can resolve differently
    // tomorrow. (Codex, #38 round 4.)
    if (!/^[0-9a-f]{40}$/i.test(ref.trim())) {
      throw new Error(
        `${label} ${JSON.stringify(ref)} is not a full 40-character object id. The snapshot must carry the ` +
          `commit GitHub reported, not a name (HEAD, a branch) or an abbreviation this checkout could ` +
          `resolve to something else`,
      );
    }
    try {
      runGit(["cat-file", "-e", `${ref}^{commit}`]);
    } catch {
      throw new Error(
        `${label} ${ref} is not a resolvable commit in this clone (fetch the branch, then re-run) -- ` +
          `refusing rather than deriving an artifact from a range with an unresolvable end`,
      );
    }
  }
}

/**
 * The artifact's changed files, from git, over the same range as the patch.
 *
 * Flags, each load-bearing:
 *
 * - `-z` because a path containing a space, a quote or a non-ASCII byte is
 *   otherwise C-quoted, and a quoted path never equals the path GitHub reports
 *   on a finding -- so territory would silently classify it `outsideDiff`.
 * - `--no-renames` because rename detection reports only a rename's
 *   DESTINATION, leaving a finding anchored on the source outside the diff.
 *   Off, a rename appears as its add and its delete and BOTH paths are in the
 *   set. `recordPathsIn` already disables it, for the neighbouring reason.
 *
 * Binary files report `-` for both counts. They carry `added: null,
 * removed: null` and are counted separately, so a non-zero artifact can never
 * present as zero lines without saying why. A count that is neither numeric
 * nor `-` is a refusal, not a coerced zero: `?? 0` on an unparsed count is the
 * exact shape of the defect this whole change exists to remove.
 */
export function artifactFileList(base, head, { runGit = git } = {}) {
  const raw = runGit(["diff", "--numstat", "-z", "--no-renames", `${base}...${head}`]);
  const files = raw
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const parts = record.split("\t");
      if (parts.length < 3) {
        throw new Error(`git numstat produced an unparseable record: ${JSON.stringify(record)}`);
      }
      const [added, removed] = parts;
      // A path may itself contain a tab; everything after the two counts is it.
      const file = parts.slice(2).join("\t");
      const count = (raw_) => {
        if (raw_ === "-") return null;
        if (!/^\d+$/.test(raw_)) {
          throw new Error(
            `git numstat reported a non-numeric, non-binary count ${JSON.stringify(raw_)} for ${file} -- ` +
              `refusing rather than coercing it to zero`,
          );
        }
        return Number(raw_);
      };
      return { file, added: count(added), removed: count(removed), binary: added === "-" && removed === "-" };
    });
  if (files.length === 0 && base !== head) {
    // A consistently empty artifact IS reachable and legitimate: a branch whose
    // every change has been reverted. Both sources agree it is empty, so the
    // record says so with a marker rather than refusing -- refusing here would
    // block the tripwire and direct-stop flows that need a record to close the
    // loop at all, which is a wrongly-blocking failure on machinery whose whole
    // job is to unblock a decision. (Codex, #37 round 3.)
    return { files, emptyAgainstDistinctEndpoints: true };
  }
  return { files, emptyAgainstDistinctEndpoints: false };
}

/**
 * Size counts describe THE ARTIFACT UNDER REVIEW, so they apply the same
 * generated-record exclusion the patch applies. Territory does not: a finding
 * anchored on a receipt this PR changed is still inside this PR's diff, and
 * telling the judge otherwise is the very lie #34 gap 2 reported.
 */
export function artifactStats(files) {
  const artifact = files.filter((f) => !isGeneratedRecord(f.file));
  return {
    files: artifact.length,
    added: artifact.reduce((n, f) => n + (f.added ?? 0), 0),
    removed: artifact.reduce((n, f) => n + (f.removed ?? 0), 0),
    binaryFiles: artifact.filter((f) => f.binary).length,
    excludedGeneratedRecords: files.length - artifact.length,
    note:
      "files/added/removed EXCLUDE this machinery's own generated receipts and records (the same " +
      "exclusion the patch applies); binaryFiles counts files whose line counts git reports as `-`, " +
      "which carry null rather than zero. `territory` classifies against the FULL changed set, " +
      "including those records and both sides of a rename.",
  };
}

export function changesSince(since, head, { runGit = git } = {}) {
  if (!since) {
    return { resolved: false, reason: "no reviewed commit found in the snapshot (no completed reviewer pass yet)" };
  }
  // The PR's head, from the snapshot — never the working tree's `HEAD`. Run
  // from `main`, a stale branch, or any other checkout, a `..HEAD` diff
  // describes an unrelated branch while every GitHub-derived field describes
  // the requested PR, and `noChange`/`proseOnly` then drive the verdict off
  // the wrong code. (Codex, round 1.)
  if (!head) {
    return { resolved: false, reason: "snapshot carries no pr.head.sha, so the diff has no verifiable endpoint" };
  }
  for (const [label, ref] of [["reviewed commit", since], ["PR head", head]]) {
    try {
      runGit(["cat-file", "-e", `${ref}^{commit}`]);
    } catch {
      return { resolved: false, reason: `${label} ${ref} is not present in this clone (fetch the branch, then re-run)` };
    }
  }

  const numstat = runGit(["diff", "--numstat", `${since}..${head}`]);
  const files = numstat
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added, removed, file] = line.split("\t");
      return {
        file,
        class: classifyPath(file),
        added: added === "-" ? null : Number(added),
        removed: removed === "-" ? null : Number(removed),
      };
    });

  const behavioral = files.filter((f) => BEHAVIORAL_CLASSES.has(f.class));
  // Reports its cut the same way the artifact patch does (round 6): both
  // patches share one cap and one summary, and an empty `truncation.fields`
  // must mean neither was cut. (Codex, #38 round 12.)
  let patchTruncation = null;
  const patch = cappedDiff(runGit, `${since}..${head}`, {
    onTruncate: (cut) => {
      patchTruncation = cut;
    },
  });
  return {
    resolved: true,
    since,
    head,
    commits: Number(runGit(["rev-list", "--count", `${since}..${head}`])),
    files,
    patch,
    patchTruncation,
    behavioralFiles: behavioral.length,
    // The re-request rule's whole test, precomputed so the adjudicator does
    // not have to re-derive it from the file list.
    proseOnly: files.length > 0 && behavioral.length === 0,
    noChange: files.length === 0,
  };
}

// ---------------------------------------------------------------------------
// GitHub side
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reading payload at the reviewed commit, in either layout
// ---------------------------------------------------------------------------

/** The two payload files this record reads, by their CONSUMER path. */
export const ADJUDICATOR_DEFINITION = ".claude/agents/review-loop-adjudicator.md";
export const THREAT_MODEL_NOTE = ".agents/memory/machinery-threat-model-is-my-own-mistakes.md";

/**
 * A payload file's content at `sha`, resolved through both layouts this
 * machinery runs in.
 *
 * A bare `git show <sha>:<consumer path>` works in exactly one of them.
 * Measured in the handbook at `972b60d`:
 *
 *     git ls-tree HEAD .claude/agents/review-loop-adjudicator.md
 *     120000 blob 3ccda5b…    (a SYMLINK; its blob is the target path text)
 *     git ls-tree HEAD .agents/memory/…-mistakes.md
 *     (empty -- the tracked source is core/.agents/memory/…)
 *
 * In an assembled consumer both are ordinary files and no `core/` exists. So
 * the resolver reads the tree entry's MODE, follows a `120000` target relative
 * to the link's own directory, and retries once under `core/` when the
 * consumer path is absent entirely. A target escaping the repository, a link
 * chain deeper than one, or a path resolving in neither layout is a refusal
 * naming both attempts -- never a silently empty field. (Codex, #37 round 2.)
 */
export function readAtCommit(sha, consumerPath, { runGit = git } = {}) {
  const attempts = [consumerPath, `core/${consumerPath}`];
  const tried = [];
  for (const candidate of attempts) {
    let entry;
    try {
      entry = runGit(["ls-tree", "-z", sha, "--", candidate]);
    } catch {
      entry = "";
    }
    if (!entry) {
      tried.push(`${candidate} (absent at ${sha})`);
      continue;
    }
    const mode = entry.slice(0, 6);
    const read = (target) => runGit(["show", `${sha}:${target}`]);
    if (mode !== "120000") return { path: candidate, text: read(candidate), followedLink: null };

    const target = read(candidate).trim();
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(candidate), target));
    if (resolved.startsWith("../") || path.posix.isAbsolute(resolved)) {
      throw new Error(
        `${candidate} at ${sha} is a symlink to ${target}, which escapes the repository -- refusing to follow it`,
      );
    }
    let inner;
    try {
      inner = runGit(["ls-tree", "-z", sha, "--", resolved]);
    } catch {
      inner = "";
    }
    if (!inner) {
      throw new Error(`${candidate} at ${sha} is a symlink to ${resolved}, which is not present at that commit`);
    }
    if (inner.slice(0, 6) === "120000") {
      // One hop only. A chain is a repository mistake, and following it would
      // make this resolver the thing that has to reason about cycles.
      throw new Error(`${candidate} at ${sha} is a symlink to another symlink (${resolved}) -- refusing to follow a chain`);
    }
    return { path: resolved, text: read(resolved), followedLink: candidate };
  }
  throw new Error(
    `cannot read ${consumerPath} at ${sha} in either payload layout -- tried ${tried.join("; ")}. ` +
      `The record reads payload at the REVIEWED COMMIT, never from the working tree, so this is a refusal ` +
      `rather than a field the judge would have to guess about`,
  );
}

/** The `key: value` pairs of a markdown file's leading `---` frontmatter. */
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text ?? "");
  if (!match) return null;
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * What the dispatch DECLARES: the judge's model and reasoning effort, read
 * mechanically from its own definition at the reviewed commit.
 *
 * Not from configuration, not from the working tree, and above all not from
 * anything the dispatching session types. A receipt's `modelRequested` /
 * `effortRequested` are checked against THIS, so a typed, stale or invented
 * value is rejected without consulting anything mutable.
 *
 * What this does NOT establish, stated here because the plan is asked to say
 * so rather than imply otherwise: what the harness actually SERVED. The Agent
 * tool result carries no model id and `get_session` describes the main
 * session, not a subagent. Two gaps live here, both known: declared-vs-served,
 * and declared-at-head vs. loaded-from-the-active-checkout (Codex, #37 round
 * 3) -- the harness loads the definition from the checkout it is running in,
 * which a stale-checkout generator run can differ from.
 */
export function dispatchDeclaration(sha, { runGit = git } = {}) {
  const { path: resolvedPath, text, followedLink } = readAtCommit(sha, ADJUDICATOR_DEFINITION, { runGit });
  const front = parseFrontmatter(text);
  if (!front?.model) {
    throw new Error(
      `${resolvedPath} at ${sha} declares no \`model\` in its frontmatter -- the record cannot stamp a ` +
        `declaration that does not exist`,
    );
  }
  return {
    model: front.model,
    effort: front.effort ?? null,
    source: followedLink ? `${followedLink} -> ${resolvedPath}` : resolvedPath,
    sha,
    note:
      "What the dispatch DECLARES, read from the agent definition at the reviewed commit. A verdict " +
      "receipt's modelRequested/effortRequested are validated against these values. This does NOT " +
      "establish what the harness served, nor that the checkout the dispatch ran from carried this same " +
      "definition -- both are stated gaps, not claims.",
  };
}

/**
 * The tier's decline citation: the text an internal-tier judge is entitled to
 * decline against, read at the reviewed head rather than from the working
 * tree -- because the generator deliberately supports running from `main`, and
 * a PR that edits the threat model would otherwise hand the judge the base
 * branch's version of the very note under review.
 */
export function declineCitationFor(tier, sha, { runGit = git } = {}) {
  if (tier !== "internal") {
    return { text: null, path: null, reason: `no tier citation in phase 1a for tier "${tier}"` };
  }
  let resolved;
  try {
    resolved = readAtCommit(sha, THREAT_MODEL_NOTE, { runGit });
  } catch (e) {
    // A STATED NULL, not a refusal. This note is delivered by the `memory`
    // sync group and the machinery does not require it: requiring it would
    // pull `contracts`, `planning` and `skills` into machinery's dependency
    // closure through memory's own requires, coupling a consumer that wants
    // the review machinery to most of the handbook. So a repository without
    // the note still adjudicates -- the judge simply sees that the citation
    // is unavailable and why, which is the record's standing discipline for
    // a fact it cannot establish.
    return {
      text: null,
      path: null,
      sha,
      reason: `unavailable at ${sha}: ${e.message}`,
      note: "The internal tier's decline citation could not be read here; weigh its absence rather than assuming its content.",
    };
  }
  return {
    text: resolved.text,
    path: resolved.path,
    sha,
    reason: null,
    note: "The internal tier's threat model, at the reviewed commit -- the basis an internal-tier decline cites.",
  };
}

// ---------------------------------------------------------------------------
// The approved plan's oracle
// ---------------------------------------------------------------------------

/** The four sections that ARE the reviewer's oracle, per the PR-body contract. */
const ORACLE_SECTIONS = ["Direction", "Product Intent", "Must Not Change", "Settled Decisions"];

/**
 * A markdown section's body, matched on its heading text, case-insensitively.
 *
 * A line scanner rather than one regex. The regex form is where this goes
 * wrong quietly: JavaScript has no `\\Z`, so an end-of-input alternation
 * written that way degrades to the literal letter Z and every section silently
 * ends at the first Z in the document. Scanning lines has no such trap and
 * says what it does.
 */
/**
 * Which lines sit inside a fenced code block. A fence opens on ``` or ~~~ with
 * any info string and closes on a fence of the SAME character at least as
 * long, per CommonMark -- so a ```` ```` ```` block containing ``` does not
 * close early. The fence lines themselves count as inside: neither is a
 * heading, and treating them as outside would let ```` ```## X ```` slip past.
 */
function fenceMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let open = null; // { char, len }
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!open) {
      // An opening fence's info string may not contain a backtick.
      if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
        open = { char: m[1][0], len: m[1].length };
        mask[i] = true;
      }
      continue;
    }
    mask[i] = true;
    if (m && m[1][0] === open.char && m[1].length >= open.len && m[2].trim() === "") open = null;
  }
  return mask;
}

/**
 * The LIVE text of a markdown document: fenced blocks, indented code blocks
 * and blockquotes removed. A declaration scan should see only what the
 * author asserts, never what the author quotes or shows.
 *
 * Fences were masked in rounds 8-10 and the two other literal contexts were
 * not: a four-space-indented Tier C template was accepted as this PR's
 * oracle, and a blockquoted provenance line resolved an unrelated commit.
 * Same defect, two more contexts. An indented line inside a list item is
 * list content, not code, so indentation counts only when the previous live
 * line is blank or absent -- the CommonMark rule for where an indented code
 * block can start. (Codex, #38 round 11.)
 */
function outsideFences(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const fenced = fenceMask(lines);
  const live = [];
  let prevBlank = true;
  for (let i = 0; i < lines.length; i += 1) {
    if (fenced[i]) continue;
    const line = lines[i];
    if (/^\s*>/.test(line)) continue;
    if (prevBlank && /^(?: {4,}|\t)\S/.test(line)) continue;
    live.push(line);
    prevBlank = line.trim() === "";
  }
  return live.join("\n");
}

export function sectionOf(markdown, heading) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  const want = new RegExp(`^(#{1,6})\\s+${escaped}\\s*$`, "i");
  // A `##` INSIDE A FENCE IS NOT A HEADING. Plans and PR bodies quote oracle
  // blocks in fenced examples -- `bugfix/SKILL.md` shows two of them, and this
  // very PR's plan quotes the sections it specifies -- so a scanner blind to
  // fences takes the EXAMPLE as the section and omits the real invariants
  // below it. Same consequence as round 1's nested-heading bug: a verdict
  // against an oracle that looks complete and is not. Tracked for both the
  // start and the end scan, since a fence can open inside a section too.
  // (Codex, #38 round 7.)
  const fenced = fenceMask(lines);
  const start = lines.findIndex((l, i) => !fenced[i] && want.test(l));
  if (start === -1) return null;
  // A markdown section ends at a heading of the SAME OR HIGHER level. Stopping
  // at ANY heading drops a nested one and everything under it -- so an oracle
  // section carrying a `### Security` subsection would reach the judge with
  // its security constraints silently missing, which is the worst possible
  // way for this field to be wrong. (Codex, #38 round 1.)
  const level = want.exec(lines[start])[1].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const heading = fenced[i] ? null : /^(#{1,6})\s+\S/.exec(lines[i]);
    if (heading && heading[1].length <= level) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}

/**
 * A `[PLAN REVIEW]` PR requires BOTH of the repository's defining signals --
 * the title and the body declaration -- and refuses when they disagree.
 *
 * The body alone was the round-2 design and round 3 found the hole: a PR that
 * keeps the boilerplate while dropping the title would route past the
 * approved-plan-source check entirely and take a mutable head plan as its
 * oracle. Both signals are in the snapshot already, so requiring both costs
 * nothing. (Codex, #37 round 3.)
 */
export function planReviewSignals(pr) {
  const title = typeof pr?.title === "string" && /^\[PLAN REVIEW\]/i.test(pr.title.trim());
  // THE SAME FENCE-AWARE SCAN `sectionOf` USES. A body-wide regex took a
  // fenced `## Review mode` example -- which a process PR documenting the
  // template legitimately shows -- as the declaration, and with an ordinary
  // title the generator then refused the PR as half-declared: a deadlock on a
  // documentation PR. (Codex, #38 round 8.)
  const section = typeof pr?.body === "string" ? sectionOf(pr.body, "Review mode") : null;
  const body = typeof section === "string" && /plan review only/i.test(section.slice(0, 400));
  return { title, body, isPlanReview: title && body, disagree: title !== body };
}

/**
 * The bugfix oracle's fields, transcribed from the schemas an author is
 * actually told to write: `core/.claude/skills/bugfix/SKILL.md:251-258`
 * (Tier A/B) and `:264-271` (Tier C).
 *
 * LINE-CITED ON PURPOSE. A matcher written from memory of a format, rather
 * than from the format, is the single most common defect in this file -- six
 * of this loop's findings were that one mistake wearing different hats. The
 * citation is what lets the next reader check the matcher against the
 * document instead of against my recollection of it.
 */
const F = (label, pattern = null) => ({
  label,
  pattern: pattern ?? label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
});
const BUGFIX_ORACLE_FIELDS = {
  A: [
    F("Fix tier"),
    F("Reported symptom"),
    F("Intended correct behavior"),
    F("Must not change"),
    F("Root cause"),
    F("Blast radius"),
  ],
  C: [
    F("Fix tier"),
    F("Reported symptom"),
    F("Root cause"),
    F("Why this is trivial"),
    // Either apostrophe: the schema uses the typewriter form, and a body
    // written in an editor that smart-quotes would otherwise fail a field it
    // in fact carries.
    F("David's go-ahead", "David['’]s go-ahead"),
    F("Migration ceremony checklist"),
  ],
};
BUGFIX_ORACLE_FIELDS.B = BUGFIX_ORACLE_FIELDS.A;

/** The tier letter, from the `**Fix tier:**` line the schemas open with. */
// Tolerates `**Fix tier:** **B** —` (the letter itself emphasised) and a
// period in place of the colon: both appear in the first real bugfix body the
// execution bar was run against (Overhypeme #611), and neither is a field.
const FIX_TIER_RE = /^\s*\*{0,2}Fix tier[:.]?\*{0,2}\s*["'`*]{0,3}([A-Za-z])\b/im;

/** A labelled field carrying SOMETHING -- the label alone is not the field. */
const fieldPresent = (body, field) =>
  new RegExp(`^\\s*\\*{0,2}${field.pattern}[:.]?\\*{0,2}\\s*\\S`, "im").test(body);

/**
 * The permitted no-plan forms, each a POSITIVE match rather than an absence.
 *
 * The bugfix forms match the block `bugfix/SKILL.md` actually tells an author
 * to write -- `**Fix tier:**` with its companion fields, or the Tier C schema
 * block -- NOT an "Approved-plan source: n/a — bugfix" line, which no bugfix
 * PR carries. Matching the imagined shape instead of the documented one made
 * every bugfix loop refuse record generation at its mandatory round-3
 * adjudication: the loop could then neither write the next fix nor close on a
 * verdict. Same deadlock the plan-review mode was added for, one PR shape
 * over. (Codex, #38 round 1.)
 *
 * THE WHOLE TIER-SPECIFIC BLOCK, not its opening line. Accepting a bare
 * `**Fix tier:** C`, or a Tier A/B line with only one of its five companion
 * fields -- or an invented tier `Z` -- handed the mandatory adjudication a
 * `planOracle.sections: null` for a malformed oracle and called it permitted.
 * Nothing else validates this block, so the judge would have ruled on a round
 * whose stated oracle was a fragment, with no signal that it was one. A
 * malformed oracle now REFUSES, naming the missing fields, because "the
 * author wrote part of the contract" is a finding, not a licence.
 * (Codex, #38 round 6.)
 *
 * STATED GAP: this checks that each field is present and carries text. It
 * does not judge whether that text is real -- an author who pastes the
 * schema and fills every field with a word passes. The record's discipline is
 * to refuse what it can see is absent, not to grade prose.
 */
const TEXTUAL_NO_PLAN_FORMS = [
  { reason: "trivial change", re: /^\s*(?:\*{0,2}Approved-plan source:?\*{0,2}\s*)?n\/a\s*[-—–]\s*no plan/im },
  {
    // The private path's WHOLE provenance, not the word `shasum`. These three
    // fields are the only independently inspectable evidence a private plan
    // has -- the plan file itself is off the public channel by construction --
    // so accepting "Approved-plan source: shasum" would treat a placeholder as
    // proof of an approved plan, in exactly the field whose absence is
    // otherwise a refusal. (Codex, #38 round 4.)
    // `claude-core.md:453-457`: "the filename plus a `shasum -a 256` and the
    // date". SHA-256 is 64 hex characters, so `-a 256` and a 64-char digest
    // are both required -- accepting `shasum` with a 16-char digest let a
    // placeholder stand for the one field the private path can be checked on.
    // The form documents no "approved" statement; the date IS the approval
    // date, so none is demanded. (Codex, #38 round 8.)
    reason: "private path",
    re: /^[^\n]*?[\w.-]+\.md[^\n]*?\bshasum\s+-a\s+256\b[^\n]*?\b[0-9a-f]{64}\b[^\n]*?\d{4}-\d{2}-\d{2}/im,
  },
];

/**
 * Which permitted no-plan form this body carries, or a refusal naming why the
 * bugfix block it started to write is not one. Returns `null` when the body
 * claims no no-plan form at all.
 */
export function permittedNoPlanForm(rawBody) {
  // OUTSIDE FENCES ONLY. A documentation PR that shows a complete Tier C
  // template inside a fenced example was accepted as a bugfix oracle, which at
  // adjudication replaced the missing-source refusal with a stated null --
  // the judge lost the oracle and was told nothing was wrong. Third heading
  // scanner made fence-aware in three rounds; the pattern is in #40 §2.6.
  // (Codex, #38 round 9.)
  const body = outsideFences(rawBody);
  const tier = FIX_TIER_RE.exec(body)?.[1]?.toUpperCase();
  if (tier) {
    const fields = BUGFIX_ORACLE_FIELDS[tier];
    if (!fields) {
      return {
        refuse:
          `the PR body declares \`Fix tier: ${tier}\`, which is not a tier the bugfix contract defines ` +
          `(A, B or C). An unrecognised tier is a malformed oracle, not a permitted no-plan form`,
      };
    }
    const missing = fields.filter((field) => !fieldPresent(body, field));
    if (missing.length) {
      return {
        refuse:
          `the PR body declares Tier ${tier} but its bugfix oracle is missing ` +
          `${missing.map((f) => `\`${f.label}\``).join(", ")}. The tier-${tier} schema ` +
          `(core/.claude/skills/bugfix/SKILL.md) requires ${fields.map((f) => f.label).join(", ")}, and the ` +
          `mandatory adjudication reads this block as the round's oracle -- so an incomplete one is refused ` +
          `rather than passed to the judge as \`sections: null\``,
      };
    }
    return { reason: `bugfix oracle (tier ${tier})` };
  }
  // Scoped to the declared source region for the same reason the provenance
  // matchers are: "n/a — no plan" is a claim about THIS PR's oracle only when
  // it is written where the oracle goes. Body-wide, a sentence describing the
  // form would be read as the form.
  const source = approvedPlanSourceText(body);
  const form = TEXTUAL_NO_PLAN_FORMS.find((f) => f.re.test(source));
  return form ? { reason: form.reason } : null;
}

/**
 * The approved-plan commit, read ONLY from an `Approved-plan source` line.
 *
 * An unanchored search for "final plan commit <sha>" matches the phrase
 * anywhere in the body -- a quoted comment, a changelog entry, a sentence
 * about some other PR -- and would then present that commit's plan to the
 * judge as this PR's approved oracle. The contract puts the provenance on its
 * own line for exactly this reason. (Codex, #38 round 1.)
 */
/**
 * The public path's WHOLE provenance, in the shape the contract specifies:
 * `Plan-review PR #<N>, final plan commit <sha>, approved by David on <date>`.
 *
 * Requiring only the sha accepted a line naming no plan-review PR and no
 * approval date, so any resolvable commit could be presented to the judge as
 * approved. The sha is what makes the ORACLE trustworthy -- the plan text
 * comes from that commit -- but the PR number and the date are what make the
 * APPROVAL checkable by a person, and this record's job is to refuse a claim
 * it cannot see the evidence for. My round-1 reply argued the opposite and
 * was wrong on the bar: unverifiable-by-machine is not the same as
 * not-worth-requiring. (Codex, #38 round 5.)
 */
/**
 * TWO forms, because the contract specifies two, not one with interchangeable
 * adjectives (`claude-core.md:453-457`):
 *
 *   `Plan-review PR #<N>, final plan commit <sha>, approved by David on <date>`
 *   the split-loop form naming EVERY subsystem PR plus
 *   `combined plan commit <sha> on plan-review/<slug>-combined`
 *
 * Treating them as one regex with `(?:final|combined)` looked equivalent and
 * was not: the split form names its PRs in the PLURAL -- `Plan-review PRs #701
 * and #702` -- which `\bPR\s*#` cannot match, so every split loop reported no
 * approved-plan source and could not run its mandatory adjudication. The
 * combined form also requires its `-combined` branch, which is the field that
 * makes it checkable at all: that branch is the one this repository never
 * deletes, precisely because no PR retains its commit.
 * (Codex, #38 round 7 -- the seventh matcher written from a remembered format.)
 */
const PLAN_COMMIT_FORMS = [
  {
    // `approved by David on <date>` -- the approver is named in the contract's
    // form, and only his approval authorises a plan. `approved by Alice on`
    // matched the old `\bapproved\b`. (Codex, #38 round 9.)
    reason: "single plan-review PR",
    // `Plan-review PR #<N>` -- the prefix is part of the form, and it is what
    // distinguishes the plan-review PR (the approval's home) from any other
    // PR number a body might mention. `Implementation PR #12, final plan
    // commit …` matched without it. (Codex, #38 round 11.)
    re: /^[^\n]*?\bPlan-review PR\s*#\d+[^\n]*?\bfinal plan commit\s+["'`]?([0-9a-f]{7,40})(?![0-9a-f])["'`]?[^\n]*?\bapproved by David on\s+\d{4}-\d{2}-\d{2}/im,
  },
  {
    // "naming EVERY subsystem PR" -- a split loop has at least two, so the
    // plural with one number is an incomplete provenance, not a variant.
    // (Codex, #38 round 8.)
    reason: "split loop (combined plan)",
    re: /^[^\n]*?\bPlan-review PRs\s*#\d+[^\n]*?#\d+[^\n]*?\bcombined plan commit\s+["'`]?([0-9a-f]{7,40})(?![0-9a-f])["'`]?[^\n]*?\bon\s+["'`]?plan-review\/[A-Za-z0-9._-]+-combined["'`]?[^\n]*?\bapproved by David on\s+\d{4}-\d{2}-\d{2}/im,
  },
];

/**
 * The approved-plan commit, in whichever documented form the body carries.
 * The sha is bounded on its right: `{7,40}` alone captured the first 40 of a
 * 41-character token and let the rest fall into the following `[^\n]*?`, so
 * a malformed digest resolved as its prefix. (Codex, #38 round 12.)
 */
export function approvedPlanCommit(sourceText) {
  for (const form of PLAN_COMMIT_FORMS) {
    const sha = form.re.exec(sourceText)?.[1];
    if (sha) return { sha, form: form.reason };
  }
  return null;
}
/**
 * An explicit plan path, read ONLY from the provenance line -- the same
 * anchoring the commit sha gets, and for the same reason. A body-wide match
 * takes the first `docs/plans/PLAN_*.md` anywhere: a quoted Product Intent, a
 * reference to the NEXT phase's plan, a link in a comment. If that file
 * happens to exist at the cited commit the record presents the wrong plan as
 * the approved oracle; if it does not, the mandatory adjudication dies inside
 * `git show`. (Codex, #38 round 2.)
 *
 * Both this and PLAN_COMMIT_RE tolerate the sha or path being wrapped in
 * backticks or quotes, because that is how they are actually written. This
 * repository's own PR #38 carries "final plan commit `972b60d`", and the first
 * record generated for it REFUSED -- a matcher that rejects the house style of
 * the repository it ships in is the same defect as one written from memory,
 * found by running it rather than by reading it. (#39 gap 2.)
 */
const PLAN_PATH_LINE_RE = /^[^\n]*?["'`]?(docs\/plans\/PLAN_[A-Za-z0-9_.-]+\.md)["'`]?/im;

/**
 * The region of the body that DECLARES plan provenance -- what the anchoring
 * above is anchored TO. Two shapes are in live use and the contract endorses
 * neither over the other: an `## Approved-plan source` HEADING with the
 * provenance beneath it (what this repository's own PRs write, #38 included)
 * and an inline `**Approved-plan source:** …` LABEL.
 *
 * The matchers used to require the label and the provenance ON ONE LINE. That
 * shape was written from the contract's prose sentence, not from a PR --
 * `code-review.md` and CLAUDE.md both specify the CONTENT of the field and
 * say nothing about its typography -- so the heading form, which is the one
 * actually written, matched nothing. Its consequence is the whole reason the
 * anchoring exists in reverse: record generation refused every PR whose body
 * used a heading, which is to say the mandatory adjudication could not run on
 * the PR shipping this file. Found by running the generator against #38's own
 * body rather than against a body I wrote. (Round 6; the same
 * matcher-from-memory defect as rounds 1, 2, 4 and 5.)
 *
 * Scoping is what keeps round 1's property: the provenance is still read ONLY
 * from the region the author declared as the source, never from arbitrary
 * prose elsewhere in the body.
 */
export function approvedPlanSourceText(body) {
  const text = typeof body === "string" ? body : "";
  // LIVE TEXT ON BOTH PATHS. The fallback got the literal-context mask in
  // round 10; the section path returned the raw section, so a blockquoted or
  // indented sample under a live `## Approved-plan source` heading resolved
  // the sample's commit. Same function, second path, same mask.
  // (Codex, #38 round 12.)
  const section = sectionOf(text, "Approved-plan source");
  if (section) return outsideFences(section);
  // OUTSIDE FENCES, like every other scan. The section path was fence-aware
  // through `sectionOf`; this fallback read the raw text, so a documentation
  // PR showing a complete provenance line inside a fenced example resolved
  // that example's commit as this PR's approved oracle -- an unrelated plan
  // presented to the judge as approved. Fourth scanner, same fix.
  // (Codex, #38 round 10.)
  const labelled = outsideFences(text)
    .split(/\r?\n/)
    .filter((line) => /Approved-plan source/i.test(line));
  return labelled.join("\n");
}

/**
 * The approved plan's four oracle sections, read at the commit the PR body
 * names -- or, on a plan-review loop, at the reviewed head, because a plan
 * under review has no approved commit by definition.
 *
 * Absence is a REFUSAL, not a null. The contract treats a missing
 * approved-plan source as a finding in its own right, so a record that
 * proceeded quietly without the oracle would hide exactly the defect the
 * conformance rubric exists to catch. `null` is produced only on a positive
 * match against one of the permitted no-plan forms, with its reason stated.
 */
export function planOracleFor(pr, headSha, { runGit = git, base = null } = {}) {
  const body = typeof pr?.body === "string" ? pr.body : "";
  const signals = planReviewSignals(pr);
  if (signals.disagree) {
    throw new Error(
      `this PR declares plan review in ${signals.title ? "its title" : "its body"} but not the other -- ` +
        `the repository defines the mode by both, and a half-declared plan review would select a mutable ` +
        `head plan as its oracle. Refusing rather than guessing which signal to believe`,
    );
  }
  if (signals.isPlanReview) {
    // On a plan loop the plan file IS the artifact -- which is why
    // `classifyPath` already gives `docs/plans/` its own behavioral class.
    const introduced = planFilesIntroducedBy(headSha, { runGit, base });
    if (introduced.length !== 1) {
      throw new Error(
        `a [PLAN REVIEW] PR must introduce exactly one docs/plans/PLAN_*.md at its head ${headSha}; ` +
          `found ${introduced.length}${introduced.length ? ` (${introduced.join(", ")})` : ""}`,
      );
    }
    const text = runGit(["show", `${headSha}:${introduced[0]}`]);
    return {
      mode: "plan-review",
      sha: headSha,
      path: introduced[0],
      sections: Object.fromEntries(ORACLE_SECTIONS.map((h) => [h, sectionOf(text, h)])),
      reason: null,
      note: "The plan under review, at the reviewed head. On a plan loop the plan file is the artifact.",
    };
  }

  // AN EXPLICIT APPROVED-PLAN SOURCE OUTRANKS INCIDENTAL NO-PLAN TEXT.
  // Searching the whole body for no-plan forms FIRST meant a feature PR that
  // merely quotes one -- a process change discussing `**Fix tier:** C`, a
  // changelog entry, this very loop's own PR body -- returned
  // `planOracle: null` and dropped the human-approved oracle the conformance
  // rubric runs on, without ever parsing the provenance line sitting in the
  // same body. A no-plan form is a claim that no plan exists; it cannot
  // outrank evidence that one does. (Codex, #38 round 6.)
  const source = approvedPlanSourceText(body);
  const sha = approvedPlanCommit(source)?.sha;
  if (!sha) {
    const permitted = permittedNoPlanForm(body);
    if (permitted?.refuse) throw new Error(permitted.refuse);
    if (permitted) return { mode: null, sha: null, path: null, sections: null, reason: permitted.reason };
    throw new Error(
      `the PR body names no approved-plan source and matches none of the permitted no-plan forms ` +
        `(bugfix oracle, trivial change, private path). A missing approved-plan source is itself a ` +
        `contract finding, so this refuses rather than proceeding without the oracle`,
    );
  }
  try {
    runGit(["cat-file", "-e", `${sha}^{commit}`]);
  } catch {
    throw new Error(`the approved-plan commit ${sha} is not present in this clone (fetch the plan-review branch, then re-run)`);
  }
  const explicit = PLAN_PATH_LINE_RE.exec(source)?.[1];
  // The cited plan commit lives on a plan-review branch cut from the same
  // base this PR was, so the PR's base is the right range endpoint for it too.
  const introduced = planFilesIntroducedBy(sha, { runGit, base });
  if (explicit && !introduced.includes(explicit)) {
    // An explicit path is a disambiguator among what the commit introduced,
    // never an override of it. Trusting it unchecked would let the body name
    // any file at that commit -- including one the approval never covered.
    throw new Error(
      `the Approved-plan source line names ${explicit}, but the cited commit ${sha} introduces ` +
        `${introduced.length ? introduced.join(", ") : "no docs/plans/PLAN_*.md at all"} -- refusing rather than ` +
        `reading a plan the cited commit did not deliver`,
    );
  }
  const candidates = explicit ? [explicit] : introduced;
  if (candidates.length !== 1) {
    throw new Error(
      `the approved-plan commit ${sha} introduces ${candidates.length} docs/plans/PLAN_*.md files` +
        `${candidates.length ? ` (${candidates.join(", ")})` : ""}; name the path in the source line to disambiguate`,
    );
  }
  const text = runGit(["show", `${sha}:${candidates[0]}`]);
  return {
    mode: "approved-plan",
    sha,
    path: candidates[0],
    sections: Object.fromEntries(ORACLE_SECTIONS.map((h) => [h, sectionOf(text, h)])),
    reason: null,
    note: "The approved plan, read at the commit the PR body names -- fixed by David's approval, not revisable mid-loop.",
  };
}

/**
 * The plan files a commit ITSELF introduced or modified -- not every plan file
 * present at it.
 *
 * "Exactly one present" is a property of the repository's history, not of the
 * approved plan, and it stops holding the first time a plan is retained on
 * `main`, which the loop permits. After that every future plan-review branch
 * would carry the retained file plus its own and the check would refuse
 * forever. (Codex, #37 round 2.)
 */
export function planFilesIntroducedBy(sha, { runGit = git, base = null } = {}) {
  if (base) {
    // FROM THE RANGE, not from one commit. `-m` fixed a merge head reporting
    // nothing, but left a second merge shape wrong: when a plan-review branch
    // introducing PLAN_A merges a `main` that independently introduced
    // PLAN_B, `-m` emits PLAN_B against one parent and PLAN_A against the
    // other, so two candidates survive deduplication and the oracle refuses a
    // loop that plainly contains one plan. A three-dot range against the PR's
    // base asks the question that was always meant: which plans does THIS
    // BRANCH contribute, relative to where it left main. (Codex, #38 round 5.)
    const ranged = runGit(["diff", "--name-only", "-z", "--no-renames", `${base}...${sha}`]);
    return [...new Set(ranged.split("\0").filter(Boolean).filter(isPlanPath))];
  }
  // `-m` because a MERGE COMMIT otherwise reports nothing at all. This
  // repository requires merging newly-landed `main` into an already-pushed
  // branch rather than rebasing it, so a plan-review head IS routinely a
  // merge -- and without merge traversal the oracle sees zero introduced
  // plans and refuses the mandatory adjudication on a loop that contains
  // exactly one plan. Reproduced against real git before fixing: 0 paths
  // without `-m`, both paths with it. (Codex, #38 round 4.)
  //
  // `-m` emits one diff per parent, so the same path can appear twice; the
  // set is deduplicated.
  // No base available (a cited commit with no range to measure against): fall
  // back to the single commit, with `-m` so a merge reports something at all.
  const out = runGit(["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "-m", "--no-renames", sha]);
  return [...new Set(out.split("\0").filter(Boolean).filter(isPlanPath))];
}

const isPlanPath = (f) => /^docs\/plans\/PLAN_[A-Za-z0-9_.-]+\.md$/.test(f);

/**
 * The reviewer-authored root comments, one per thread — the same population
 * `countFindings` counts, but keeping the fields it drops (path, resolution
 * state, body).
 *
 * The reviewer filter is not optional. `countFindings` and `findingsByRound`
 * deliberately restrict to the Codex logins; a territory or gap list built
 * over *every* thread would fold David's own inline comments into the measured
 * loop and could flip a stop/continue decision on findings that were never
 * part of it. (Codex, round 1.)
 */
/**
 * GitHub's own identifiers, asserted before a finding list is built from them.
 *
 * WHY THIS EXISTS, stated plainly because it is a fix for MY OWN mistake
 * (#37, round 3). Assembling a snapshot by hand, I filled the prior rounds'
 * threads with reconstructed entries -- invented ids and my paraphrase of the
 * reviewer's findings -- and handed the result to the adjudicator as though it
 * were GitHub's record. The judge noticed unprompted and discounted them. The
 * record's entire premise is that the loop's own account of itself is the
 * thing that failed, so a record that will accept the loop's paraphrase of a
 * finding has given away the only property that makes it worth reading.
 *
 * A real review thread carries a GraphQL node id (`PRRT_…`) and every comment
 * on it a `html_url` containing `#discussion_r<digits>`. Neither is something
 * a session assembles; both come back from the MCP call verbatim. Requiring
 * them refuses a reconstruction without the judge having to smell one.
 */
export function assertThreadProvenance(reviewThreads) {
  (reviewThreads ?? []).forEach((thread, i) => {
    if (typeof thread.id !== "string" || !/^PRRT_[A-Za-z0-9_-]+$/.test(thread.id)) {
      throw new Error(
        `reviewThreads[${i}] carries id ${JSON.stringify(thread.id)}, which is not a GitHub review-thread ` +
          `node id (PRRT_…). Findings must come from the captured threads verbatim -- a reconstructed or ` +
          `hand-written thread is refused, because the record's whole value is that it is not the loop's ` +
          `own account of itself`,
      );
    }
    // The comment-level rule MATCHES THE SHARED CONTRACT rather than
    // exceeding it. `assertMcpSnapshotShape` recovers a comment's identity
    // from `#discussion_r<id>` and deliberately FALLS BACK to the stable
    // thread id when the URL is absent -- a shape `review-counting.test.mjs`
    // pins as supported. Requiring both here rejected captures `fromMcp`
    // accepts, in the one place a refusal can strand a mandatory round: a
    // loop that cannot build a record cannot obtain a verdict to continue OR
    // to stop. Two enforcement points with different rules is how a contract
    // diverges from itself. (Codex, #38 round 3; #39 gap 1.)
    //
    // The anti-reconstruction property is unchanged, because it never rested
    // on the URL: a hand-written thread fails the node-id check above, which
    // is the check that caught mine.
    const stableThreadId = /^PRRT_[A-Za-z0-9_-]+$/.test(thread.id ?? "");
    (thread.comments ?? []).forEach((c, j) => {
      if (!stableThreadId && !/#discussion_r\d+/.test(c.html_url ?? "")) {
        throw new Error(
          `reviewThreads[${i}].comments[${j}] carries neither a #discussion_r<id> html_url nor a stable ` +
            `thread id, so nothing identifies it as a GitHub review comment. Refusing rather than counting ` +
            `it as a finding`,
        );
      }
    });
  });
}

/**
 * The SAME anti-reconstruction rule, applied to the two arrays a thread check
 * never touched: `reviews` and `issueComments`.
 *
 * These are what `rounds`, `trend` and every clean-pass detection are counted
 * from, and the rubric weighs the trend directly. `assertThreadProvenance`
 * caught my hand-built THREADS on #37; it left the sibling arrays open, and
 * #38's own round-4 snapshot then carried four review ids and one issue
 * comment id that I typed -- 5125910000, 5125910100, 5125910200, 5125940000,
 * 5560235000, round numbers rather than GitHub's -- with a paraphrased body
 * beside them. That snapshot fed the record the judge ruled on. Fixing one
 * array and leaving two is not a provenance guarantee; it is a guarantee
 * about the array I happened to be caught on.
 *
 * What is checkable without network access: GitHub returns an `html_url` for
 * every review and issue comment, ending in `#pullrequestreview-<id>` or
 * `#issuecomment-<id>`, and that id must EQUAL the entry's own `id`. A typed
 * entry has no URL to copy and a fabricated one disagrees with itself. This
 * cannot stop deliberate forgery and does not claim to -- the threat model is
 * my own mistakes -- but it does stop the mistake that actually happened,
 * which is a plausible number typed where a captured one belonged.
 */
export function assertCapturedProvenance(snapshot) {
  // THE URL'S PATH IS EVIDENCE TOO, and ignoring it wasted half the check: a
  // foreign entry -- `reviews` accidentally concatenated from another PR, or
  // from another repository's #38 -- agrees with its own id perfectly well,
  // and would then be counted into `rounds` and `trend` on a record labelled
  // as this PR. The path names the repository and the pull number; both must
  // be this loop's. (Codex, #38 round 7, on a check added in the same round.)
  const repo = typeof snapshot?.repo === "string" ? snapshot.repo.toLowerCase() : null;
  const number = snapshot?.pr?.number;
  const assertTarget = (where, url) => {
    const m = /github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)\b/i.exec(url);
    if (!m) {
      throw new Error(
        `${where}'s html_url ${JSON.stringify(url)} names no <owner>/<repo>/pull/<n>, so nothing ties it to ` +
          `this loop. Refusing rather than counting a pass whose pull request is unidentified`,
      );
    }
    if (repo && m[1].toLowerCase() !== repo) {
      throw new Error(
        `${where} was captured from ${m[1]}, not ${snapshot.repo}. A snapshot's collections must all come ` +
          `from the pull request the record is about`,
      );
    }
    if (Number.isFinite(number) && Number(m[2]) !== number) {
      throw new Error(
        `${where} was captured from PR #${m[2]}, not #${number}. Rounds and trend are counted from these ` +
          `arrays, so a foreign entry would be reported as this loop's own`,
      );
    }
  };

  const arrays = [
    ["reviews", "review", "#pullrequestreview-<id>", snapshot?.reviews, /#pullrequestreview-(\d+)\b/],
    ["issueComments", "issue comment", "#issuecomment-<id>", snapshot?.issueComments, /#issuecomment-(\d+)\b/],
  ];
  // Threads carry the same URLs and the same hole. Checked only WHERE A URL IS
  // PRESENT, because the shared snapshot contract deliberately allows a thread
  // identified by its stable node id alone -- refusing that shape here is the
  // divergence round 3 already found. (#38 round 7.)
  // ANY non-empty URL is bound, not only one carrying a `#discussion_r`
  // fragment. The stable-id fallback lets a thread arrive with no URL at all;
  // it never meant a URL from another PR should ride along unread because its
  // fragment was missing -- the path still names a repository and a pull
  // number, and a foreign finding was landing in this record through exactly
  // that gap. (Codex, #38 round 11.)
  for (const [i, thread] of (snapshot?.reviewThreads ?? []).entries()) {
    for (const [j, c] of (thread?.comments ?? []).entries()) {
      if (typeof c?.html_url === "string" && c.html_url.trim() !== "") {
        assertTarget(`reviewThreads[${i}].comments[${j}]`, c.html_url);
      }
    }
  }
  for (const [key, noun, shape, entries, anchor] of arrays) {
    (entries ?? []).forEach((entry, i) => {
      const url = typeof entry?.html_url === "string" ? entry.html_url : "";
      const found = anchor.exec(url)?.[1];
      if (!found) {
        throw new Error(
          `${key}[${i}] carries no ${shape} html_url. GitHub returns one for every ${noun}; an entry ` +
            `without it was not captured from GitHub, and the rounds and trend this record reports are ` +
            `counted from these arrays`,
        );
      }
      assertTarget(`${key}[${i}]`, url);
      if (String(entry.id) !== found) {
        throw new Error(
          `${key}[${i}] has id ${JSON.stringify(entry.id)} but its html_url names ${found}. A capture cannot ` +
            `disagree with itself; refusing rather than counting a round from an entry whose identity is ` +
            `internally inconsistent`,
        );
      }
    });
  }
}

export function reviewerFindings(reviewThreads) {
  const out = [];
  // Deduplicated by the root comment's identity, matching `countFindings`'
  // own semantics: two concatenated MCP pages that overlap repeat a thread,
  // and without this the record could say totalFindings: 1 while listing two
  // items -- an internal contradiction handed to the one reader told to trust
  // the record. (Codex, #503 round 3.)
  const seenRoots = new Set();
  for (const thread of reviewThreads ?? []) {
    const root = thread.comments?.[0];
    if (!root) continue;
    if (!REVIEWER_LOGINS.has(normalizeLogin(root.author ?? root.user?.login))) continue;
    const rootId = /discussion_r(\d+)/.exec(root.html_url ?? "")?.[1] ?? `thread:${thread.id}`;
    if (seenRoots.has(rootId)) continue;
    seenRoots.add(rootId);
    out.push({
      threadId: thread.id ?? null,
      path: thread.path ?? root.path ?? null,
      line: thread.line ?? root.line ?? null,
      // `isResolved` is what tells an unaddressed finding from a closed one.
      // Absent in older snapshots, so it stays nullable rather than being
      // defaulted to either answer.
      resolved: typeof thread.isResolved === "boolean" ? thread.isResolved : null,
      outdated: typeof thread.isOutdated === "boolean" ? thread.isOutdated : null,
      createdAt: root.created_at ?? null,
      // The reviewer's OWN WORDS, in full -- the 400-character excerpt this
      // replaces was too short to triage against. Bounded by the record's
      // caps below, never by a per-item slice, and replies are excluded
      // whoever wrote them: the builder's replies are exactly the channel the
      // adjudicator must not read.
      body: typeof root.body === "string" ? root.body : null,
    });
  }
  return out;
}

/**
 * Findings split by territory: does the finding's file appear in this PR's own
 * changed-file list?
 *
 * A snapshot whose threads carry no path at all reports `unknown` rather than
 * defaulting either way.
 */
export function findingsByTerritory(findings, files) {
  const changed = new Set(files.map((f) => f.filename));
  const out = { inDiff: 0, outsideDiff: 0, unknown: 0, outsideDiffPaths: [] };
  for (const finding of findings) {
    if (!finding.path) {
      out.unknown += 1;
    } else if (changed.has(finding.path)) {
      out.inDiff += 1;
    } else {
      out.outsideDiff += 1;
      if (!out.outsideDiffPaths.includes(finding.path)) out.outsideDiffPaths.push(finding.path);
    }
  }
  return out;
}

/** The commit of the most recent completed reviewer pass, or null. */
export function lastReviewedCommit(passes) {
  for (let i = passes.length - 1; i >= 0; i -= 1) {
    if (passes[i].commit) return passes[i].commit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Caps: every variable-length field is bounded, and truncation is visible
// ---------------------------------------------------------------------------

/**
 * Per-field caps, and a total measured on the SERIALIZED record.
 *
 * The per-field caps bound what this record chooses to include; the total
 * bounds what it actually emits, after those caps, so fields that are variable
 * but not individually capped (`sinceLastReview.files`, per-finding path
 * metadata, the round table) cannot combine past it. Chosen an order of
 * magnitude under a 1M-token context at ~4 characters per token, leaving the
 * judge's own reasoning room.
 *
 * Overflow DEGRADES VISIBLY rather than refusing. Refusing to build a record
 * is refusing to adjudicate, and a loop long enough to blow the budget is the
 * worst possible moment to have no judge. The finding text is spent on
 * unresolved findings first, then most-recent-first, because those are the
 * ones a verdict turns on.
 */
export const FINDING_TEXT_CAP_CHARS = 200_000;
export const PLAN_ORACLE_CAP_CHARS = 80_000;
export const DECLINE_CITATION_CAP_CHARS = 40_000;
export const RECORD_TOTAL_CAP_CHARS = 600_000;

/**
 * The longest single line the record may emit.
 *
 * A cap on SIZE is not a guarantee of READABILITY, and the difference was
 * demonstrated by the judge on this very PR: its Read was cut at 52,593 of
 * 103,547 characters of `artifact.patch`, so it never saw the implementation
 * hunks and said so in its verdict. `JSON.stringify` escapes newlines, so any
 * multi-line value -- a patch, a finding body, a plan section -- arrives as
 * ONE enormous JSON line, and a line is the unit the reader's transport
 * cannot page past. A value can therefore sit under every declared cap, leave
 * `truncation.fields` empty, and still be invisible to the only reader that
 * matters. (Codex, #38 round 4, evidenced by loop-extension-38-1.json.)
 *
 * So every multi-line field is emitted as an ARRAY OF LINES: pretty-printed
 * JSON then puts each source line on its own line, and a line longer than
 * this cap is split into consecutive chunks rather than truncated -- nothing
 * is lost, it is only made reachable.
 */
export const RECORD_LINE_CAP_CHARS = 2_000;

/**
 * A multi-line string as the record emits it: an array of lines, each within
 * the line cap. `null` and non-strings pass through untouched, so a field
 * that is legitimately absent still reads as absent rather than as [].
 */
export function asReadableLines(text) {
  if (typeof text !== "string") return text;
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length <= RECORD_LINE_CAP_CHARS) {
      out.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += RECORD_LINE_CAP_CHARS) {
      out.push(line.slice(i, i + RECORD_LINE_CAP_CHARS));
    }
  }
  return out;
}

const cutMarker = (full, kept) => `\n[TRUNCATED at ${kept} chars of ${full} -- weigh the truncation itself as uncertainty]`;

/** Order the finding text is spent in: unresolved first, then most recent. */
function spendOrder(items) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const unresolved = (x) => (x.item.resolved === false ? 0 : 1);
      if (unresolved(a) !== unresolved(b)) return unresolved(a) - unresolved(b);
      const at = (x) => Date.parse(x.item.createdAt ?? "") || 0;
      return at(b) - at(a);
    });
}

/**
 * Applies every cap and records what was cut. Mutates nothing the caller
 * still needs: it returns the record to write.
 */
export function applyCaps(record) {
  const truncation = { fields: [], totalCapChars: RECORD_TOTAL_CAP_CHARS, serializedChars: 0 };

  // The per-field caps below run on the strings, before the conversion above
  // has any effect on them -- `applyCaps` is called once, and the conversion
  // is the last thing it does to content.
  let budget = FINDING_TEXT_CAP_CHARS;
  for (const { item } of spendOrder(record.findings.items)) {
    const body = item.body ?? "";
    if (body.length <= budget) {
      budget -= body.length;
      continue;
    }
    const kept = Math.max(0, budget);
    item.body = body.slice(0, kept) + cutMarker(body.length, kept);
    item.bodyTruncated = true;
    budget = 0;
    truncation.fields.push({ field: `findings.items[${item.threadId}].body`, keptChars: kept, fullChars: body.length });
  }

  const sections = record.planOracle?.sections;
  if (sections) {
    let planBudget = PLAN_ORACLE_CAP_CHARS;
    for (const heading of Object.keys(sections)) {
      const text = sections[heading] ?? "";
      if (text.length <= planBudget) {
        planBudget -= text.length;
        continue;
      }
      const kept = Math.max(0, planBudget);
      sections[heading] = text.slice(0, kept) + cutMarker(text.length, kept);
      planBudget = 0;
      truncation.fields.push({ field: `planOracle.sections.${heading}`, keptChars: kept, fullChars: text.length });
    }
  }

  if (typeof record.declineCitation?.text === "string" && record.declineCitation.text.length > DECLINE_CITATION_CAP_CHARS) {
    const full = record.declineCitation.text.length;
    record.declineCitation.text = record.declineCitation.text.slice(0, DECLINE_CITATION_CAP_CHARS) + cutMarker(full, DECLINE_CITATION_CAP_CHARS);
    truncation.fields.push({ field: "declineCitation.text", keptChars: DECLINE_CITATION_CAP_CHARS, fullChars: full });
  }

  // The artifact patch is capped by `cappedDiff` before this function runs,
  // so its cut arrives as a fact on the record rather than being made here.
  // It is folded into the ONE summary the judge reads, and the scratch field
  // removed, so `fields` is the single place a withheld field is named.
  if (record.artifact?.patchTruncation) {
    truncation.fields.push({ field: "artifact.patch", ...record.artifact.patchTruncation });
  }
  if (record.artifact) delete record.artifact.patchTruncation;
  if (record.sinceLastReview?.patchTruncation) {
    truncation.fields.push({ field: "sinceLastReview.patch", ...record.sinceLastReview.patchTruncation });
  }
  if (record.sinceLastReview) delete record.sinceLastReview.patchTruncation;

  record.truncation = truncation;
  // Measured on what is actually written, after every per-field cap -- the
  // only measurement that can bound a combination nobody enumerated.
  // EVERY MULTI-LINE FIELD BECOMES AN ARRAY OF LINES before anything is
  // measured, because the conversion changes the emitted size and because
  // what the judge cannot read may as well not be there. Done here, once, so
  // no field can be added later that is capped but unreadable.
  for (const item of record.findings?.items ?? []) item.body = asReadableLines(item.body);
  if (record.planOracle?.sections) {
    for (const heading of Object.keys(record.planOracle.sections)) {
      record.planOracle.sections[heading] = asReadableLines(record.planOracle.sections[heading]);
    }
  }
  if (record.declineCitation) record.declineCitation.text = asReadableLines(record.declineCitation.text);
  if (record.artifact) record.artifact.patch = asReadableLines(record.artifact.patch);
  // BOTH patches. `sinceLastReview.patch` is empty under the write-gate rule
  // but not by construction -- a branch that moved after the last pass emits
  // it in full, and one escaped JSON line is exactly the unreadable shape
  // round 5 removed from the artifact patch. (Codex, #38 round 10.)
  if (record.sinceLastReview && typeof record.sinceLastReview.patch === "string") {
    record.sinceLastReview.patch = asReadableLines(record.sinceLastReview.patch);
  }

  // The note goes on BEFORE anything is measured. Measuring, then adding
  // metadata, then never re-measuring is how a record ends up larger than the
  // size it reports: near the boundary it can cross the cap on the strength of
  // the very fields that describe the cap, with `overCap` unset and
  // `serializedChars` understating the truth. (Codex, #38 round 2.)
  truncation.note =
    "Every variable-length field is bounded: finding bodies, the plan oracle's sections, the decline " +
    "citation, and artifact.patch (its own cap). `fields` names everything that was cut. An empty " +
    "`fields` with a serializedChars under the total means nothing was withheld.";

  // PROGRESS IS GUARANTEED BY CONSTRUCTION, not by hoping the next pass picks
  // a different item. The obvious loop -- "find a body with length > 0, blank
  // it" -- never terminates, because blanking a body replaces it with a
  // non-empty truncation marker that the next pass selects again. Measured:
  // it hangs record generation outright, in every synced consumer. So each
  // pass takes the NEXT item in a fixed order and each item is shed at most
  // once. (Codex, #38 round 1.)
  /**
   * The size of the record AS EMITTED -- including `serializedChars` itself,
   * whose digits are part of what is written. Writing the number changes the
   * length, so this iterates to a fixed point (two passes in practice, and
   * bounded regardless) rather than reporting a figure that was true before
   * the field carrying it existed.
   */
  const measure = () => {
    for (let i = 0; i < 8; i += 1) {
      const text = JSON.stringify(record, null, 2);
      if (truncation.serializedChars === text.length) return text.length;
      truncation.serializedChars = text.length;
    }
    return JSON.stringify(record, null, 2).length;
  };

  let serialized = measure();
  const shedOrder = spendOrder(record.findings.items).reverse();
  // Bodies are arrays of lines by now, so "how much am I dropping" is the
  // joined character count, not the number of lines.
  const textLength = (value) =>
    Array.isArray(value) ? value.reduce((n, line) => n + line.length + 1, 0) : (value ?? "").length;
  for (const { item } of shedOrder) {
    if (serialized <= RECORD_TOTAL_CAP_CHARS) break;
    const full = textLength(item.body);
    if (full === 0) continue;
    item.body = null;
    item.bodyTruncated = true;
    truncation.fields.push({ field: `findings.items[${item.threadId}].body`, keptChars: 0, fullChars: full, reason: "total record cap" });
    serialized = measure();
  }
  if (serialized > RECORD_TOTAL_CAP_CHARS) {
    // Every sheddable field is gone and the record still does not fit, so the
    // overflow is in metadata this function does not own (a very long round
    // table, thousands of paths). Say so IN the record rather than emitting a
    // silently oversized one: the judge is told to weigh a stated limit as
    // uncertainty, and an unannounced overflow is the one thing it cannot.
    truncation.overCap = true;
    truncation.overCapNote =
      `the serialized record exceeds the ${RECORD_TOTAL_CAP_CHARS}-char cap and every variable-length field ` +
      `this generator owns has already been shed -- the remainder is record metadata. Weigh the possibility ` +
      `that the dispatch will not carry all of it.`;
  }
  // Last, so the reported size includes every field above, overCap included.
  measure();
  return record;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function buildRecord({
  pr,
  snapshot,
  derived,
  budgetState,
  changes,
  artifactPatch = null,
  artifactPatchTruncation = null,
  artifactFiles = [],
  emptyAgainstDistinctEndpoints = false,
  dispatch = null,
  planOracle = null,
  declineCitation = null,
  now,
}) {
  const passes = reviewerPasses(derived.reviews, derived.issueComments);
  const byRound = findingsByRound(derived.reviews, derived.comments, derived.issueComments);
  const counts = byRound.map((r) => r.findings);
  const total = countFindings(derived.comments);

  // The same reconciliation `derive()` enforces, for the same reason: a root
  // comment that cannot be correlated to a review event is counted by
  // `countFindings` and omitted by `findingsByRound`, so the two disagree. A
  // mechanical record whose own totals contradict each other is worse than no
  // record — it is the loop's one trustworthy input, and the adjudicator is
  // told to rule on it alone. (Codex, round 1.)
  const summed = counts.reduce((a, b) => a + b, 0);
  if (summed !== total) {
    throw new Error(
      `record would not reconcile: per-round findings sum to ${summed} but the total is ${total}. ` +
        "Some reviewer root comment could not be attributed to a pass; fix the snapshot rather than " +
        "shipping a record whose numbers disagree.",
    );
  }

  const findings = reviewerFindings(snapshot.reviewThreads);

  // Rounds spent, counted from THIS snapshot -- the same fresh-evidence
  // arithmetic the guard enforces, so the record and the runtime can never
  // disagree about the allowance. The earlier version omitted the spent
  // argument and took an Infinity default, activating every dormant extension
  // and showing the adjudicator a larger allowance than the guard would
  // actually grant. (Codex, #503 round 3.)
  const counted = countRounds({ reviewerPasses: passes, issueComments: derived.issueComments });

  const budget = budgetState?.problem
    ? { problem: budgetState.problem, detail: budgetState.detail ?? null }
    : {
        tier: budgetState.tier,
        tierMeaning: TIERS[budgetState.tier].label,
        declaredBudget: budgetState.budget.budget,
        cap: tierCap(budgetState.tier),
        criticality: budgetState.budget.criticality,
        artifactDeclaredAtRoundZero: budgetState.budget.artifact,
        roundsSpent: counted.spent,
        pendingRequest: counted.pending === 1,
        // `pending === 0` also covers the case where a trigger comment and
        // the last completed pass share the exact same GitHub-reported
        // second -- genuinely indeterminate ordering, not "answered".
        // `pendingRequest: false` alone can't distinguish the two, so the
        // ambiguity is carried separately rather than silently folded into
        // "no pending request". (Codex, #539 round 3.)
        ambiguous: counted.ambiguous,
        allowance: allowance(budgetState.tier, budgetState.extensions, counted.spent),
        extensions: budgetState.extensions.map((e) => ({
          kind: e.kind,
          verdict: e.verdict ?? null,
          grant: e.grant ?? null,
        })),
      };

  return {
    generator: "scripts/review-loop-record.mjs",
    generatedAt: now,
    // The moment the UNDERLYING EVIDENCE (issueComments -- what
    // pendingRequest/round-counting is computed from) was actually read.
    // Distinct from and always <= `generatedAt` (this process's own run
    // time), which describes when the FILE was written, not how current its
    // analysis is. A consumer checking "did anything happen after this
    // record closed the loop" must bound against THIS timestamp, not
    // `generatedAt` -- a request posted between capture and this process
    // running is invisible to `pendingRequest` but would compare as
    // "already known" against the later, misleadingly-fresh-looking
    // `generatedAt`. (Codex, #539 round 3.)
    evidenceCapturedAt: capturedAtOf(snapshot, "issueComments"),
    pr,
    // WHICH REPOSITORY, out of the durable budget rather than the working
    // tree. Every repository has a #503, so a PR number alone does not
    // identify a loop -- and this record is the adjudicator's ONLY input, so
    // a foreign loop's rounds and findings reaching it would be ruled on as
    // if they were this one's. The record carried no repository at all until
    // round 8, which left the downstream validators nothing to check.
    // (Codex, PR #7 round 8.)
    repo: budgetState.budget.repo,
    title: snapshot.pr?.title ?? null,
    // Counted, never recalled. Every number below comes from GitHub's records
    // via review-counting.mjs's own counting functions.
    artifact: {
      ...artifactStats(artifactFiles),
      emptyAgainstDistinctEndpoints,
      // The reviewed code itself. `sinceLastReview.patch` is movement AFTER
      // the last pass -- empty whenever the judge is dispatched per the
      // write-gate rule -- so the findings' own subject lives here.
      patch: artifactPatch,
      // Consumed by `applyCaps` into `truncation.fields` and removed there,
      // so the emitted record states a cut in exactly one place.
      patchTruncation: artifactPatchTruncation,
      patchNote:
        "base...head: the artifact this round's findings are about. This is the diff to read when the " +
        "rubric asks whether a finding describes a critical flaw. `sinceLastReview.patch` is separate and " +
        "is normally empty under the write-gate rule, since the judge rules on an already-reviewed head.",
    },
    budget,
    // What the dispatch DECLARES, and the oracles a conformance judgement
    // needs -- all read at the reviewed commit, never from the working tree.
    dispatch,
    planOracle,
    declineCitation,
    rounds: {
      completedReviewerPasses: passes.length,
      byRound,
      trend: counts,
      totalFindings: total,
    },
    // The evidence both substantive verdicts require: `continue` must name a
    // specific unaddressed behavioral risk, and ship-with-gaps-recorded must
    // list the gaps being knowingly left. Counts alone cannot support either,
    // so the adjudicator would have had to guess — on a record built
    // specifically so it would not have to. (Codex, round 1.) Every field here
    // is source-derived: GitHub's own thread state and the reviewer's own
    // words, never the loop's account of them.
    findings: {
      unresolved: findings.filter((f) => f.resolved === false).length,
      resolved: findings.filter((f) => f.resolved === true).length,
      resolutionUnknown: findings.filter((f) => f.resolved === null).length,
      // Said explicitly because the record's first live adjudication read
      // `resolved: false` as "the code was never fixed" and reasoned from it.
      // GitHub's flags describe THREAD STATE, not code state: a loop that has
      // fixed a finding but not yet posted its reply shows exactly the same
      // shape as one that ignored it, and `isOutdated` tracks whether the diff
      // hunk moved, which a fix in a different place does not do.
      note:
        "unresolved/resolved is THREAD state, not code state. An unresolved thread may already be " +
        "fixed and awaiting a reply; isOutdated only tracks whether the anchored hunk moved. Treat " +
        "these as 'what the reviewer has not yet been told is closed', never as 'what is still broken'.",
      items: findings,
    },
    territory: {
      ...findingsByTerritory(findings, artifactFiles.map((f) => ({ filename: f.file }))),
      note:
        "Territory is mechanical (finding path vs. this PR's changed files). CAUSE " +
        "(new-ground / propagation / wrong-fix / re-raised) is NOT derivable -- it has no " +
        "machine-readable marker, and is deliberately left unclassified rather than guessed.",
    },
    sinceLastReview: {
      lastReviewedCommit: lastReviewedCommit(passes),
      ...changes,
      // Also said explicitly after the first live adjudication mistook it: this
      // is the branch's movement since the last pass, which after a merge from
      // the base branch INCLUDES files that arrived with the merge and are
      // already reviewed on main. It is not the PR's diff. `artifact` above is
      // the diff (base...head) and is the right number for "how big is the
      // thing under review".
      note:
        "Branch movement since the last reviewed commit -- NOT the PR's diff. After a merge from the " +
        "base branch this includes files already reviewed and merged there. Use `artifact` for the " +
        "size of what is actually under review here.",
    },
    provenance: {
      githubVia: "mcp-snapshot (no bash transport reaches the GitHub API in this container)",
      countingLogic: "scripts/review-counting.mjs",
      caveat:
        "This record contains no narration from the loop it measures. If a field is unknown it says so; " +
        "nothing here is inferred from the session's own account of its rounds.",
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const flags = { write: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--write") {
      flags.write = true;
      continue;
    }
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} needs a value`);
    flags[key] = value;
    i += 1;
  }
  // Validated here, not just checked for presence: `--pr 0`, `--pr -1` and
  // `--pr abc` all used to reach the body, load receipts under a nonsense
  // name, and (for NaN) write an adjudication file called `NaN-1.json` with a
  // `null` PR in it. (Codex, round 1.)
  const pr = Number(flags.pr);
  if (!Number.isInteger(pr) || pr <= 0) throw new Error("--pr must be a positive integer");
  flags.pr = pr;
  if (!flags["mcp-snapshot"]) {
    throw new Error(
      "--mcp-snapshot <file> is required. Assemble it with pull_request_read (get, get_reviews, " +
        "get_files, get_review_comments, get_comments), paginated to completion, plus " +
        '"complete": { "reviews": true, "files": true, "reviewThreads": true, "issueComments": true }.',
    );
  }
  return flags;
}

/**
 * Snapshot requirements this record adds on top of `fromMcp`'s.
 *
 * Both are about the record describing the loop it CLAIMS to describe:
 *
 *  - `pr.number` must match `--pr`. `fromMcp` only checks that the number is
 *    numeric, so two files that disagree produce a record labelled as one PR
 *    carrying another PR's rounds, findings and files alongside the requested
 *    PR's budget — valid-looking, and about the wrong loop.
 *  - `issueComments` must be present and attested complete. `fromMcp` tolerates
 *    its absence for fixtures captured before clean-pass detection existed, and
 *    that backward-compatibility mode is wrong here: a clean Codex pass is
 *    delivered as an issue comment, so a snapshot without them understates the
 *    round count and can select an older `lastReviewedCommit` — understating
 *    exactly the number the tripwire turns on.
 *
 * (Both: Codex, round 1.)
 */
/**
 * The threads and request set must have been read AFTER the latest completed
 * reviewer pass. Age alone let a snapshot describe a state that never
 * existed: reviews captured after a findings-bearing pass, threads captured
 * before it -- fresh, complete, attested, and reporting that pass as clean,
 * with the reconciliation check satisfied because both derived totals were
 * zero. Same rule as pr-ready's `checkCapture`, through one shared function,
 * so the two gates cannot drift on it again. (Codex, #38 round 9.)
 */
export function assertCapturedAfterLatestPass(snapshot, passes) {
  if (!passes.length) return;
  const latest = Date.parse(passes[passes.length - 1].at ?? "");
  // A pass whose timestamp does not parse cannot anchor the ordering check,
  // and `collectionsReadBefore` returns nothing to order against -- so an
  // unparseable `submitted_at` on the latest pass silently switched the
  // check off. Refuse instead: a pass with no readable time is a capture
  // defect, not an exemption. (Codex, #38 round 11.)
  if (!Number.isFinite(latest)) {
    throw new Error(
      `the latest completed reviewer pass carries an unparseable timestamp ` +
        `(${JSON.stringify(passes[passes.length - 1].at ?? null)}), so the capture-order check has nothing to ` +
        `order against. Every review's submitted_at must be a parseable time; re-capture`,
    );
  }
  const stale = collectionsReadBefore(snapshot.capturedAt, latest, ["reviewThreads", "issueComments"]);
  if (stale.length) {
    throw new Error(
      `${stale.join(" and ")} ${stale.length > 1 ? "were" : "was"} captured before the latest completed ` +
        `reviewer pass at ${new Date(latest).toISOString()}, so the snapshot describes a state that predates ` +
        `it -- that pass's findings would be absent and the round would read as clean. Re-read after the ` +
        `response lands`,
    );
  }
}

export function assertAdjudicationSnapshot(pr, snapshot, slug) {
  if (typeof slug !== "string" || slug.trim() === "") {
    throw new Error(
      "the repository this record is for must be supplied by the caller, from the durable budget -- " +
        "defaulting it to the working tree is what let a spoofed identity pair with a foreign snapshot",
    );
  }
  if (snapshot?.pr?.number !== pr) {
    throw new Error(`snapshot describes PR ${snapshot?.pr?.number}, but --pr says ${pr}`);
  }
  // Swept with the same fix on the counting path: every repository has a #503,
  // so a PR number alone does not identify a pull request, and this record is
  // the adjudicator's ONLY input. A foreign loop's rounds and findings
  // presented under this PR's budget is the worst input that reader can get.
  // (Codex, #503 round 4 — raised against `check`; the class lives here too.)
  const target = slug;
  if (typeof snapshot.repo !== "string" || snapshot.repo.toLowerCase() !== target.toLowerCase()) {
    throw new Error(
      `snapshot must name its source repository as "repo": "${target}" -- it says ` +
        `${JSON.stringify(snapshot.repo ?? null)}, and a PR number alone does not identify a pull request`,
    );
  }
  // `snapshot.repo` is the operator's transcription; `pr.head.repo` is
  // GitHub's word and must agree too. (Codex, PR #7 round 14.)
  const head = headRepoOf(snapshot.pr);
  if (typeof head !== "string" || head.toLowerCase() !== target.toLowerCase()) {
    throw new Error(
      `snapshot.pr.head.repo must be "${target}" (pull_request_read get, head.repo.full_name) -- it says ` +
        `${JSON.stringify(head ?? null)}. The collections were captured from a different pull request than the budget covers`,
    );
  }
  // The same per-review rule the budget check applies (#503 round 4): a
  // stable id, a login, a PARSEABLE submitted_at. Without the last, the
  // ordering anchor above can be NaN. (Codex, #38 round 11.)
  (snapshot.reviews ?? []).forEach((r, i) => {
    if (!Number.isFinite(Date.parse(r?.submitted_at ?? ""))) {
      throw new Error(
        `snapshot reviews[${i}] carries an unparseable submitted_at (${JSON.stringify(r?.submitted_at ?? null)}); ` +
          `passes are ordered by it and the capture-order check anchors on it`,
      );
    }
  });
  if (!Array.isArray(snapshot.issueComments) || snapshot.complete?.issueComments !== true) {
    throw new Error(
      "an adjudication snapshot must carry issueComments with complete.issueComments === true. " +
        "Clean reviewer passes are delivered as issue comments; without them the round count is short.",
    );
  }
  // The record's own analysis (round counts, pendingRequest) is only as
  // fresh as the issueComments this snapshot actually read -- NOT as fresh
  // as whenever this process happens to run. Without a validated capture
  // time, `generatedAt` (process-run time) is the only timestamp available,
  // and using it as a freshness boundary silently overstates how current
  // the underlying data is: a request posted between capture and this
  // process running would show pendingRequest: false and compare as
  // "already known" against a boundary that never actually saw it.
  // (Codex, #539 round 3.)
  // EVERY counted collection, not just issueComments -- the same rule the
  // budget check adopted in round 7 and this sibling consumer did not. A
  // fresh issueComments timestamp beside undated reviews and threads made an
  // incomplete history look current to the one reader. And the same age
  // bound: a record generated from a capture older than the guard would
  // accept is a record the guard's own receipt could not have been minted
  // from. (Codex, #38 round 8.)
  const captured = capturedAtDetail(snapshot);
  if (captured.future.length) {
    throw new Error(
      `the adjudication snapshot dates ${captured.future.join(", ")} in the future. A capture time after ` +
        `this process's own clock cannot be the moment GitHub was read, and it would become the record's ` +
        `evidence boundary -- refusing rather than letting later requests compare as already known`,
    );
  }
  if (captured.missing.length) {
    throw new Error(
      `an adjudication snapshot must carry a parseable capture time for every counted collection; ` +
        `missing ${captured.missing.join(", ")}. The record's evidence-freshness boundary is the moment ` +
        `each collection was actually read, not this process's run time`,
    );
  }
  const age = Date.now() - Date.parse(captured.at);
  if (age < 0 || age > MAX_SNAPSHOT_AGE_MS) {
    throw new Error(
      `the adjudication snapshot's oldest capture time is ${captured.at}, ${Math.round(age / 60000)} minutes ` +
        `old -- outside the ${MAX_SNAPSHOT_AGE_MS / 60000}-minute bound. Re-capture rather than ruling on ` +
        `evidence the round check would itself refuse`,
    );
  }
}

/** Next free adjudication-record path, so a second loop never overwrites a first. */
export function nextRecordPath(pr, existing) {
  // String slicing, not a regex built from `pr` -- CodeQL flagged the built
  // pattern as regex injection, and dropping the dynamic pattern removes the
  // question rather than arguing about whether the input is safe today.
  const prefix = `${pr}-`;
  const suffix = ".json";
  const used = existing
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .map((name) => name.slice(prefix.length, name.length - suffix.length))
    .filter((seq) => /^\d+$/.test(seq))
    .map(Number);
  const seq = used.length ? Math.max(...used) + 1 : 1;
  return `${ADJUDICATIONS_DIR}/${pr}-${seq}.json`;
}

function main() {
  let flags;
  try {
    flags = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 1;
  }

  const pr = flags.pr;
  const snapshot = JSON.parse(fs.readFileSync(flags["mcp-snapshot"], "utf8"));

  // Validate FIRST. `fromMcp` is where the completeness and shape assertions
  // live, and a partial snapshot understates rounds and findings on exactly
  // the long loops this record exists to characterise -- so nothing else may
  // read the raw snapshot before it has passed.
  // The budget FIRST, because it carries the trusted identity the snapshot is
  // then checked against. This does not weaken the "validate before anything
  // reads the snapshot" rule below: `loadLoop` reads committed receipts out of
  // the durable ref and never touches the snapshot.
  const budgetState = loadLoop(pr, nodeIo());
  if (budgetState.problem) {
    throw new Error(
      `cannot build a record for PR #${pr}: its budget is unusable (${budgetState.problem}` +
        `${budgetState.detail ? `: ${budgetState.detail}` : ""}), so there is no trusted identity to ` +
        `bind this record to`,
    );
  }
  assertAdjudicationSnapshot(pr, snapshot, budgetState.budget.repo);
  // Findings are built from the captured threads verbatim or not at all.
  assertThreadProvenance(snapshot.reviewThreads);
  assertCapturedProvenance(snapshot);
  const derived = fromMcp(snapshot);

  const base = snapshot.pr?.base?.sha ?? null;
  const head = snapshot.pr?.head?.sha ?? null;
  // Validate BOTH endpoints before anything derives from the range: size,
  // territory and the patch now all come from it.
  assertArtifactEndpoints(base, head);
  const { files: artifactFiles, emptyAgainstDistinctEndpoints } = artifactFileList(base, head);

  const passes = reviewerPasses(derived.reviews, derived.issueComments);
  assertCapturedAfterLatestPass(snapshot, passes);
  const changes = changesSince(lastReviewedCommit(passes), head);
  let artifactPatchTruncation = null;
  const artifactPatch = artifactDiff(base, head, {
    onTruncate: (cut) => {
      artifactPatchTruncation = cut;
    },
  });
  const dispatch = dispatchDeclaration(head);
  const planOracle = planOracleFor(snapshot.pr, head, { base });
  const declineCitation = declineCitationFor(budgetState.tier, head);

  const record = applyCaps(
    buildRecord({
      pr,
      snapshot,
      derived,
      budgetState,
      changes,
      artifactPatch,
      artifactPatchTruncation,
      artifactFiles,
      emptyAgainstDistinctEndpoints,
      dispatch,
      planOracle,
      declineCitation,
      now: new Date().toISOString(),
    }),
  );

  const text = `${JSON.stringify(record, null, 2)}\n`;
  if (!flags.write) {
    process.stdout.write(text);
    return 0;
  }

  const dir = path.join(REPO_ROOT, ADJUDICATIONS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const rel = nextRecordPath(pr, fs.readdirSync(dir));
  fs.writeFileSync(path.join(REPO_ROOT, rel), text);
  process.stdout.write(`${rel}\n`);
  return 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exit(main());

#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * One round of the in-session plan review: GPT-6 Astra, in this container,
 * against a plan that never leaves it.
 *
 * WHY A SCRIPT AND NOT A PROMPT I TYPE
 * ------------------------------------
 * The reviewer's independence is the whole product. If the session driving
 * the loop writes the reviewer's instructions, the session can steer the
 * reviewer -- which is the failure workstream #36 names, and it is the reason
 * the adjudicator reads a script-generated record rather than my prose. The
 * same rule applies here: this file composes every instruction the reviewer
 * receives. What the caller supplies is data (which plan, which round, which
 * findings were disposed of how) and one capped emphasis directive, framed by
 * the script as emphasis and never as scope.
 *
 * WHY AN AGENT AND NOT AN API CALL
 * --------------------------------
 * The plan-review contract's first non-negotiable is "inspect the repository
 * before concluding". A single Responses API call can only see what the
 * caller packs into it, so the caller chooses the reviewer's evidence. Codex
 * CLI in a read-only sandbox is an agent with the checkout: it greps, reads
 * and runs read-only commands of its own choosing. In the measured pilot it
 * ran 45 repository commands unprompted before concluding.
 *
 * TRANSPORT, AND THE ONE THING THAT MUST NEVER BE STORED
 * -----------------------------------------------------
 * `codex exec`, signed in PER SESSION by ChatGPT device code. The token
 * bundle lives in $CODEX_HOME for the life of the container and nowhere else:
 * not in the environment block, not in chat, not in a file handed to anyone.
 * This script never reads it, never prints it, and never writes it. All it
 * does is ask `codex login status` whether one exists, and refuse with
 * instructions when it does not. (core/docs/ai-context/web-research.md.)
 *
 * TOKEN DISCIPLINE, WHICH IS WHY THE PROMPT IS ORDERED THE WAY IT IS
 * ------------------------------------------------------------------
 * The prompt is a STABLE PREFIX plus a per-round tail. Everything that does
 * not change across a loop -- the role, the contract, the oracle, the pointer
 * to the plan file, the standing output rules -- is emitted first, byte for
 * byte identical each round, so the provider's prefix cache carries it. Only
 * "## This round" varies. The plan is handed over as a PATH, never inlined,
 * which is what keeps that prefix stable even though the plan itself is
 * rewritten every round. The pilot measured 2.89M of 3.09M input tokens
 * served from cache, and this ordering is why.
 *
 * Prior findings cross rounds as ids, titles and dispositions -- never full
 * bodies. The reviewer starts fresh every round and reconciles against the
 * CURRENT WHOLE PLAN, not against its own memory of what it said last time.
 *
 * USAGE  (`--help` prints these with the path THIS checkout actually has:
 *         `core/scripts/…` in the handbook, `scripts/…` in a consumer)
 * -----
 *   # Round 0, at the scope gate: the oracle alone, before a plan exists.
 *   node <this file> --round 0 --slug <slug> --oracle <file>
 *
 *   # Round N: the plan, its oracle, a lens, and last round's dispositions.
 *   node <this file> --round 2 --plan docs/plans/PLAN_X.md \
 *        --lens "auth boundaries and failure modes" --prior priors.json
 *
 *   --dry-run  assembles the prompt and schema, writes them, spawns nothing.
 *
 * A round is ~9-10 minutes at xhigh (522 s hand-run, 576 s scripted), which is
 * longer than a comfortable Bash tool call. RUN IT DETACHED -- `setsid nohup`
 * with an exit file to wait on; a foreground run that gets cut off loses the
 * round, the reviewer's work included. The skill carries the exact shape.
 *
 * Output: .agents/reviews/<slug>/round-N.json (the validated assessment),
 * plus round-N.prompt.md, round-N.schema.json and round-N.meta.json beside
 * it. The whole directory is gitignored -- these are session artifacts, and
 * the plan is deliberately not published into git history.
 *
 * EXIT CODES
 *   0  a schema-valid assessment was written
 *   1  a refusal, or the reviewer failed
 *   2  no ChatGPT sign-in in this container -- David has to approve one
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The repository root, found by walking up to `.git` rather than counting
 * directories.
 *
 * THIS FILE SITS AT A DIFFERENT DEPTH IN EVERY REPOSITORY THAT RUNS IT. The
 * sync routes `core/X -> X`, so the handbook's `core/scripts/plan-review.mjs`
 * lands at `scripts/plan-review.mjs` in a consumer. A fixed `"..", ".."` is
 * therefore correct in exactly one of the two layouts: it finds the repo root
 * here and the repo's PARENT in every consumer, where the script would then
 * read the contract, create `docs/plans/` and write `.agents/reviews/`
 * OUTSIDE the repository — silently, since every one of those paths is
 * created on demand. The same two-layout problem `CONTRACT_PATH` below
 * already solves by retrying under `core/`.
 *
 * `.git` is the anchor because it is what makes a directory the root, in both
 * layouts and in a worktree (where `.git` is a file — `existsSync` covers
 * both). The two-up fallback is kept for the one case with no `.git` at all,
 * an extracted tarball, where the old behaviour is no worse than a throw.
 */
export function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = process.env.PLAN_REVIEW_ROOT
  ? path.resolve(process.env.PLAN_REVIEW_ROOT)
  : (findRepoRoot(SCRIPT_DIR) ?? path.resolve(SCRIPT_DIR, "..", ".."));

/** Settled: GPT-6 Astra at xhigh, read-only. Overridable only for smoke tests. */
export const DEFAULT_MODEL = "gpt-6-astra";
export const DEFAULT_EFFORT = "xhigh";
export const DEFAULT_SANDBOX = "read-only";
export const SANDBOXES = ["read-only", "workspace-write", "danger-full-access"];

export const REVIEWS_DIR = ".agents/reviews";

/**
 * The contract, by its CONSUMER path first. In the handbook the payload sits
 * one directory deeper and there is no consumer-shaped copy, so the resolver
 * retries under `core/`. Same two-layout problem the adjudication record
 * solves at a commit; this one reads the working tree, because the plan under
 * review is a working-tree file that may never be committed at all.
 */
export const CONTRACT_PATH = "docs/ai-context/plan-review-contract.md";

/** A lens is emphasis the builder chose. Capped, and framed as emphasis. */
export const MAX_LENS_CHARS = 500;
/** A disposition note is the builder's one-line reason. Capped for the same reason. */
export const MAX_NOTE_CHARS = 300;
/** A rejected output echoed back into the one re-ask. */
export const MAX_ECHO_CHARS = 200_000;

export const DISPOSITIONS = ["fixed", "declined", "to-david", "deferred"];

/**
 * Statuses that mean the reviewer could not do the job, not that the plan is
 * sound. A round carrying one of these can still return zero required
 * revisions -- because the reviewer never got far enough to have any -- so
 * convergence must exclude them or an unreviewable plan converges. (Codex,
 * #69 round 1.)
 */
export const BLOCKING_STATUSES = ["Human clarification required", "Repo context required"];

/**
 * Round budgets, by the tier of what is being planned. The plan loop takes the
 * tier of the thing it plans, because a wrong plan becomes wrong code.
 *
 * These used to be enforced by `review-budget.mjs`, which is keyed to a PR
 * number and reads receipts from a remote-tracking ref. There is no PR any
 * more, so that machinery cannot run and the budget would have been prose
 * (Codex, #69 round 1). It is enforced here instead, and the local version is
 * simpler for the same reason the rest of this is: the round count is not
 * stored anywhere, it is COUNTED from the round files on disk. A count that is
 * derived cannot drift from the thing it counts.
 */
export const TIER_BUDGETS = { product: 5, sensitive: 5, internal: 3 };
export const TIERS = Object.keys(TIER_BUDGETS);
/** The self-serve leash above the budget; past it, only David grants. */
export const LEASH = 3;

// ---------------------------------------------------------------------------
// The output schemas
// ---------------------------------------------------------------------------

/**
 * The plan-review contract's FULL-ASSESSMENT surface, as a JSON Schema.
 *
 * Every section every round, an empty list where a section is genuinely
 * empty. That is the contract's own rule, and expressing it as `required`
 * rather than as prose is the point of constraining the output: a reviewer
 * cannot quietly omit "what is strong" on a round where it found plenty to
 * complain about, and cannot omit `previous_findings` on a round where it
 * would rather not reconcile.
 *
 * Derived from the pilot's schema (docs/research/pilot/review-schema.json),
 * which produced a schema-valid assessment on the first real round.
 */
export const PLAN_ASSESSMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "review_status",
    "lens_applied",
    "summary_for_david",
    "what_is_strong",
    "required_revisions",
    "product_decisions_for_david",
    "recommended_improvements",
    "verified_claims",
    "unable_to_verify",
    "previous_findings",
  ],
  properties: {
    review_status: {
      type: "string",
      enum: [
        "No major technical disagreement",
        "Directionally good, revisions needed",
        "Substantive technical concerns",
        "Strong disagreement on direction",
        "Human clarification required",
        "Repo context required",
      ],
    },
    lens_applied: { type: "string" },
    summary_for_david: {
      type: "string",
      description:
        "Three plain-English sentences for a non-coding product owner: what this plan builds, whether it is safe to approve, and the one thing he should decide or watch.",
    },
    what_is_strong: { type: "array", items: { type: "string" } },
    required_revisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "why_it_matters", "what_should_change", "acceptance_check", "evidence", "class"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          why_it_matters: { type: "string" },
          what_should_change: { type: "string" },
          acceptance_check: { type: "string", description: "A pass/fail condition a reviser can run or check." },
          evidence: {
            type: "array",
            items: { type: "string" },
            description: "File paths with line numbers, or commands you ran, that ground this finding.",
          },
          class: { type: "string", description: "The general class of defect this instance belongs to, so the reviser can sweep for siblings." },
        },
      },
    },
    product_decisions_for_david: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "options", "recommendation"],
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          recommendation: { type: "string" },
        },
      },
    },
    recommended_improvements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "what", "why"],
        properties: { title: { type: "string" }, what: { type: "string" }, why: { type: "string" } },
      },
    },
    verified_claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "how_verified"],
        properties: { claim: { type: "string" }, how_verified: { type: "string" } },
      },
    },
    unable_to_verify: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "why"],
        properties: { claim: { type: "string" }, why: { type: "string" } },
      },
    },
    previous_findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "status", "reason"],
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["Resolved", "Still open", "Superseded"] },
          reason: { type: "string" },
        },
      },
    },
  },
};

/**
 * Round 0's shape: the scope gate, before a plan exists.
 *
 * A different question deserves a different shape. Round 0 has no plan to
 * find defects in, so `required_revisions` would be a category error -- the
 * reviewer is answering "should this be built at all, and is the boundary in
 * the right place". Its concerns carry ids so they can cross into round 1 as
 * prior findings like any other.
 */
export const SCOPE_ASSESSMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "review_status",
    "summary_for_david",
    "should_this_exist",
    "should_this_exist_why",
    "scope_assessment",
    "scope_concerns",
    "missing_from_scope",
    "product_decisions_for_david",
    "verified_claims",
    "unable_to_verify",
  ],
  properties: {
    review_status: {
      type: "string",
      enum: [
        "Scope is right",
        "Scope is right with changes",
        "Scope is wrong",
        "Human clarification required",
        "Repo context required",
      ],
    },
    summary_for_david: {
      type: "string",
      description:
        "Three plain-English sentences for a non-coding product owner: what this proposes to build, whether it is worth building now, and the one thing he should decide.",
    },
    should_this_exist: { type: "string", enum: ["Yes", "Yes, but narrower", "Not yet", "No"] },
    should_this_exist_why: { type: "string" },
    scope_assessment: {
      type: "string",
      description: "Whether the now / next / never boundary is in the right place, and what you would move across it.",
    },
    scope_concerns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "why_it_matters", "what_should_change", "evidence"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          why_it_matters: { type: "string" },
          what_should_change: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
        },
      },
    },
    missing_from_scope: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "why", "belongs_in"],
        properties: {
          title: { type: "string" },
          why: { type: "string" },
          belongs_in: { type: "string", enum: ["now", "next", "never"] },
        },
      },
    },
    product_decisions_for_david: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "options", "recommendation"],
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          recommendation: { type: "string" },
        },
      },
    },
    verified_claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "how_verified"],
        properties: { claim: { type: "string" }, how_verified: { type: "string" } },
      },
    },
    unable_to_verify: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "why"],
        properties: { claim: { type: "string" }, why: { type: "string" } },
      },
    },
  },
};

export const schemaFor = (round) => (round === 0 ? SCOPE_ASSESSMENT_SCHEMA : PLAN_ASSESSMENT_SCHEMA);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a parsed value against the subset of JSON Schema these schemas use.
 *
 * Dependency-free on purpose: this repo installs nothing, and a validator that
 * needs `npm install` is a validator that does not run on a fresh container.
 * The subset is exactly what the two schemas above express -- object, array,
 * string, required, additionalProperties:false, enum, items, properties. A
 * keyword outside it would silently pass, so `assertSchemaSupported` refuses
 * a schema this validator cannot actually enforce rather than pretending.
 */
export function validate(value, schema, at = "$") {
  const problems = [];
  const say = (msg) => problems.push(`${at}: ${msg}`);

  if (schema.enum && !schema.enum.includes(value)) {
    say(`${JSON.stringify(value)} is not one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
    return problems;
  }

  switch (schema.type) {
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        say(`expected an object, got ${describe(value)}`);
        return problems;
      }
      for (const key of schema.required ?? []) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) say(`missing required key "${key}"`);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(schema.properties ?? {})[key]) say(`unexpected key "${key}"`);
        }
      }
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          problems.push(...validate(value[key], sub, `${at}.${key}`));
        }
      }
      return problems;
    }
    case "array": {
      if (!Array.isArray(value)) {
        say(`expected an array, got ${describe(value)}`);
        return problems;
      }
      if (schema.items) {
        value.forEach((item, i) => problems.push(...validate(item, schema.items, `${at}[${i}]`)));
      }
      return problems;
    }
    case "string":
      if (typeof value !== "string") say(`expected a string, got ${describe(value)}`);
      return problems;
    case "number":
    case "integer":
      if (typeof value !== "number") say(`expected a number, got ${describe(value)}`);
      return problems;
    case "boolean":
      if (typeof value !== "boolean") say(`expected a boolean, got ${describe(value)}`);
      return problems;
    default:
      say(`schema declares an unsupported type ${JSON.stringify(schema.type)}`);
      return problems;
  }
}

const describe = (v) => (v === null ? "null" : Array.isArray(v) ? "an array" : typeof v);

/** Keywords `validate` actually enforces. Anything else is a silent pass, so refuse it. */
const SUPPORTED_KEYWORDS = new Set(["type", "required", "additionalProperties", "properties", "items", "enum", "description"]);

export function assertSchemaSupported(schema, at = "$") {
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      throw new Error(
        `${at} uses the JSON Schema keyword "${key}", which this repo's dependency-free validator does not enforce. ` +
          `A keyword that is sent to the model but not checked here means an output could be accepted that does not ` +
          `satisfy the schema -- add support for it, or drop it.`,
      );
    }
  }
  for (const [key, sub] of Object.entries(schema.properties ?? {})) assertSchemaSupported(sub, `${at}.${key}`);
  if (schema.items) assertSchemaSupported(schema.items, `${at}[]`);
}

/**
 * Did the reviewer actually reconcile the findings it was handed?
 *
 * The schema cannot ask this: `previous_findings: []` is a well-formed array,
 * and so is one naming ids nobody supplied. But the stop rule is "no required
 * revisions AND every prior Resolved or Superseded", so a round that quietly
 * drops a prior reports a clean sheet it has no basis for -- convergence
 * faked by omission rather than by argument (Codex, #69 round 1).
 *
 * So this is checked with the schema, on the same footing: a round that fails
 * it is re-asked, and the re-ask names the ids that went missing.
 */
export function reconciliationProblems(assessment, priors) {
  // The ids this round MINTS are checked first, and unconditionally --
  // before the no-priors early return, because round 1 has no priors and is
  // exactly where a duplicate id is born. These findings become the next
  // round's `--prior` entries, where a collision would let one answer
  // reconcile two findings; catching it at the source names the round that
  // produced it instead of failing an hour later with the collision already
  // baked into a file.
  const minted = new Set();
  for (const key of ["required_revisions", "scope_concerns"]) {
    for (const f of assessment[key] ?? []) {
      if (typeof f?.id !== "string") continue;
      if (minted.has(f.id)) {
        return [
          `${key} names "${f.id}" twice; a finding id identifies one finding, and two sharing it would be ` +
            `reconciled by a single answer next round`,
        ];
      }
      minted.add(f.id);
    }
  }

  if (priors.length === 0) return [];
  const returned = new Map();
  for (const f of assessment.previous_findings ?? []) {
    if (returned.has(f.id)) return [`previous_findings names "${f.id}" twice; each prior finding is reconciled exactly once`];
    returned.set(f.id, f);
  }
  const problems = [];
  for (const p of priors) {
    if (!returned.has(p.id)) {
      problems.push(
        `previous_findings does not reconcile "${p.id}" (${p.title}) -- every finding handed over must come back ` +
          `Resolved, Still open or Superseded, because the loop stops on that answer`,
      );
    }
  }
  const supplied = new Set(priors.map((p) => p.id));
  for (const id of returned.keys()) {
    if (!supplied.has(id)) problems.push(`previous_findings reconciles "${id}", which was not handed over`);
  }
  return problems;
}

/**
 * Whether this round meets the loop's stop rule -- computed, not judged.
 *
 * Three conditions, and the third is the one that is easy to forget: a
 * BLOCKING status means the reviewer could not review, and such a round
 * naturally has no required revisions to report. Reading that as convergence
 * would take "I could not see enough of the repository to judge this" for
 * "this is fine".
 */
export function convergence(assessment, priors) {
  const reasons = [];
  const required = assessment.required_revisions ?? assessment.scope_concerns ?? [];
  if (required.length) reasons.push(`${required.length} required revision(s) open`);
  if (BLOCKING_STATUSES.includes(assessment.review_status)) {
    reasons.push(`review_status is "${assessment.review_status}" -- the reviewer could not complete the review`);
  }
  // Round 0 answers a different question, and "this should not be built" has
  // no required revisions to file -- so it read as converged (Codex, #69
  // round 2). A verdict against the work is the opposite of the stop rule.
  if (assessment.review_status === "Scope is wrong") reasons.push('review_status is "Scope is wrong"');
  if (["No", "Not yet"].includes(assessment.should_this_exist)) {
    reasons.push(`should_this_exist is "${assessment.should_this_exist}" -- a product question for David, not a pass`);
  }
  const unresolved = (assessment.previous_findings ?? []).filter((f) => f.status === "Still open");
  if (unresolved.length) reasons.push(`${unresolved.length} prior finding(s) Still open: ${unresolved.map((f) => f.id).join(", ")}`);
  if (priors.length && !(assessment.previous_findings ?? []).length) reasons.push("prior findings were not reconciled");
  return { converged: reasons.length === 0, reasons };
}

/**
 * The allowance this loop has, from its tier and any recorded grants.
 *
 * Mirrors the contract exactly: a finite grant opens `asOf + grant` rounds, so
 * a mid-stage grant discards the interrupted stage's unspent remainder rather
 * than stacking on it. Adjudicator grants self-serve only as far as the leash;
 * past that the grant has to be David's.
 */
export function allowanceFor(tier, grants) {
  const cap = TIER_BUDGETS[tier];
  let allowance = cap;
  for (const g of grants) {
    const opened = g.asOf + g.grant;
    if (g.kind === "adjudicator" && opened > cap + LEASH) {
      throw new Error(
        `an adjudicator grant cannot open round ${opened}: the self-serve leash ends at ${cap + LEASH} ` +
          `(budget ${cap} + ${LEASH}). Past there the grant is David's, recorded with kind "david".`,
      );
    }
    allowance = Math.max(allowance, opened);
  }
  return allowance;
}

/** Grants recorded for this loop, validated rather than trusted. */
export function readGrants(dir) {
  const file = path.join(dir, "extensions.json");
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${file} must contain a JSON array of grants`);
  return raw.map((g, i) => {
    const at = `extensions.json[${i}]`;
    for (const key of ["grant", "asOf"]) {
      if (!Number.isInteger(g?.[key]) || g[key] < 0) throw new Error(`${at} needs an integer "${key}" >= 0`);
    }
    if (!["adjudicator", "david"].includes(g.kind)) throw new Error(`${at} needs "kind" of "adjudicator" or "david"`);
    if (typeof g.reason !== "string" || g.reason.trim() === "") {
      throw new Error(`${at} needs a "reason" -- a grant that names no unaddressed risk is a rubber stamp`);
    }
    return { grant: g.grant, asOf: g.asOf, kind: g.kind, reason: g.reason.trim() };
  });
}

/**
 * Refuse a tier that disagrees with the one this loop already ran under.
 *
 * Read from the earliest meta that recorded one, so the pin is the tier the
 * loop *started* on rather than whatever the last round happened to pass.
 * A meta without a tier (round 0 runs before `--tier` is required) is skipped
 * rather than treated as a mismatch.
 */
export function assertTierPinned(dir, earlier, tier) {
  for (const n of [...earlier].sort((a, b) => a - b)) {
    const file = path.join(dir, `round-${n}.meta.json`);
    if (!fs.existsSync(file)) continue;
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const pinned = meta?.budget?.tier;
    if (typeof pinned !== "string" || pinned === "") continue;
    if (pinned === tier) return;
    throw new Error(
      `this loop ran round ${n} as tier "${pinned}", and this round says "${tier}". The tier sets both the round ` +
        `budget (${TIER_BUDGETS[pinned] ?? "?"} vs ${TIER_BUDGETS[tier] ?? "?"}) and the rubric the adjudicator ` +
        `applies, so changing it mid-loop buys rounds that were never granted. Re-run with --tier ${pinned}, or ` +
        `start a new loop under a new slug if the work genuinely changed tier.`,
    );
  }
}

/**
 * Refuse a `--prior` file that drops a finding the previous round raised.
 *
 * The file is assembled by hand, and an omission is silent in the worst way:
 * reconciliation only ever checks the ids it was *given*, so a dropped finding
 * is never asked about, comes back in nobody's `previous_findings`, and the
 * stop rule reports convergence with a required revision unaddressed (Codex,
 * #69 round 8). Same false-convergence family as the duplicate-id refusal,
 * reached by subtraction instead of collision.
 *
 * **The invariant is the PREVIOUS round, not every round.** Findings resolved
 * two rounds ago were reconciled by the round after them and are legitimately
 * gone; demanding the full history would force carrying every closed finding
 * forever, and a rule that cannot be followed gets bypassed. What has *not*
 * been answered by anyone is the last round's output, so that is what must be
 * carried. Extra ids are fine — a Still-open finding travelling several rounds
 * is exactly right.
 */
export function assertPriorsCoverLastRound(dir, earlier, priors) {
  if (!earlier.length) return;
  const last = Math.max(...earlier);
  const file = path.join(dir, `round-${last}.json`);
  if (!fs.existsSync(file)) return;

  let assessment;
  try {
    assessment = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return; // A round file we cannot parse is not evidence of an omission.
  }
  const raised = [...(assessment.required_revisions ?? []), ...(assessment.scope_concerns ?? [])]
    .map((f) => f?.id)
    .filter((id) => typeof id === "string");
  if (!raised.length) return;

  const supplied = new Set(priors.map((p) => p.id));
  const missing = raised.filter((id) => !supplied.has(id));
  if (!missing.length) return;

  throw new Error(
    `--prior omits ${missing.length} finding(s) round ${last} raised: ${missing.join(", ")}. Reconciliation only ` +
      `checks the ids it is given, so a dropped finding is never asked about and never comes back — and the stop ` +
      `rule would then read as converged with a required revision unaddressed. Add them with their dispositions, ` +
      `or pass --no-prior if round ${last} genuinely returned none.`,
  );
}

/** Rounds already run for this loop, counted from disk rather than stored. */
export function roundsRun(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((n) => /^round-(\d+)\.json$/.exec(n))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

/**
 * The oracle, pinned to the text David agreed, for the life of the loop.
 *
 * Without this the oracle is read from the plan file the builder rewrites
 * every round, so deleting a requirement from the plan AND from its oracle
 * block makes the next reviewer measure the plan against the rewritten intent
 * (Codex, #69 round 1). That is the builder steering the reviewer -- the exact
 * failure this whole design exists to prevent -- coming back in through the
 * one input nobody was watching.
 *
 * So round 0 (or round 1, when there is no round 0) writes the oracle down,
 * and every later round is measured against that file. A deliberate change is
 * still possible; it just cannot be silent.
 */
export function pinOracle(dir, oracle, { changedReason = null } = {}) {
  const file = path.join(dir, "oracle.txt");
  // The DECISION is made now, so a drifted oracle refuses before anything
  // runs; the WRITE waits for `commit()`, which main calls only when the
  // round completes. Written up front, an --oracle-changed run that was then
  // refused -- or exited 2 without a sign-in -- had already made the new
  // oracle authoritative, and the next run reported it as matching with no
  // reason ever stamped (Codex, #69 round 2).
  const commit = () => fs.writeFileSync(file, `${oracle}\n`);
  if (!fs.existsSync(file)) {
    return { pinned: sha256Full(oracle), changed: false, firstPin: true, commit };
  }
  const pinnedText = fs.readFileSync(file, "utf8").trim();
  if (pinnedText === oracle.trim()) return { pinned: sha256Full(oracle), changed: false, firstPin: false, commit: () => {} };
  if (!changedReason) {
    throw new Error(
      `the oracle differs from the one pinned at ${path.relative(process.cwd(), file)} when this loop started, and ` +
        `nothing says why. The oracle is what David agreed BEFORE the plan was written; if it can be edited as the ` +
        `plan is revised, the plan is being measured against itself. Restore it, or pass ` +
        `--oracle-changed "<what David agreed to change>" so the change is recorded in the round's meta.`,
    );
  }
  return { pinned: sha256Full(oracle), changed: true, changedReason, firstPin: false, commit };
}

/**
 * The reviewer's last message as a parsed object.
 *
 * `--output-schema` constrains the final message, but a model that decides to
 * be helpful still sometimes wraps it in a ```json fence. Stripping one fence
 * is worth doing; anything beyond that is a malformed output and belongs in
 * the re-ask, not in a parser that guesses.
 */
export function parseAssessment(text) {
  const trimmed = (text ?? "").trim();
  if (trimmed === "") throw new Error("the reviewer returned an empty final message");
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error(`the reviewer's final message is not JSON: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** A slug names a directory, so it is checked as one rather than trusted as one. */
export function assertSlug(slug) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug ?? "")) {
    throw new Error(
      `--slug must match /^[a-z0-9][a-z0-9-]*$/, got ${JSON.stringify(slug)}. It becomes a path segment under ` +
        `${REVIEWS_DIR}/, so anything else is a traversal waiting to happen.`,
    );
  }
  return slug;
}

/** `docs/plans/PLAN_FOO_BAR.md` -> `foo-bar`, so the common case needs no flag. */
export function slugFromPlanPath(planPath) {
  const base = path.basename(planPath).replace(/\.md$/i, "");
  const slug = base
    .replace(/^PLAN[_-]/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") throw new Error(`cannot derive a slug from ${planPath} -- pass --slug explicitly`);
  return assertSlug(slug);
}

/** The body of the first ```<tag> fenced block, or null. */
export function extractFenced(text, tag) {
  const re = new RegExp("^```" + tag + "\\s*\\n([\\s\\S]*?)\\n```\\s*$", "m");
  const m = re.exec(text ?? "");
  return m ? m[1].trim() : null;
}

/**
 * The review oracle: direction, product intent, must-not-change, settled
 * decisions, now/next/never, tier, criticality -- agreed with David BEFORE the
 * plan was written, which is what makes it an oracle rather than a summary of
 * the plan. A plan reviewed only against itself can be perfectly coherent and
 * still have dropped a requirement, and the contract asks the reviewer to
 * catch exactly that. So a missing oracle is a refusal, never a round that
 * quietly reviews the plan against its own reasoning.
 */
export function oracleFrom({ oracleText, planText }) {
  for (const source of [oracleText, planText]) {
    if (source == null) continue;
    const fenced = extractFenced(source, "plan-oracle");
    if (fenced) return fenced;
  }
  if (oracleText != null && oracleText.trim() !== "") return oracleText.trim();
  throw new Error(
    `no review oracle. Either pass --oracle <file>, or give the plan a fenced \`\`\`plan-oracle block at its head ` +
      `carrying the direction, product intent, must-not-change, settled decisions and now/next/never boundaries ` +
      `agreed before the plan was written. Reviewing a plan against itself is not the contract.`,
  );
}

/**
 * Prior findings, reduced to what crosses a round boundary: id, title,
 * disposition, and at most one capped line of why.
 *
 * The full body deliberately does NOT cross. The reviewer starts fresh and
 * re-derives from the current plan; handing it last round's argument invites
 * it to reconcile against that argument instead of against the plan, which is
 * the anchoring the fresh context exists to prevent. Extra keys are dropped
 * rather than rejected, so a caller can pass the previous round's JSON through
 * without hand-editing it.
 */
export function normalizePriors(raw) {
  if (!Array.isArray(raw)) throw new Error("the --prior file must contain a JSON array of findings");
  const seen = new Map();
  return raw.map((f, i) => {
    const at = `--prior[${i}]`;
    if (f === null || typeof f !== "object" || Array.isArray(f)) throw new Error(`${at} is not an object`);
    if (typeof f.id !== "string" || f.id.trim() === "") throw new Error(`${at} has no "id"`);
    if (typeof f.title !== "string" || f.title.trim() === "") throw new Error(`${at} (${f.id}) has no "title"`);
    if (!DISPOSITIONS.includes(f.disposition)) {
      throw new Error(
        `${at} (${f.id}) has disposition ${JSON.stringify(f.disposition)}; it must be one of ${DISPOSITIONS.join(", ")}. ` +
          `An unrecognised disposition would reach the reviewer as an unanswered finding, which is how a fix gets ` +
          `silently re-litigated.`,
      );
    }
    // A DUPLICATE ID IS FAKE CONVERGENCE, so it is refused here rather than
    // deduplicated. Reconciliation matches priors to the reviewer's
    // `previous_findings` through `Map`/`Set` membership, which is keyed by
    // id: two distinct priors sharing one id therefore both count as
    // reconciled the moment the reviewer answers that id once, and the stop
    // rule can read `converged: true` with a required revision never
    // addressed. Nothing makes reviewer-generated ids unique -- they are
    // free text from a model, across rounds that never see each other -- so
    // the collision is ordinary rather than adversarial. Refusing names both
    // positions, which a silent merge could not.
    const id = f.id.trim();
    if (seen.has(id)) {
      throw new Error(
        `${at} repeats id ${JSON.stringify(id)}, already used by --prior[${seen.get(id)}] ` +
          `(${JSON.stringify(raw[seen.get(id)]?.title ?? "")}). Reconciliation is keyed by id, so two findings ` +
          `sharing one would both read as answered when the reviewer answers it once -- and the stop rule would ` +
          `call that converged. Give them distinct ids (a round prefix, say) before re-running.`,
      );
    }
    seen.set(id, i);

    const note = typeof f.note === "string" ? f.note.trim().replace(/\s+/g, " ") : "";
    return {
      id,
      title: f.title.trim(),
      disposition: f.disposition,
      note: note.length > MAX_NOTE_CHARS ? `${note.slice(0, MAX_NOTE_CHARS)}… (truncated)` : note,
    };
  });
}

/** The contract text and the path it was found at, in either payload layout. */
export function readContract(root = REPO_ROOT) {
  const tried = [];
  for (const candidate of [CONTRACT_PATH, path.posix.join("core", CONTRACT_PATH)]) {
    const abs = path.join(root, candidate);
    if (fs.existsSync(abs)) return { path: candidate, text: fs.readFileSync(abs, "utf8") };
    tried.push(candidate);
  }
  throw new Error(
    `cannot find the plan-review contract in either payload layout -- tried ${tried.join(" and ")}. ` +
      `The reviewer applies that file; without it there is no review to run.`,
  );
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/**
 * The standing half: identical bytes on every round of a loop.
 *
 * Note what is here and what is not. The plan arrives as a PATH -- the
 * reviewer opens it itself, which both keeps this prefix stable while the
 * plan is rewritten under it and keeps the reviewer's evidence its own. The
 * contract arrives as a path too, for the same reason and because it is the
 * file the reviewer is being asked to apply rather than quote.
 */
export function stablePrefix({ round, contractPath, oracle, planPath }) {
  const reviewing =
    round === 0
      ? [
          "## What you are looking at",
          "",
          "There is NO PLAN YET. This is the scope gate: David and the builder have agreed what",
          "they think should be built, and before a line of the plan is written you are being asked",
          "the cheapest question in the loop — **should this exist at all, and is the boundary in the",
          "right place?** You are reviewing the intent below, nothing else.",
          "",
          "Inspect the repository before you answer. The claim that a thing is missing, or already",
          "exists, or cannot work the way the intent assumes, is checkable — check it.",
        ]
      : [
          "## The plan under review",
          "",
          `\`${planPath}\` in the current checkout. Read the whole file. The repository is checked out at`,
          "the revision the plan was written against, so every path and line it cites is live.",
        ];

  return [
    "You are the independent technical plan reviewer for this repository, in an AI-to-AI planning",
    "loop with David (the human product owner) in control. You are reviewing a software-development",
    "implementation PLAN, not code, and you must not implement anything.",
    "",
    "## The contract you apply",
    "",
    `Read \`${contractPath}\` in full before doing anything else, and apply its standards exactly.`,
    ...(round === 0
      ? [
          // Round 0 runs BEFORE a plan exists, so it cannot be on the
          // contract's plan surface: that surface reviews an implementation
          // plan and defines a six-status, required-revisions document. It
          // does not define `should_this_exist`, `scope_assessment` or
          // `scope_concerns` at all. Pointing this round at it anyway told
          // the reviewer to apply criteria to a document that will not exist
          // for another hour, and the schema could enforce the JSON shape
          // without touching the contradiction underneath (Codex, #69).
          "**Your output surface for this round is the scope assessment defined by the JSON schema you were",
          "given, and the contract does not describe it.** The contract's assessment surface reviews an",
          "existing implementation plan; there is no plan yet. Take from the contract its standards — what",
          "counts as evidence, what makes a finding required rather than recommended, the non-negotiables",
          "below — and take the SHAPE of your answer from the schema alone. Where a section is genuinely",
          "empty, return an empty list rather than omitting it.",
        ]
      : [
          "You are on its **full-assessment surface** (one complete document per round), not the GitHub",
          "structured-defect surface. Every section of the assessment is produced every time; where a",
          "section is genuinely empty, return an empty list rather than omitting it.",
        ]),
    "",
    "Non-negotiables from that contract that bind you here:",
    "- You do not approve plans. David does.",
    "- Inspect the repository before concluding. Read the actual code and docs, run the inventory",
    "  oracles you are given, and never guess about repo structure. If you lack the context to judge",
    "  a claim, list it under `unable_to_verify` instead of guessing.",
    ...(round === 0
      ? [
          "- Produce a complete answer even when nothing is wrong: what the intent gets right belongs in",
          "  `should_this_exist_why` and `scope_assessment`, not only what it gets wrong.",
          "- File as a `scope_concern` only what must change BEFORE a plan is written. Anything that is",
          "  the plan's business to get right is not a scope concern — it is next round's finding.",
        ]
      : [
          "- Produce a complete review even when nothing is critical: strengths, required revisions,",
          "  recommendations, verified claims.",
          "- Separate required revisions from recommended improvements. Do not block on the recommended",
          "  tier — a recommendation never holds a round open, so anything you file as required is",
          "  something you are willing to spend another whole round on.",
        ]),
    "- Escalate, don't decide: a genuine product or design fork goes in `product_decisions_for_david`",
    "  with options and your recommendation, never settled by you.",
    "",
    ...reviewing,
    "",
    "## The review oracle (agreed with David before the plan was written)",
    "",
    "Compare against THIS, not only against internal coherence. A plan can be perfectly consistent",
    "with itself and still have dropped a requirement the intent called for; flag any such omission.",
    "",
    oracle,
    "",
    "## Toolchain exclusion",
    "",
    "Do not report what a compiler, a linter or a test suite would catch. Report what would survive",
    "into production invisibly: wrong invariants, unguarded paths, a check that can be satisfied",
    "without the thing it exists to check, a refusal that fails open.",
    "",
    "## Output",
    "",
    "Return only the JSON document matching the schema you were given — no prose around it and no",
    "code fence. Ground every finding in evidence you actually inspected: file paths with line",
    "numbers, or commands you ran and their output. `summary_for_david` is for a product owner who",
    "cannot read code and will not read a diff: outcome, never mechanism.",
  ].join("\n");
}

/** The varying half. Everything that changes round to round lives here, and only here. */
export function roundContext({ round, lens, priors, inventory }) {
  const out = ["## This round", ""];
  const subject = round === 0 ? "intent" : "plan";

  if (round === 0) {
    out.push("This is round 0, the scope gate. There are no previous findings; there is no plan file.");
  } else if (priors.length === 0) {
    out.push(
      `This is round ${round}. No previous findings were carried over, so return \`previous_findings\` as an empty list.`,
    );
  } else {
    out.push(
      `This is round ${round}. Below is every finding from the previous rounds, with what the builder did`,
      "with it. **Titles and dispositions only — deliberately not the original text.** You are not being",
      "asked to agree with the builder's reasoning or to reconcile against your own memory of what you",
      "wrote; you are being asked to look at the CURRENT plan and say, for each id, whether it is now",
      "Resolved, Still open, or Superseded by a change that made the point moot. The note is the",
      "builder's own account of its decision. It is not evidence. Check it against the plan.",
      "",
    );
    for (const p of priors) {
      const label = { fixed: "fixed", declined: "DECLINED by the builder", "to-david": "escalated to David", deferred: "deferred to a later increment" }[
        p.disposition
      ];
      out.push(`- **${p.id}** — ${p.title} — ${label}${p.note ? `: ${p.note}` : ""}`);
    }
  }

  if (inventory) {
    out.push(
      "",
      "### The plan's own affected-file inventory",
      "",
      "A starting map, not a boundary — the plan's author listed these as the files the work touches.",
      "Where it is wrong or incomplete, that is itself a finding.",
      "",
      inventory,
    );
  }

  out.push(
    "",
    `### Lens for this round: ${lens ? lens : `none — assess the whole ${subject} evenly`}`,
    "",
    lens
      ? `Attack from that angle specifically. It directs EMPHASIS, not scope: still read and assess the whole ${subject}, and a serious problem outside the lens is still a finding.`
      : "No particular angle was requested.",
  );

  if (round > 2) {
    out.push(
      "",
      "### New ground after round 2",
      "",
      "This is a late round. A concern you raise for the first time now, about a section of the plan",
      "that has not changed since round 2, belongs in `recommended_improvements` — unless you can show",
      "why it is required, in which case say so in `why_it_matters` and file it as required. This is not",
      "an instruction to soften: it is the loop's rule that a reviewer who keeps finding new required",
      "work in untouched text is expanding the plan rather than converging it.",
    );
  }

  out.push("", "Return only the JSON document matching the schema.");
  return out.join("\n");
}

export function assemblePrompt(parts) {
  const { reaskErrors, previousOutput } = parts;
  const body = [stablePrefix(parts), "", roundContext(parts)];
  if (reaskErrors?.length) {
    const echo =
      previousOutput && previousOutput.length > MAX_ECHO_CHARS
        ? `${previousOutput.slice(0, MAX_ECHO_CHARS)}\n… (truncated)`
        : previousOutput;
    body.push(
      "",
      "## Your previous attempt did not match the schema",
      "",
      "You already did this review. What came back could not be accepted, for these reasons:",
      "",
      ...reaskErrors.map((e) => `- ${e}`),
      "",
      "Below is your own previous output. Return the SAME assessment, corrected to satisfy the schema.",
      "Do not re-open the review or change your findings to make the shape easier — fix the shape.",
      "",
      "```",
      echo ?? "(the previous output could not be read)",
      "```",
    );
  }
  return body.join("\n");
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

const codexBin = () => process.env.CODEX_BIN || "codex";

/**
 * Is there a ChatGPT sign-in in this container?
 *
 * `codex login status` exits 1 and prints "Not logged in" when there is not
 * (measured, CLI 0.153.4). Both signals are read, because an exit code is a
 * thin thing to hang a refusal on and a future version could change either.
 * This function never touches $CODEX_HOME/auth.json — the bundle is David's
 * ChatGPT account credential, and nothing in this repo reads, prints or
 * copies it.
 */
export function signInStatus({ run = spawnSyncDefault } = {}) {
  let result;
  try {
    result = run(codexBin(), ["login", "status"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    return { signedIn: false, missingBinary: true, detail: err.message };
  }
  if (result.error) {
    return { signedIn: false, missingBinary: result.error.code === "ENOENT", detail: String(result.error.message) };
  }
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const signedIn = result.status === 0 && !/not logged in/i.test(text);
  return { signedIn, missingBinary: false, detail: text };
}

const spawnSyncDefault = (...args) => spawnSync(...args);

export const SIGN_IN_INSTRUCTIONS = [
  "No ChatGPT sign-in in this container, so there is no reviewer to run.",
  "",
  "Sign-in is per session and is never stored (core/docs/ai-context/web-research.md). To get one:",
  "",
  "  1. npm install @openai/codex   (in a scratch directory; set CODEX_BIN to the binary)",
  "  2. codex login --device-auth </dev/null",
  "  3. Give David the URL and the code as a 🛑 blocking ask, with a push notification.",
  "     He approves it on his phone; David never runs a command.",
  "",
  "The token bundle stays in $CODEX_HOME for the life of this container. It is never written to the",
  "environment block, never sent through chat, and never handed over in a file.",
].join("\n");

/**
 * One `codex exec` run.
 *
 * Every flag here is load-bearing:
 *   -                        the prompt arrives on stdin. `codex exec` waits
 *                            forever on an open stdin in this harness, so the
 *                            stream is written and closed, never inherited.
 *   --output-schema          constrains the final message to the contract's shape.
 *   --output-last-message    writes that message to a file, so the result is
 *                            read from disk rather than scraped out of a
 *                            transcript that contains 45 tool calls.
 *   --sandbox read-only      the reviewer reads the repo and cannot change it.
 *                            (It also blocks /tmp — a reviewer that must run
 *                            the suite needs workspace-write on a scratch
 *                            checkout, or a TMPDIR inside the workspace.)
 *   --ignore-user-config     a stray ~/.codex/config.toml must not steer this
 *                            reviewer. It is also the guard on a measured
 *                            defect: --output-schema is IGNORED when MCP tools
 *                            are active, and user config is how MCP tools get
 *                            turned on. Auth still comes from CODEX_HOME.
 *   --ignore-rules           same reasoning for execpolicy .rules files.
 *   --ephemeral              no session file on disk; each round is a fresh
 *                            context by construction, not by convention.
 *
 * stdout and stderr are inherited so a long run shows progress where a human
 * or a log file can see it; the answer never comes from either stream.
 */
export function runCodex({ prompt, schemaFile, outFile, model, effort, sandbox, cwd, timeoutMs, run = spawnSyncDefault }) {
  const args = [
    "exec",
    "--model", model,
    "-c", `model_reasoning_effort="${effort}"`,
    "--sandbox", sandbox,
    "--cd", cwd,
    "--output-schema", schemaFile,
    "--output-last-message", outFile,
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--color", "never",
    "-",
  ];
  const started = Date.now();
  const result = run(codexBin(), args, {
    input: prompt,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
    timeout: timeoutMs,
    cwd,
  });
  return { args, status: result.status, signal: result.signal, error: result.error, seconds: (Date.now() - started) / 1000 };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/**
 * The round's directory, with a `.gitignore` that ignores everything in it.
 *
 * Written by the script rather than shipped as a payload file, so it exists in
 * every consumer the first time a round runs and cannot be half-installed. `*`
 * ignores the `.gitignore` itself too, which is the intent: a plan under
 * review is deliberately not published into git history, and neither is the
 * reviewer's assessment of it. The durable record of a loop is the harvest
 * comment on the workstream issue, not these files.
 */
export function ensureRoundDir(root, slug) {
  const dir = path.join(root, REVIEWS_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(root, REVIEWS_DIR, ".gitignore");
  if (!fs.existsSync(ignore)) {
    fs.writeFileSync(
      ignore,
      [
        "# Plan-review rounds are session artifacts, not repo history.",
        "#",
        "# The plan under review is deliberately never published into git, which is",
        "# what dissolved the disclosure gate the public [PLAN REVIEW] PR needed. The",
        "# reviewer's assessment of it is the same class of thing. What survives a loop",
        "# is the approved plan (if David asks for it) and the harvest comment on the",
        "# workstream issue.",
        "#",
        "# `*` covers this file too. That is deliberate: nothing under here is tracked,",
        "# so there is no half-state where the directory is committed but its contents",
        "# are not. core/scripts/plan-review.mjs writes this file on first use.",
        "*",
        "",
      ].join("\n"),
    );
  }
  return dir;
}

/**
 * `docs/plans/` ignored, because the disclosure guarantee cannot rest on my
 * remembering.
 *
 * The whole reason the disclosure GATE could be retired is that the plan is
 * never published. But nothing was stopping `git add -A` during implementation
 * from staging it along with everything else (Codex, #69 round 1) -- and a
 * plan is exactly the document that might name an unpatched vulnerability. A
 * guarantee enforced by discipline is a guarantee that fails on the busy day.
 *
 * `git add -f` still works, which is the point: when David asks for a plan on
 * `main`, committing it is a deliberate act with the disclosure check in front
 * of it, not a side effect of a broad staging command.
 */
/** `git` for the ignore verification below. Injectable so tests can drive it. */
const defaultGit = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8" });

export function ensurePlansIgnored(root, planPath = null, git = defaultGit) {
  const dir = path.join(root, "docs", "plans");
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, ".gitignore");
  if (fs.existsSync(ignore)) {
    // A consumer that already has one is verified, not trusted: the file's
    // existence said nothing about whether it ignores a plan (Codex, #69
    // round 2). Append the managed pattern when it is missing; never rewrite
    // what a consumer put there.
    const patterns = fs
      .readFileSync(ignore, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    if (!patterns.some((l) => l === "*" || l === "PLAN_*.md" || l === "/PLAN_*.md")) {
      fs.appendFileSync(
        ignore,
        "\n# Added by core/scripts/plan-review.mjs: a plan under review is never committed by accident.\nPLAN_*.md\n",
      );
    }
    verifyIgnored(root, planPath, git);
    return;
  }
  fs.writeFileSync(
    ignore,
    [
      "# A plan under review is never published, and this is what makes that true",
      "# rather than merely intended: `git add -A` during implementation would",
      "# otherwise stage it, and a plan is exactly the document that might name an",
      "# unpatched vulnerability.",
      "#",
      "# `git add -f docs/plans/PLAN_X.md` still works. That is the design: when",
      "# David asks for a plan on main, committing it is a deliberate act with the",
      "# disclosure check in front of it, not a side effect of staging everything.",
      "#",
      "# `*` covers this file too -- core/scripts/plan-review.mjs writes it on first use.",
      "*",
      "",
    ].join("\n"),
  );
  verifyIgnored(root, planPath, git);
}

/**
 * Ask GIT whether this plan is actually ignored, instead of believing a
 * pattern that looks right.
 *
 * A `.gitignore` is not a set of patterns, it is an ordered program whose
 * LAST match decides. So `*` followed by `!PLAN_SECRET.md` leaves that one
 * plan exposed, and the pattern scan above -- which asks only whether an
 * ignoring-looking line occurs anywhere -- reads it as protected and returns
 * early having appended nothing (Codex, #69 round 5). Every rule this file
 * has added for that hazard was another guess about what git would conclude.
 * Git is right here and free to ask, so it is asked.
 *
 * `--untracked-files=all` with a `??` prefix is the exact condition that
 * matters: that is a file `git add -A` would stage. A plan already TRACKED
 * reports differently and is not refused -- David asking for a plan on
 * `main` is a supported, deliberate act with the disclosure check in front
 * of it.
 *
 * Not being able to ask is not the same as a bad answer, and is not refused:
 * outside a git repository (which is where `git` fails here) there is no
 * commit to make by accident, so there is nothing to protect against.
 */
/**
 * Refuse an oracle file that git would stage.
 *
 * Same evidence as the plan's check and the same non-refusals — a tracked
 * file is a deliberate act, and an unanswerable git means no repository and
 * so nothing to commit into. What differs is the remedy: the plan has a
 * managed home this script maintains, while an oracle can legitimately live
 * anywhere, so this names the ignored home rather than moving the file. An
 * operator who chose a path should be the one to change it.
 */
export function assertOracleIgnored(root, oraclePath, git = defaultGit) {
  const out = git(["status", "--porcelain", "--untracked-files=all", "--", oraclePath], root);
  if (out.error || out.status !== 0 || typeof out.stdout !== "string") return;
  if (!out.stdout.split("\n").some((l) => l.startsWith("??"))) return;
  throw new Error(
    `the oracle ${oraclePath} is NOT ignored by git -- \`git status --porcelain --untracked-files=all\` ` +
      `reports it as "??", so \`git add -A\` would stage it. The oracle is the agreed scope, which is where an ` +
      `unpatched vulnerability, an auth-bypass specific, a customer name or an embargoed launch gets written ` +
      `down -- the same material the disclosure carve-out protects, one document before the plan. Move it under ` +
      `docs/plans/ (which this script keeps ignored) or another ignored path, then re-run.`,
  );
}

function verifyIgnored(root, planPath, git) {
  if (!planPath) return;
  const out = git(["status", "--porcelain", "--untracked-files=all", "--", planPath], root);
  if (out.error || out.status !== 0 || typeof out.stdout !== "string") return;
  const exposed = out.stdout.split("\n").some((l) => l.startsWith("??"));
  if (!exposed) return;
  throw new Error(
    `${planPath} is NOT ignored by git -- \`git status --porcelain --untracked-files=all\` reports it as "??", ` +
      `so \`git add -A\` during implementation would stage it. docs/plans/.gitignore exists and carries an ` +
      `ignoring pattern, but a later negation overrides it: a .gitignore is an ordered program and the last ` +
      `matching rule wins. A plan is exactly the document that might name an unpatched vulnerability, so this ` +
      `round is refused rather than run against an unprotected file. Fix the negation, or move the plan.`,
  );
}

const sha256Full = (text) => crypto.createHash("sha256").update(text).digest("hex");
/** Short digests, for telling two revisions apart in a log line. */
const sha256 = (text) => sha256Full(text).slice(0, 12);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const flags = { lens: null, prior: null, oracle: null, plan: null, slug: null, round: null };
  const bools = { "dry-run": "dryRun", "no-prior": "noPrior", force: "force", help: "help" };
  const values = {
    round: "round", plan: "plan", oracle: "oracle", slug: "slug", lens: "lens", prior: "prior",
    model: "model", effort: "effort", sandbox: "sandbox", timeout: "timeout", tier: "tier",
    unpinned: "unpinned", "oracle-changed": "oracleChanged",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument ${JSON.stringify(arg)}`);
    const name = arg.slice(2);
    if (bools[name]) {
      flags[bools[name]] = true;
      continue;
    }
    if (values[name]) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`--${name} needs a value`);
      flags[values[name]] = value;
      continue;
    }
    throw new Error(`unknown flag --${name}`);
  }
  return flags;
}

/**
 * How to invoke THIS copy, computed rather than written down.
 *
 * The sync routes `core/X -> X`, so the same file is `core/scripts/…` in the
 * handbook and `scripts/…` in every consumer. A hardcoded usage line is
 * therefore wrong in one of them, and wrong in the place a reader is most
 * likely to trust it: `--help` and every argument-error response, which is
 * exactly what someone copies when they are already confused (Codex, #69
 * round 7).
 */
const INVOCATION = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join("/");
// The continuation line aligns under the first flag: `"  node "` is 7
// characters, then the path, then the space before `--round`.
const FLAG_COLUMN = " ".repeat("  node ".length + INVOCATION.length + 1);

export const USAGE = [
  "Usage:",
  `  node ${INVOCATION} --round 0 --slug <slug> --oracle <file> [--lens <text>]`,
  `  node ${INVOCATION} --round <N> --plan <file> [--slug <s>] [--oracle <f>]`,
  `${FLAG_COLUMN}[--lens <text>] [--prior <file> | --no-prior]`,
  "",
  `  --tier        ${TIERS.join(" | ")} — required from round 1; sets the round budget`,
  "  --dry-run     assemble the prompt and schema, write them, spawn nothing",
  "  --force       re-run a round that already exists, discarding its result first",
  "  --oracle-changed <reason>   the oracle differs from the pinned one, deliberately",
  "",
  `  The reviewer is PINNED to ${DEFAULT_MODEL} at ${DEFAULT_EFFORT} in a ${DEFAULT_SANDBOX} sandbox.`,
  "  --model / --effort / --sandbox are refused unless --unpinned <reason> is given,",
  "  and danger-full-access is refused always. The reason is stamped on the round.",
  "",
  "  --timeout     seconds, default 2700",
  "  CODEX_BIN     path to the codex binary, if it is not on PATH",
].join("\n");

export function main(argv = process.argv.slice(2), { root = REPO_ROOT, run = spawnSyncDefault, log = console.error, git = defaultGit } = {}) {
  let flags;
  try {
    flags = parseArgs(argv);
  } catch (err) {
    log(`plan-review: ${err.message}\n\n${USAGE}`);
    return 1;
  }
  if (flags.help) {
    log(USAGE);
    return 0;
  }

  try {
    // --- round -----------------------------------------------------------
    if (flags.round === null) throw new Error(`--round is required.\n\n${USAGE}`);
    const round = Number(flags.round);
    if (!Number.isInteger(round) || round < 0) throw new Error(`--round must be an integer >= 0, got ${JSON.stringify(flags.round)}`);

    // --- plan and oracle --------------------------------------------------
    let planPath = null;
    let planText = null;
    if (round === 0) {
      if (flags.plan) {
        throw new Error(
          "--round 0 is the scope gate, which runs BEFORE a plan exists; it takes --oracle, not --plan. " +
            "If a plan is written, this is round 1 or later.",
        );
      }
      if (!flags.oracle) throw new Error("--round 0 needs --oracle <file>: the scope gate reviews the intent, and the intent is all it gets.");
    } else {
      if (!flags.plan) throw new Error(`--round ${round} needs --plan <file>`);
      planPath = path.relative(root, path.resolve(root, flags.plan));
      const abs = path.join(root, planPath);
      if (!fs.existsSync(abs)) throw new Error(`--plan ${flags.plan} does not exist at ${abs}`);
      // After the path is known, so the ignore can be verified against THIS
      // plan rather than against a pattern that looks convincing.
      ensurePlansIgnored(root, planPath, git);
      planText = fs.readFileSync(abs, "utf8");
    }
    // THE ORACLE IS AS SENSITIVE AS THE PLAN, and until now only the plan was
    // protected. `ensurePlansIgnored` runs on the plan alone, so a standalone
    // `--oracle` file at an ordinary path -- `scope-oracle.md`, say -- was
    // staged by the next `git add -A`. Round 0 is the worst case because the
    // oracle is the ONLY document that exists then, but the hole is not
    // round-0-specific: `--oracle` is read on every round (Codex, #69 round 7,
    // which reported the round-0 case; the sweep found the rest).
    //
    // The agreed scope is exactly where an unpatched vulnerability, an
    // auth-bypass specific, a customer name or an embargoed launch gets
    // written down -- it is the same material the disclosure carve-out
    // protects, one document earlier. Refused rather than relocated: moving a
    // file the operator named would be a surprise, and the fix is one `git
    // mv` they should make deliberately.
    let oraclePath = null;
    if (flags.oracle) {
      oraclePath = path.relative(root, path.resolve(root, flags.oracle));
      assertOracleIgnored(root, oraclePath, git);
    }
    const oracleText = flags.oracle ? fs.readFileSync(path.join(root, oraclePath), "utf8") : null;
    const oracle = oracleFrom({ oracleText, planText });

    // --- slug -------------------------------------------------------------
    const slug = flags.slug ? assertSlug(flags.slug) : slugFromPlanPath(planPath ?? "");
    const dir = ensureRoundDir(root, slug);
    const earlier = roundsRun(dir).filter((n) => n !== round);

    // --- the oracle, pinned for the life of the loop -----------------------
    const pin = pinOracle(dir, oracle, { changedReason: flags.oracleChanged ?? null });

    // --- budget -----------------------------------------------------------
    // Counted from the round files, never stored. The PR-keyed budget guard
    // cannot run without a PR, so if this did not enforce the cap the cap
    // would be prose (Codex, #69 round 1).
    let budget = null;
    if (round >= 1) {
      if (!flags.tier) {
        throw new Error(
          `--tier is required from round 1 (${TIERS.join(" | ")}). The plan loop takes the tier of what it plans, ` +
            `and the tier is the round budget: ${TIERS.map((t) => `${t} ${TIER_BUDGETS[t]}`).join(", ")}.`,
        );
      }
      if (!TIERS.includes(flags.tier)) throw new Error(`--tier must be one of ${TIERS.join(", ")}`);
      // THE TIER IS PINNED BY THE FIRST ROUND THAT SET ONE. It decides both
      // the round budget and the adjudicator's rubric, so a changed flag on a
      // later round silently buys rounds the loop was never granted: an
      // internal loop three rounds deep, invoked once with `--tier product`,
      // recomputes its allowance as five and proceeds without any grant
      // (Codex, #69 round 8). Every round already stamps its tier on the
      // meta, so the pin costs a read rather than new state.
      //
      // This is NOT the driver-as-adversary class declined in round 2 — the
      // failure here is a typo'd flag on a long command, and the loop driver
      // gains nothing by it. It is the same shape as the oracle pin: a value
      // agreed once, then read rather than re-supplied.
      assertTierPinned(dir, earlier, flags.tier);

      const grants = readGrants(dir);
      const allowance = allowanceFor(flags.tier, grants);
      if (round > allowance) {
        throw new Error(
          `round ${round} is past this loop's allowance of ${allowance} (tier ${flags.tier}, budget ` +
            `${TIER_BUDGETS[flags.tier]}${grants.length ? `, ${grants.length} recorded grant(s)` : ""}). ` +
            `At the budget the adjudicator owns the extension and may self-serve as far as round ` +
            `${TIER_BUDGETS[flags.tier] + LEASH}; past that the grant is David's. Record it in ` +
            `${path.relative(root, path.join(dir, "extensions.json"))} as ` +
            `{"grant": <rounds>, "asOf": ${earlier.filter((n) => n >= 1).length}, "kind": "adjudicator"|"david", "reason": "<the risk it covers>"}.`,
        );
      }
      budget = { tier: flags.tier, cap: TIER_BUDGETS[flags.tier], allowance, grants };
    }

    // --- prior findings ---------------------------------------------------
    let priors = [];
    if (flags.prior && flags.noPrior) throw new Error("--prior and --no-prior contradict each other");
    if (flags.prior) {
      // The prior file carries finding titles and disposition notes, which
      // restate the plan's concerns -- so it can hold the same vulnerability,
      // customer or embargoed context the plan and oracle are protected for.
      // It was the third input with no ignore check (Codex, #69 round 8).
      const priorPath = path.relative(root, path.resolve(root, flags.prior));
      assertOracleIgnored(root, priorPath, git);
      priors = normalizePriors(JSON.parse(fs.readFileSync(path.join(root, priorPath), "utf8")));
      assertPriorsCoverLastRound(dir, earlier, priors);
    } else if (earlier.length && !flags.noPrior) {
      // The stop rule is "required_revisions empty AND every prior finding
      // Resolved or Superseded". A round that never saw the prior findings
      // cannot satisfy the second half, and would report a clean sheet it has
      // no basis for. So this is a refusal with an explicit escape.
      //
      // Keyed to "an earlier round exists", not to "round >= 2" (Codex, #69
      // round 1): round 0's scope concerns are findings like any other, and
      // the round-2 form let round 1 silently drop every one of them.
      throw new Error(
        `round ${round} needs --prior <file>: round(s) ${earlier.join(", ")} already ran for this plan, and their ` +
          `findings have to be reconciled. A JSON array of {id, title, disposition, note?} with disposition one of ` +
          `${DISPOSITIONS.join(" | ")}. Pass --no-prior only when those rounds genuinely returned none — the stop ` +
          `rule depends on the reviewer reconciling them, so silently dropping them would fake convergence.`,
      );
    }

    // --- the rest ---------------------------------------------------------
    const lens = flags.lens ? flags.lens.trim().replace(/\s+/g, " ").slice(0, MAX_LENS_CHARS) : null;
    const inventory = planText ? extractFenced(planText, "affected-files") : null;
    const contract = readContract(root);
    // The reviewer's identity is a settled decision, so departing from it is an
    // explicit, recorded act rather than a flag nobody notices (Codex, #69
    // round 1). Left open, a "normal" invocation could quietly substitute a
    // weaker reviewer, or hand the reviewer write access to the live checkout
    // -- defeating the two things this design is FOR.
    const overrides = ["model", "effort", "sandbox"].filter((k) => flags[k] != null);
    if (overrides.length && !flags.unpinned) {
      throw new Error(
        `--${overrides.join(", --")} would depart from the settled reviewer (${DEFAULT_MODEL}, ${DEFAULT_EFFORT}, ` +
          `${DEFAULT_SANDBOX}). Pass --unpinned "<why>" to do it deliberately; the reason is stamped on the round, ` +
          `so a loop run against a weaker reviewer says so.`,
      );
    }
    const model = flags.model ?? DEFAULT_MODEL;
    const effort = flags.effort ?? DEFAULT_EFFORT;
    const sandbox = flags.sandbox ?? DEFAULT_SANDBOX;
    if (!SANDBOXES.includes(sandbox)) throw new Error(`--sandbox must be one of ${SANDBOXES.join(", ")}`);
    if (sandbox === "danger-full-access") {
      throw new Error(
        `--sandbox danger-full-access is refused, with or without --unpinned. The reviewer reads; nothing it does ` +
          `needs to escape a sandbox. If it must run the suite, that is workspace-write on a scratch checkout.`,
      );
    }
    const timeoutMs = Number(flags.timeout ?? 2700) * 1000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(`--timeout must be a positive number of seconds`);

    const schema = schemaFor(round);
    assertSchemaSupported(schema);

    const outJson = path.join(dir, `round-${round}.json`);
    if (fs.existsSync(outJson)) {
      if (!flags.force) {
        throw new Error(`${path.relative(root, outJson)} already exists. Pass --force to re-run it, or use the next round number.`);
      }
      // Discarded BEFORE the attempt, not overwritten after it. A forced
      // re-run that then fails would otherwise leave the old accepted JSON at
      // the canonical path, describing an earlier plan revision while the log
      // says the round did not happen (Codex, #69 round 1).
      if (!flags.dryRun) {
        for (const stale of [outJson, `${dir}/round-${round}.meta.json`, `${dir}/round-${round}.last-message.txt`]) {
          fs.rmSync(stale, { force: true });
        }
      }
    }

    const promptFile = path.join(dir, `round-${round}.prompt.md`);
    const schemaFile = path.join(dir, `round-${round}.schema.json`);
    const lastMessage = path.join(dir, `round-${round}.last-message.txt`);
    const metaFile = path.join(dir, `round-${round}.meta.json`);

    const promptParts = { round, lens, priors, inventory, oracle, planPath, contractPath: contract.path };
    const prompt = assemblePrompt(promptParts);
    fs.writeFileSync(promptFile, `${prompt}\n`);
    fs.writeFileSync(schemaFile, `${JSON.stringify(schema, null, 2)}\n`);

    if (flags.dryRun) {
      log(
        `plan-review: dry run — nothing spawned.\n` +
          `  prompt  ${path.relative(root, promptFile)} (${prompt.length} chars)\n` +
          `  schema  ${path.relative(root, schemaFile)}\n` +
          `  oracle  ${oracle.length} chars${pin.firstPin ? " (pinned now)" : pin.changed ? " (CHANGED, recorded)" : " (matches the pin)"}\n` +
          `  priors  ${priors.length}\n` +
          (budget ? `  budget  round ${round} of ${budget.allowance} (tier ${budget.tier})\n` : ""),
      );
      pin.commit();
      return 0;
    }

    // --- sign-in ----------------------------------------------------------
    const status = signInStatus({ run });
    if (!status.signedIn) {
      log(
        status.missingBinary
          ? `plan-review: no \`codex\` binary (set CODEX_BIN, or npm install @openai/codex).\n\n${SIGN_IN_INSTRUCTIONS}`
          : `plan-review: ${SIGN_IN_INSTRUCTIONS}\n\n  codex login status said: ${status.detail}`,
      );
      return 2;
    }

    // --- the round, and one re-ask ---------------------------------------
    const attempts = [];
    let assessment = null;
    let text = null;
    for (let attempt = 1; attempt <= 2 && assessment === null; attempt++) {
      if (fs.existsSync(lastMessage)) fs.rmSync(lastMessage);
      const thisPrompt =
        attempt === 1
          ? prompt
          : assemblePrompt({ ...promptParts, reaskErrors: attempts[0].problems, previousOutput: text });
      if (attempt === 2) fs.writeFileSync(promptFile.replace(/\.md$/, ".reask.md"), `${thisPrompt}\n`);

      log(`plan-review: round ${round} on ${model} (${effort}, ${sandbox})${attempt === 2 ? " — re-ask" : ""}…`);
      const outcome = runCodex({ prompt: thisPrompt, schemaFile, outFile: lastMessage, model, effort, sandbox, cwd: root, timeoutMs, run });

      let problems;
      let executionFailed = false;
      if (outcome.error || outcome.status !== 0) {
        executionFailed = true;
        problems = [
          `codex exec exited ${outcome.status ?? "(no status)"}${outcome.signal ? ` on signal ${outcome.signal}` : ""}` +
            `${outcome.error ? `: ${outcome.error.message}` : ""}`,
        ];
        text = null;
      } else {
        text = fs.existsSync(lastMessage) ? fs.readFileSync(lastMessage, "utf8") : null;
        try {
          const parsed = parseAssessment(text);
          problems = validate(parsed, schema);
          // Reconciliation sits on the same footing as the schema: a round
          // that dropped a prior is not a valid round, and the re-ask names
          // exactly which ids went missing.
          if (problems.length === 0) problems = reconciliationProblems(parsed, priors);
          if (problems.length === 0) assessment = parsed;
        } catch (err) {
          problems = [err.message];
        }
      }
      attempts.push({ attempt, seconds: outcome.seconds, status: outcome.status ?? null, problems });
      if (problems.length) log(`plan-review: attempt ${attempt} rejected —\n  ${problems.join("\n  ")}`);
      // The re-ask exists to fix a malformed ANSWER. A reviewer that crashed
      // or timed out gave none, so re-asking spends another full timeout on
      // the same failure and tells the reviewer to correct output that does
      // not exist (Codex, #69 round 2). One execution failure ends the round.
      if (executionFailed) break;
    }

    // --- the plan must not have moved under the reviewer ------------------
    //
    // A round runs ~9-10 minutes DETACHED, and the working tree stays
    // editable for every second of it: David interjects, I fix something he
    // raised, an editor writes. The reviewer reads the plan by its LIVE PATH,
    // so what it actually reviewed is whatever the file said while it was
    // reading -- while `planSha256` below is computed from the bytes captured
    // before `codex exec` started.
    //
    // That digest is not decoration. With no commit and no PR page holding
    // the approved revision, it is the ONLY thing pinning which text David
    // approved once it reaches an implementation PR's `private-plan` block.
    // If the file moved, the digest names a document the assessment does not
    // describe, and the pin silently certifies the wrong bytes.
    //
    // So a moved plan REFUSES the round rather than reconciling it. Nothing
    // here can know which half of a mid-flight edit the reviewer saw, and a
    // round nobody can locate in time is not evidence about any version of
    // the plan. Re-run it; the reviewer's context is fresh every round
    // anyway, so nothing is lost but the wall clock.
    let planDrift = null;
    if (planText !== null) {
      const abs = path.join(root, planPath);
      const after = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
      if (after === null) planDrift = { before: sha256(planText), after: null, gone: true };
      else if (after !== planText) planDrift = { before: sha256(planText), after: sha256(after), gone: false };
    }

    const meta = {
      slug,
      round,
      model,
      effort,
      sandbox,
      lens,
      plan: planPath,
      planDrift,
      planDigest: planText ? sha256(planText) : null,
      // The FULL digest, because it leaves this file and goes into the
      // implementation PR's `private-plan` provenance block. With no commit
      // and no PR page holding the approved revision, this is the only thing
      // that pins WHICH text David approved.
      planSha256: planText ? sha256Full(planText) : null,
      oracleDigest: sha256(oracle),
      contract: contract.path,
      contractDigest: sha256(contract.text),
      promptDigest: sha256(prompt),
      priorFindings: priors.map((p) => ({ id: p.id, disposition: p.disposition })),
      budget,
      oraclePin: { pinned: pin.pinned, changed: pin.changed, firstPin: pin.firstPin, changedReason: pin.changedReason ?? null },
      // Present only when the round departed from the settled reviewer, so its
      // absence is the ordinary case and its presence is loud.
      unpinned: flags.unpinned ?? null,
      attempts,
      finishedAt: new Date().toISOString(),
      accepted: assessment !== null && planDrift === null,
      convergence: assessment && planDrift === null ? convergence(assessment, priors) : null,
    };
    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);

    if (planDrift) {
      log(
        `plan-review: ${planPath} ${planDrift.gone ? "was deleted" : "changed"} while round ${round} was running ` +
          `(${planDrift.before} -> ${planDrift.after ?? "gone"}). The reviewer read the file live, so this ` +
          `assessment describes bytes that no longer exist and the digest that would pin it names a different ` +
          `document. This round did not happen — do not count it and do not summarise it to David. Re-run the ` +
          `round against the plan as it now stands. The attempt record is at ${path.relative(root, metaFile)}.`,
      );
      return 1;
    }

    if (assessment === null) {
      log(
        `plan-review: round ${round} produced no schema-valid assessment after a re-ask. ` +
          `The reviewer's raw output is at ${path.relative(root, lastMessage)} and the attempt record at ` +
          `${path.relative(root, metaFile)}. This round did not happen — do not count it, and do not summarise ` +
          `an unvalidated document to David as a review.`,
      );
      return 1;
    }

    fs.writeFileSync(outJson, `${JSON.stringify(assessment, null, 2)}\n`);
    pin.commit();
    const counted = round === 0 ? assessment.scope_concerns.length : assessment.required_revisions.length;
    const label = round === 0 ? "scope concerns" : "required";
    const { converged, reasons } = meta.convergence;
    log(
      `plan-review: ${path.relative(root, outJson)}\n` +
        `  status    ${assessment.review_status}\n` +
        `  ${label.padEnd(9)} ${counted}\n` +
        `  seconds   ${attempts.map((a) => Math.round(a.seconds)).join(" + ")}\n` +
        (budget ? `  budget    round ${round} of ${budget.allowance} (tier ${budget.tier})\n` : "") +
        `  ${converged ? "CONVERGED — the stop rule is met" : `not converged: ${reasons.join("; ")}`}\n`,
    );
    process.stdout.write(`${path.relative(root, outJson)}\n`);
    return 0;
  } catch (err) {
    log(`plan-review: ${err.message}`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exit(main());

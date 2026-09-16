#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * The small shared module: this repository's machinery configuration, and the
 * dependency-free schema validator both dispatched roles answer through.
 *
 * WHY IT EXISTS. Until the #89 cut these helpers lived inside
 * `review-budget.mjs`, so every script that needed to know which repository it
 * was in imported the review-round budget to find out. When the budget was
 * removed the helpers had no home, and fourteen import sites pointed at a file
 * that was leaving. They are neutral — they decide nothing about a review loop
 * — so they became their own module rather than being rehoused in whichever
 * surviving script happened to be largest.
 *
 * WHAT BELONGS HERE. Two things, and they share the property of being read by
 * more than one caller while deciding nothing on their own: the configuration
 * every script needs to name its repository and resolve a model tier, and the
 * validator every structured answer is checked against. Nothing that rules on
 * a finding, counts a round, or gates a merge — that machinery is gone, and
 * this module is not where it grows back.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MACHINERY_CONFIG_FILE = ".agents/machinery.json";

/**
 * The root of the repository this machinery governs: the nearest enclosing
 * directory that declares a machinery configuration.
 *
 * WHY NOT `dirname(script)/..`, WHICH THIS REPLACES. That form assumes the
 * scripts sit exactly one level below the root. True in a consumer, where the
 * sync lands them at `<repo>/scripts/`; false in the handbook, where they are
 * payload at `<repo>/core/scripts/` and `..` is `core/`. So the handbook read
 * a configuration that is not there -- `core/.agents/machinery.json` does not
 * exist -- and wrote its artifacts INSIDE its own payload, where a sync would
 * carry one repository's history to every other.
 *
 * THE MARKER IS THE CONFIGURATION ITSELF, because "which root?" and "whose
 * configuration?" have to have one answer. Any other marker can disagree with
 * the file that declares identity, and a root disagreeing with its own
 * configuration is the bug being replaced, not a variant of it.
 *
 * BOUNDED BY THE ENCLOSING REPOSITORY. The walk stops at a `.git`, so a
 * checkout that declares nothing fails closed with `machineryConfig`'s own
 * message instead of silently binding to a PARENT directory's configuration
 * -- a wrong-repo mistake in its most confusing form, since every artifact
 * would then be stamped with a repository the operator never chose.
 *
 * TOTAL BY CONSTRUCTION: it cannot throw. `existsSync` reports false rather
 * than raising, and an unfound marker falls back to the previous resolution,
 * so an unconfigured checkout behaves exactly as it did and fails with the
 * same message.
 *
 * A CONSUMER SEES NO CHANGE. From `<repo>/scripts`, the first directory up
 * carrying `.agents/machinery.json` is `<repo>` -- the answer `..` gave.
 */
export function findRepoRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, MACHINERY_CONFIG_FILE))) return dir;
    if (fs.existsSync(path.join(dir, ".git"))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = findRepoRoot(SCRIPT_DIR) ?? path.resolve(SCRIPT_DIR, "..");

export const MACHINERY_CONFIG_HOWTO =
  `Commit ${MACHINERY_CONFIG_FILE} declaring this repository's machinery configuration. Shape: ` +
  `{"repo": "owner/name", "models": {"strongestClaude": {"id": "<full model id>", "effort": "<level>"}, ...}}.`;

const SLUG_RE = /^[^/\s]+\/[^/\s]+$/;

// The exact value `machinery.template.json` ships. Compared EXACTLY, not
// case-folded: "Owner/Repo" is a plausible real repository name, and a check
// that rejected it would refuse a legitimate consumer to catch an edit
// nobody makes -- changing the placeholder's case while leaving its letters.
const PLACEHOLDER_SLUG = "OWNER/REPO";

// Memoized per root: a checkout's configuration cannot change inside one
// process, and this is read on paths that run per command.
const CONFIG_CACHE = new Map();

/**
 * The minimal reader `machineryConfig` needs, injectable so a test can supply
 * a configuration without touching the filesystem.
 *
 * DELIBERATELY SMALLER THAN THE ADAPTER IT REPLACES. `review-budget.mjs`'s
 * `nodeIo` carried exclusive-create claims, a receipts lister and a git-ref
 * reader, all for the budget guard. None of that has a caller now, so none of
 * it moved: what is left is a repo-relative read and the root it resolves
 * against.
 *
 * `read` returns null ONLY for ENOENT. A permissions or I/O fault throws, so
 * an unreadable configuration is never collapsed into "absent" -- which would
 * turn a broken checkout into an unconfigured one and lose the real reason.
 */
export function nodeIo(root = REPO_ROOT) {
  return {
    root,
    read(rel) {
      try {
        return fs.readFileSync(path.join(root, rel), "utf8");
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    },
  };
}

/**
 * This repository's declared identity, read from the working tree.
 *
 * THE THREAT MODEL IS MY OWN MISTAKES, NOT AN ADVERSARY. Ten review rounds on
 * PR #7 moved this read from the working tree to the durable ref to the base
 * commit and back, each time defending against an actor who can edit files in
 * this checkout -- who is the person running the script. That actor needs no
 * exploit; it can simply not run the script. The controls against deliberate
 * action are the server-side rulesets and David working alongside, reading the
 * latitude line every authority-widening PR carries, and no local script can
 * add to them. What this read has to do is catch a MISTAKE: running in the
 * wrong checkout, or running with the seed placeholder still in place. It does
 * that by failing closed on absent, malformed, or placeholder, and by being
 * the ONE place identity is read.
 * (`.agents/memory/machinery-threat-model-is-my-own-mistakes.md`.)
 */
export function machineryConfig(io = nodeIo()) {
  const key = io.root ?? "";
  if (!CONFIG_CACHE.has(key)) {
    const raw = io.read(MACHINERY_CONFIG_FILE);
    if (raw === null) {
      throw new Error(
        `${MACHINERY_CONFIG_FILE} is missing, so this checkout cannot say which repository it is. ` +
          MACHINERY_CONFIG_HOWTO,
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`${MACHINERY_CONFIG_FILE} is not valid JSON. ${MACHINERY_CONFIG_HOWTO}`);
    }
    const repo = typeof parsed?.repo === "string" ? parsed.repo.trim() : "";
    if (!SLUG_RE.test(repo)) {
      throw new Error(`${MACHINERY_CONFIG_FILE} must declare "repo" as "owner/name". ${MACHINERY_CONFIG_HOWTO}`);
    }
    // The seed's placeholder is SHAPED like an identity, so every structural
    // check passed it and an unedited template produced a working config
    // naming a repository that does not exist. (Codex, PR #7 round 6.)
    if (repo === PLACEHOLDER_SLUG) {
      throw new Error(
        `${MACHINERY_CONFIG_FILE} still carries the template's placeholder "${repo}". Replace it with ` +
          `this repository's real owner/name -- the seed is a form to fill in, not a default.`,
      );
    }
    CONFIG_CACHE.set(key, { repo, models: parsed?.models ?? null });
  }
  return CONFIG_CACHE.get(key);
}

/**
 * The model a TIER resolves to, and the effort it runs at.
 *
 * "Fable" and "Astra" name the strongest model from each family, not a
 * version (David, 2026-09-11). Every role definition and every reviewer pin
 * names a tier; this is the one place a tier becomes an id, so a new model
 * release is a one-value edit rather than a sweep through definitions,
 * scripts and documents.
 *
 * A FULL ID, NEVER AN ALIAS, and the refusal is the same one the role
 * definitions used to carry: a dispatch stamps the id it asked for against
 * the id that answered, and `fable` compared to `claude-fable-5-1` establishes
 * nothing. Moving the id into configuration moves that check here; it does not
 * remove it.
 *
 * Fails closed on every shape: no block, no tier, no id, an alias-shaped id.
 * The alternative is a dispatch that silently runs on whatever the provider
 * picks, which is precisely the "probably ran on 5.1" this check exists to
 * replace with an observation.
 */
export const MODEL_TIERS = ["strongestClaude", "strongestCodex"];

const FULL_MODEL_ID = /^[a-z][a-z0-9.]*(-[a-z0-9.]+)+$/;

export function modelTier(tier, io = nodeIo()) {
  const { models } = machineryConfig(io);
  if (!models || typeof models !== "object") {
    throw new Error(
      `${MACHINERY_CONFIG_FILE} declares no "models" block, so the tier "${tier}" cannot be resolved to a ` +
        `model id. Add it: {"models": {"strongestClaude": {"id": "<full model id>", "effort": "<level>"}, ` +
        `"strongestCodex": {"id": "<full model id>", "effort": "<level>"}}}.`,
    );
  }
  const entry = models[tier];
  if (!entry || typeof entry !== "object") {
    throw new Error(
      `${MACHINERY_CONFIG_FILE}'s "models" block declares no "${tier}". Known tiers: ${MODEL_TIERS.join(", ")}.`,
    );
  }
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  if (!id) throw new Error(`${MACHINERY_CONFIG_FILE}'s models.${tier} declares no "id"`);
  if (!FULL_MODEL_ID.test(id)) {
    throw new Error(
      `${MACHINERY_CONFIG_FILE}'s models.${tier}.id is ${JSON.stringify(id)}, which is an alias or an ` +
        `unrecognised id. A dispatch stamps the model it asked for against the model that answered, and an ` +
        `alias cannot be compared -- "it ran on the strongest tier" would be probably-true and never ` +
        `established. Declare a full model id (for example claude-fable-5-1, or gpt-6-astra).`,
    );
  }
  const effort = typeof entry.effort === "string" ? entry.effort.trim() : "";
  if (!effort) throw new Error(`${MACHINERY_CONFIG_FILE}'s models.${tier} declares no "effort"`);
  return { tier, id, effort };
}

export function repoSlug(io = nodeIo()) {
  return machineryConfig(io).repo;
}

/** Test seam: forget any parsed configuration. Never called in production. */
export function __resetRepoSlugCache() {
  CONFIG_CACHE.clear();
}

// ---------------------------------------------------------------------------
// The answer validator, shared by every dispatched role
// ---------------------------------------------------------------------------

/**
 * Validate a parsed value against the subset of JSON Schema these schemas use.
 *
 * Dependency-free on purpose: this repo installs nothing, and a validator that
 * needs `npm install` is a validator that does not run on a fresh container.
 * The subset is exactly what the role schemas express -- object, array,
 * string, number, boolean, required, additionalProperties:false, enum, items,
 * properties. A keyword outside it would silently pass, so
 * `assertSchemaSupported` refuses a schema this validator cannot actually
 * enforce rather than pretending.
 *
 * SHARED, BUT ONLY THE SHAPE. It locks how an answer is checked, never what
 * the answer may say: each role keeps its own schema and its own semantic
 * checks. Moving policy in here would make one edit change every role's
 * meaning at once.
 */
export function validate(value, schema, at = "$") {
  const problems = [];
  const say = (msg) => problems.push(`${at}: ${msg}`);

  if (schema.enum && !schema.enum.includes(value)) {
    say(`${JSON.stringify(value)} is not one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
    return problems;
  }

  // A UNION TYPE -- `"type": ["string", "null"]` -- means "any one of these".
  // `could_not_assess` has been declared that way since the role was written,
  // and until this was added the switch below fell through to "unsupported
  // type" on EVERY answer: the schema was never satisfiable, which nothing
  // noticed because no surviving caller validated against it. Recorded rather
  // than quietly fixed, because "a check nothing runs" is the class this
  // repository keeps paying for.
  if (Array.isArray(schema.type)) {
    const { type, ...rest } = schema;
    const attempts = type.map((t) => validate(value, { ...rest, type: t }, at));
    if (attempts.some((a) => a.length === 0)) return [];
    say(`matched none of the permitted types ${type.map((t) => JSON.stringify(t)).join(", ")}`);
    return problems;
  }

  switch (schema.type) {
    case "null":
      if (value !== null) say(`expected null, got ${describe(value)}`);
      return problems;
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
      if (typeof value !== "string") {
        say(`expected a string, got ${describe(value)}`);
        return problems;
      }
      // `minLength` exists in these schemas for exactly one reason: a field the
      // model must actually fill. An empty string satisfies "type": "string"
      // and satisfies nothing a reader wants, so the keyword is enforced here
      // rather than being sent to the model and ignored -- which is the state
      // `assertSchemaSupported` refuses, and which the round-translation schema
      // was quietly in until this was added.
      if (typeof schema.minLength === "number" && value.length < schema.minLength) {
        say(`is ${value.length} character(s) long, and at least ${schema.minLength} is required`);
      }
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
const SUPPORTED_KEYWORDS = new Set([
  "type",
  "required",
  "additionalProperties",
  "properties",
  "items",
  "enum",
  "description",
  "minLength",
]);

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

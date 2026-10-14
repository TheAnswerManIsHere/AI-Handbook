// The map tool's integration suite: handbook-only, never shipped.
//
// It builds a synthetic consumer with REAL pinned dependencies (the compiler
// and the type declarations of the libraries the supported-form matrix names),
// delivers the payload to it with the REAL sync, completes its seeds, and runs
// the delivered scripts/map.mjs and scripts/map-eval.mjs there. Every
// behaviour the plan's Definition of Done names is exercised here:
// docs/plans/PLAN_AGENT_LEGIBLE_CODEBASE_TOOL.md.
//
// It REFUSES, rather than skipping, without its dependencies: a control that
// cannot evaluate must refuse (CLAUDE.md, *The guard is gone*). The Test job
// installs them; locally, the failure message prints the one install command.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sync } from "../sync.mjs";

const HANDBOOK = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PINS = JSON.parse(readFileSync(join(HANDBOOK, "scripts/__tests__/map-test-deps.json"), "utf8")).packages;
const SPECS = Object.entries(PINS).map(([k, v]) => `${k}@${v}`).join(" ");
const DEPS = process.env.MAP_TEST_DEPS;
const READY = DEPS && existsSync(join(DEPS, "typescript", "package.json"));

if (!READY) {
  test("the map integration suite has its pinned dependencies", () => {
    assert.fail(
      "MAP_TEST_DEPS must name a node_modules directory holding the pinned test dependencies.\n" +
        `In an empty directory OUTSIDE this checkout run:\n  npm init -y && npm install --no-audit --no-fund --ignore-scripts ${SPECS}\n` +
        "then export MAP_TEST_DEPS=<that directory>/node_modules and re-run. The Test job does this in CI.",
    );
  });
} else {
  suite();
}

function suite() {
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const write = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  const read = (root, rel) => readFileSync(join(root, rel), "utf8");
  const json = (root, rel) => JSON.parse(read(root, rel));
  const setJson = (root, rel, fn) => { const v = json(root, rel); fn(v); write(root, rel, JSON.stringify(v, null, 2) + "\n"); };
  // The real sync function, delivering the working tree's payload (as sync.test.mjs does),
  // so the suite runs before a commit as well as in CI.
  const deliver = (root) => { const lines = []; sync(root, { log: (l) => lines.push(l), payloadRoot: join(HANDBOOK, "core") }); return lines.join("\n"); };
  const commitAll = (root, msg = "x") => { git(root, "add", "-A"); git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", msg, "--allow-empty"); };

  /** Run a delivered script inside the consumer. */
  const run = (root, script, args, env = {}) => {
    const r = spawnSync(process.execPath, [join(root, "scripts", script), ...args], { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
    return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
  };
  const map = (root, ...args) => run(root, "map.mjs", args);
  const mapJson = (root, ...args) => { const r = map(root, ...args, "--json"); assert.equal(r.code, 0, r.all); return JSON.parse(r.out); };

  /** node_modules: a real directory of links into the pinned install, plus the workspace link. */
  const linkModules = (root) => {
    const nm = join(root, "node_modules");
    mkdirSync(nm, { recursive: true });
    for (const e of readdirSync(DEPS)) if (!e.startsWith(".")) symlinkSync(join(DEPS, e), join(nm, e));
    mkdirSync(join(nm, "@workspace"), { recursive: true });
    // Relative, as a package manager writes it: an absolute link would follow a
    // copied repository back to the original, outside the copy's own root.
    symlinkSync(join("..", "..", "packages", "lib"), join(nm, "@workspace", "lib"));
  };

  const H = (purpose, subsystem) => `/**\n * @purpose ${purpose}\n * @subsystem ${subsystem}\n */\n`;
  const FIXTURE = {
    ".gitignore": "node_modules\n",
    "package.json": JSON.stringify({ name: "fixture", private: true, type: "module" }),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "README.md": "# fixture\n",
    "tsconfig.base.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: false, skipLibCheck: true, jsx: "react-jsx", types: [] } }),
    "packages/lib/package.json": JSON.stringify({ name: "@workspace/lib", type: "module", exports: { ".": "./src/index.ts" } }),
    "packages/lib/tsconfig.json": JSON.stringify({ extends: "../../tsconfig.base.json", include: ["src"] }),
    "packages/lib/src/brandTokens.ts": H("Brand colour tokens shared by every surface.", "design") + 'export const BRAND_ORANGE = "#ff6b00";\n',
    "packages/lib/src/schema.ts": H("Drizzle table declarations.", "data") +
      'import { pgTable, text, serial } from "drizzle-orm/pg-core";\n' +
      'export const factsTable = pgTable("facts", { id: serial("id").primaryKey(), body: text("body") });\n' +
      'export const usersTable = pgTable("users", { id: serial("id").primaryKey() });\n',
    // Codegen-owned barrel: no header, re-exports by name (the shape whose broken export errors only here).
    "packages/lib/src/index.ts": 'export { BRAND_ORANGE } from "./brandTokens";\nexport { factsTable, usersTable } from "./schema";\n',
    "packages/server/package.json": JSON.stringify({ name: "@workspace/server", type: "module" }),
    "packages/server/tsconfig.json": JSON.stringify({ extends: "../../tsconfig.base.json", compilerOptions: { types: ["node"] }, include: ["src"] }),
    "packages/server/src/app.ts": H("The Express application and its top-level mounts.", "http") +
      'import express from "express";\nimport router from "./routes/index";\n' +
      "export const app = express();\n" +
      'app.post("/api/stripe/webhook", (req, res) => { res.sendStatus(200); });\n' +
      'app.use("/api", router);\n',
    "packages/server/src/routes/index.ts": H("Mounts every feature router.", "http") +
      'import { Router } from "express";\nimport factsRouter from "./facts";\nconst router = Router();\nrouter.use(factsRouter);\nexport default router;\n',
    "packages/server/src/routes/facts.ts": H("Fact routes.", "http") +
      'import { Router } from "express";\nimport { getFact } from "../lib/handlers";\n' +
      "const router = Router();\n" +
      'router.get("/facts/:id", getFact);\n' +
      "const computed = String(Date.now());\nrouter.get(computed, getFact);\n" +
      "export default router;\n",
    "packages/server/src/lib/handlers.ts": H("Request handlers for facts.", "http") +
      'import type { Request, Response } from "express";\n' +
      "export function getFact(req: Request, res: Response) { res.json({ id: req.params.id }); }\n",
    "packages/server/src/lib/db.ts": H("Database access in every supported form.", "data") +
      'import { drizzle } from "drizzle-orm/node-postgres";\nimport { sql, eq } from "drizzle-orm";\nimport { Pool, Client } from "pg";\n' +
      'import { factsTable } from "@workspace/lib";\n' +
      "const pool = new Pool();\nexport const db = drizzle(pool);\n" +
      "export async function typed() { return db.select().from(factsTable).where(eq(factsTable.id, 1)); }\n" +
      "export async function tagged() { return db.execute(sql`SELECT * FROM users`); }\n" +
      "export async function interpolatedTable() { return db.execute(sql`SELECT * FROM ${factsTable}`); }\n" +
      "const source = new Client();\n" +
      "const STATEMENT = `SELECT id FROM facts WHERE body = $1`;\n" +
      'export async function locallyBound() { return source.query(STATEMENT, ["x"]); }\n' +
      'export async function external() { return source.query("SELECT * FROM stripe.products"); }\n' +
      "export async function dynamic(tableName: string) { return source.query(`SELECT * FROM ${tableName}`); }\n" +
      'export async function unresolvedReceiver(thing: any) { return thing.query("SELECT * FROM users"); }\n',
    "packages/web/package.json": JSON.stringify({ name: "@workspace/web", type: "module" }),
    "packages/web/tsconfig.json": JSON.stringify({ extends: "../../tsconfig.base.json", compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } }, include: ["src"], exclude: ["**/*.test.ts"] }),
    "packages/web/src/App.tsx": H("Client routes.", "web") +
      'import { Route, Switch } from "wouter";\nimport Profile from "@/pages/Profile";\n' +
      'export function App() { return (<Switch><Route path="/profile" component={Profile} /></Switch>); }\n',
    "packages/web/src/pages/Profile.tsx": H("The profile page.", "web") +
      'import { BRAND_ORANGE } from "@workspace/lib";\nimport { shout } from "@/lib/util";\n' +
      'export default function Profile() { return <div style={{ color: BRAND_ORANGE }}>{shout("hi")}</div>; }\n',
    "packages/web/src/lib/util.ts": H("String helpers.", "web") + "export function shout(s: string) { return s.toUpperCase(); }\n",
    "packages/web/src/lib/util.test.ts": 'import { shout } from "./util";\nshout("x");\n',
    "worker/tsconfig.json": JSON.stringify({ extends: "../tsconfig.base.json", compilerOptions: { types: ["node"] }, include: ["src"] }),
    "worker/src/index.ts": H("Edge routing.", "edge") +
      "const OG_RE = /^\\/og\\/(\\w+)$/;\n" +
      "export default {\n  async fetch(request: Request): Promise<Response> {\n    const url = new URL(request.url);\n" +
      '    if (OG_RE.test(url.pathname)) return new Response("og");\n' +
      '    if (url.pathname.startsWith("/share/")) return new Response("share");\n' +
      "    return fetch(request);\n  },\n};\n",
    "scripts/tool.mjs": "// @purpose A consumer-owned tooling script.\n// @subsystem tooling\n" +
      'import { BRAND_ORANGE } from "@workspace/lib";\nconsole.log(BRAND_ORANGE);\n',
  };

  const ADOPTED = {
    config: {
      adopted: true, enabled: true,
      programs: [
        { tsconfig: "packages/lib/tsconfig.json" },
        { tsconfig: "packages/server/tsconfig.json" },
        { tsconfig: "packages/web/tsconfig.json" },
        { tsconfig: "worker/tsconfig.json" },
        { name: "web-tests", extends: "packages/web/tsconfig.json", roots: ["packages/web/src/**/*.test.ts"] },
        { name: "tooling", roots: ["scripts/tool.mjs", "scripts/machinery.mjs"], compilerOptions: { allowJs: true } },
      ],
      sets: {
        indexed: { include: ["packages/**/*.{ts,tsx}", "worker/**/*.ts", "scripts/tool.mjs", "scripts/machinery.mjs"], exclude: ["**/node_modules/**"] },
        headered: { exclude: ["**/*.test.*"] },
        sized: { exclude: [] },
      },
      codegenOwned: [{ paths: ["packages/lib/src/index.ts"], command: "node gen.mjs" }],
    },
    subsystems: {
      adopted: true,
      subsystems: { design: { doc: "README.md" }, data: { doc: "README.md" }, http: { doc: "README.md" }, web: { doc: "README.md" }, edge: { doc: "README.md" }, tooling: { doc: "README.md", infrastructure: true } },
    },
    architecture: {
      adopted: true,
      packages: [
        { name: "lib", path: "packages/lib" },
        { name: "server", path: "packages/server", layers: [{ name: "routes", prefix: "src/routes/" }, { name: "lib", prefix: "src/lib/" }], allowLayers: { routes: ["lib"], lib: [] } },
        { name: "web", path: "packages/web" },
      ],
      allowPackages: { server: ["lib"], web: ["lib"], lib: [] },
      allowSubsystems: {},
      exemptions: [],
    },
    "size-baseline": { adopted: true, cap: 800, baselines: {} },
  };

  let BASE, SYNC_LOG;
  const fresh = () => { const d = mkdtempSync(join(tmpdir(), "map-case-")); execFileSync("cp", ["-a", BASE + "/.", d]); return d; };

  before(() => {
    BASE = mkdtempSync(join(tmpdir(), "map-consumer-"));
    for (const [rel, text] of Object.entries(FIXTURE)) write(BASE, rel, text);
    git(BASE, "init", "-q");
    commitAll(BASE, "fixture");
    SYNC_LOG = deliver(BASE);
    linkModules(BASE);
    commitAll(BASE, "sync");
  });

  test("the sync delivers the tool, the eval harness and the seeds, and an unadopted repository fails check with the adoption steps", () => {
    for (const f of ["scripts/map.mjs", "scripts/map-eval.mjs", ".agents/map/config.schema.json", "docs/ai-context/agent-legible-codebase.md", "docs/ai-context/agent-legible-codebase-eval.md", ".claude/rules/map-before-edit.md"]) {
      assert.ok(existsSync(join(BASE, f)), `${f} delivered`);
    }
    for (const s of ["config", "subsystems", "architecture", "size-baseline", "eval-tasks"]) {
      assert.ok(existsSync(join(BASE, ".agents/map", `${s}.json`)), `${s} seeded`);
      assert.match(SYNC_LOG, new RegExp(`seed\\s+\\.agents/map/${s}\\.template\\.json`));
    }
    const r = map(BASE, "check");
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /has not adopted/);
    for (const s of ["config", "subsystems", "architecture", "size-baseline"]) assert.match(r.err, new RegExp(`\\.agents/map/${s}\\.json`));
    assert.match(r.err, /fix: .*"adopted": true/);
    assert.match(r.err, /why: docs\/ai-context\/agent-legible-codebase\.md#adopting-the-tool/);
  });

  const adopt = (root) => {
    for (const [name, value] of Object.entries(ADOPTED)) write(root, `.agents/map/${name}.json`, JSON.stringify(value, null, 2) + "\n");
  };

  test("an adopted repository builds and checks clean; a second build is byte-identical and leaves provenance untouched; a second sync keeps the seeds", () => {
    const d = fresh();
    adopt(d);
    const b = map(d, "build");
    assert.equal(b.code, 0, b.all);
    const idx = read(d, ".agents/map/index.json");
    const prov = statSync(join(d, ".agents/map/provenance.json")).mtimeMs;
    const c = map(d, "check");
    assert.equal(c.code, 0, c.all);
    assert.match(c.out, /✓ map/);
    assert.equal(map(d, "build").code, 0);
    assert.equal(read(d, ".agents/map/index.json"), idx, "byte-identical rebuild");
    assert.equal(statSync(join(d, ".agents/map/provenance.json")).mtimeMs, prov, "provenance untouched on unchanged inputs");
    assert.doesNotMatch(idx, /builtFrom|"20\d\d-\d\d-\d\dT/, "the index carries no commit id and no timestamp");
    commitAll(d);
    const again = deliver(d);
    assert.match(again, /keep\s+\.agents\/map\/config\.json/);
    assert.deepEqual(json(d, ".agents/map/config.json"), ADOPTED.config, "the sync never overwrites a completed seed");
  });

  let ADOPTED_DIR;
  const adopted = () => {
    if (!ADOPTED_DIR) {
      ADOPTED_DIR = fresh();
      adopt(ADOPTED_DIR);
      const b = map(ADOPTED_DIR, "build");
      assert.equal(b.code, 0, b.all);
      commitAll(ADOPTED_DIR, "adopt");
    }
    const d = mkdtempSync(join(tmpdir(), "map-case-"));
    execFileSync("cp", ["-a", ADOPTED_DIR + "/.", d]);
    return d;
  };

  test("answers: file edges versus symbol references through a barrel", () => {
    const d = adopted();
    const sym = mapJson(d, "dependents", "packages/lib/src/brandTokens.ts#BRAND_ORANGE");
    const files = sym.resolved.map((r) => r.file).sort();
    assert.deepEqual(files, ["packages/lib/src/index.ts", "packages/web/src/pages/Profile.tsx", "scripts/tool.mjs"], "the re-exporting barrel and both callers, nothing else");
    assert.ok(files.includes("packages/web/src/pages/Profile.tsx"), "a caller behind the barrel and a path alias");
    assert.ok(files.includes("scripts/tool.mjs"), "a JavaScript caller through a supplementary program");
    const file = mapJson(d, "dependents", "packages/lib/src/brandTokens.ts");
    assert.deepEqual(file.resolved.map((r) => r.file), ["packages/lib/src/index.ts"], "a file query reports module edges only");
    const deps = mapJson(d, "deps", "packages/web/src/pages/Profile.tsx");
    assert.deepEqual(deps.resolved.map((r) => r.file).sort(), ["packages/lib/src/index.ts", "packages/web/src/lib/util.ts"]);
    const testDeps = mapJson(d, "dependents", "packages/web/src/lib/util.ts");
    assert.ok(testDeps.resolved.some((r) => r.file === "packages/web/src/lib/util.test.ts"), "a test the product tsconfig excludes is still a consumer");
  });

  test("answers: Express mounts compose, handlers resolve, wouter and Worker routes are found, computed paths are unresolved", () => {
    const d = adopted();
    const hook = mapJson(d, "route", "POST", "/api/stripe/webhook");
    assert.equal(hook.resolved.length, 1);
    assert.equal(hook.resolved[0].file, "packages/server/src/app.ts");
    assert.equal(hook.resolved[0].handler.inline, true);
    const fact = mapJson(d, "route", "GET", "/api/facts/42");
    assert.equal(fact.resolved.length, 1);
    assert.equal(fact.resolved[0].path, "/api/facts/:id");
    assert.equal(fact.resolved[0].registeredAs, "/facts/:id");
    assert.deepEqual([fact.resolved[0].handler.file, fact.resolved[0].handler.name], ["packages/server/src/lib/handlers.ts", "getFact"]);
    assert.ok(fact.unresolved.some((u) => u.file === "packages/server/src/routes/facts.ts" && u.reason === "dynamic-target"), "a computed path is reported, not dropped");
    const page = mapJson(d, "route", "PAGE", "/profile");
    assert.deepEqual([page.resolved[0].file, page.resolved[0].handler.name], ["packages/web/src/App.tsx", "Profile"]);
    const worker = mapJson(d, "routes", "worker/src/index.ts");
    const paths = worker.resolved.map((r) => r.path).sort();
    assert.deepEqual(paths, ["prefix:/share/", "regex:/^\\/og\\/(\\w+)$/"]);
    assert.equal(mapJson(d, "route", "ANY", "/og/abc").resolved.length, 1);
  });

  test("answers: tables through typed symbols and every SQL form, external relations, and what could not be resolved", () => {
    const d = adopted();
    const facts = mapJson(d, "table", "facts");
    const kinds = new Set(facts.resolved.map((r) => `${r.kind}@${r.file}`));
    for (const k of ["declaration@packages/lib/src/schema.ts", "typed@packages/server/src/lib/db.ts", "sql-tag@packages/server/src/lib/db.ts", "pg-query@packages/server/src/lib/db.ts"]) {
      assert.ok(kinds.has(k), `${k} in ${[...kinds].join(", ")}`);
    }
    const users = mapJson(d, "table", "users");
    assert.ok(users.resolved.some((r) => r.kind === "sql-tag"));
    assert.ok(users.unresolved.some((u) => u.reason === "unsupported-form" && /could not be resolved/.test(u.detail)), "an unresolvable receiver carrying SQL is retained, never dropped");
    const stripe = map(d, "table", "stripe.products");
    assert.match(stripe.out, /external relation/);
    assert.match(stripe.out, /pg-query\s+packages\/server\/src\/lib\/db\.ts/);
    const dyn = mapJson(d, "unresolved", "sql");
    assert.ok(dyn.unresolved.some((u) => u.reason === "dynamic-target" && u.file === "packages/server/src/lib/db.ts"));
    const none = map(d, "table", "nothing_here");
    assert.match(none.out, /resolved \(0\):\n  \(none found\)\nunresolved/, "an empty answer still prints what could not be resolved");
  });

  test("reconciliation: an indexed file no declared program reaches is a configuration error naming it", () => {
    const d = adopted();
    setJson(d, ".agents/map/config.json", (c) => { c.programs = c.programs.filter((p) => !p.name); });
    const r = map(d, "build");
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /packages\/web\/src\/lib\/util\.test\.ts/);
    assert.match(r.err, /scripts\/tool\.mjs/);
    assert.match(r.err, /why: .*#programs-and-file-sets/);
    setJson(d, ".agents/map/config.json", (c) => { c.programs = ADOPTED.config.programs; });
    assert.equal(map(d, "build").code, 0);
  });

  test("the compiler is the repository's own: no local entry is refused even with an ambient compiler available", () => {
    const d = adopted();
    rmSync(join(d, "node_modules", "typescript"));
    const ambient = spawnSync(process.execPath, ["-e", "require.resolve('typescript')"], { cwd: d, env: { ...process.env, NODE_PATH: DEPS } });
    assert.equal(ambient.status, 0, "Node's ambient lookup can find a compiler here");
    const r = run(d, "map.mjs", ["build"], { NODE_PATH: DEPS });
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /no local TypeScript compiler/);
    assert.match(r.err, /why: .*#the-compiler/);
  });

  test("freshness: commits and fresh checkouts stay fresh; tests, barrels, exports, lockfiles and the compiler invalidate", () => {
    const d = adopted();
    assert.equal(map(d, "check").code, 0);
    write(d, "README.md", "# fixture\nmore prose\n");
    commitAll(d, "docs");
    assert.equal(map(d, "check").code, 0, "a docs-only commit leaves the index fresh");
    const clone = mkdtempSync(join(tmpdir(), "map-clone-"));
    rmSync(clone, { recursive: true });
    git(tmpdir(), "clone", "-q", d, clone);
    linkModules(clone);
    const cc = map(clone, "check");
    assert.equal(cc.code, 0, `a fresh checkout of the squashed tree is fresh:\n${cc.all}`);
    const stale = (mutate, what) => {
      mutate();
      const c = map(d, "check");
      assert.equal(c.code, 1, `${what} must invalidate`);
      assert.match(c.err, /freshness/);
      const q = map(d, "deps", "packages/web/src/lib/util.ts");
      assert.equal(q.code, 3, `${what}: a query refuses a stale index`);
      assert.match(q.err, /node scripts\/map\.mjs build/);
      assert.equal(map(d, "build").code, 0);
      assert.equal(map(d, "check").code, 0, `${what}: rebuilding clears it`);
    };
    stale(() => write(d, "packages/web/src/lib/util.test.ts", read(d, "packages/web/src/lib/util.test.ts") + 'shout("y");\n'), "a test consumer");
    stale(() => write(d, "packages/lib/src/index.ts", read(d, "packages/lib/src/index.ts") + "export const EXTRA = 1;\n"), "a generated barrel");
    stale(() => setJson(d, "packages/lib/package.json", (p) => { p.exports["./schema"] = "./src/schema.ts"; }), "a package exports entry");
    stale(() => write(d, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n# bumped\n"), "a lockfile");
    // A different compiler version: an entry whose package.json says 9.9.9 over the same library.
    const alt = join(d, ".ts-alt");
    mkdirSync(alt);
    const real = createRequire(import.meta.url).resolve(join(DEPS, "typescript", "package.json"));
    const pkg = JSON.parse(readFileSync(real, "utf8"));
    writeFileSync(join(alt, "package.json"), JSON.stringify({ ...pkg, version: "9.9.9" }));
    symlinkSync(join(dirname(real), "lib"), join(alt, "lib"));
    rmSync(join(d, "node_modules", "typescript"));
    symlinkSync(alt, join(d, "node_modules", "typescript"));
    const q = map(d, "deps", "packages/web/src/lib/util.ts");
    assert.equal(q.code, 3, "a compiler version change makes a query refuse");
    const allowed = map(d, "deps", "packages/web/src/lib/util.ts", "--allow-stale");
    assert.equal(allowed.code, 0);
    assert.match(allowed.out, /STALE/);
  });

  test("headers: a missing tag or an unknown tag fails with the fix; a codegen rewrite leaves the guard green", () => {
    const d = adopted();
    const f = "packages/server/src/lib/handlers.ts";
    const orig = read(d, f);
    write(d, f, orig.replace(" * @subsystem http\n", ""));
    map(d, "build");
    let r = map(d, "check");
    assert.equal(r.code, 1);
    assert.match(r.err, /✗ headers: .*lack/);
    assert.match(r.err, new RegExp(`${f}\\s+\\(missing @subsystem\\)`));
    assert.match(r.err, /fix: add a leading comment carrying `@purpose/);
    write(d, f, orig.replace("@subsystem http", "@subsystem nonsense"));
    map(d, "build");
    r = map(d, "check");
    assert.match(r.err, /does not define/);
    assert.match(r.err, /\.agents\/map\/subsystems\.json/);
    write(d, f, orig);
    write(d, "packages/lib/src/index.ts", "// generated\nexport { BRAND_ORANGE } from \"./brandTokens\";\nexport { factsTable, usersTable } from \"./schema\";\n");
    map(d, "build");
    r = map(d, "check");
    assert.equal(r.code, 0, `a codegen-owned file needs no header:\n${r.all}`);
  });

  test("boundaries: package, layer and feature edges fail; an exemption excuses one; a dead exemption fails", () => {
    const d = adopted();
    const add = (rel, line) => write(d, rel, read(d, rel) + line);
    add("packages/lib/src/schema.ts", 'import "../../server/src/lib/handlers";\n');
    map(d, "build");
    let r = map(d, "check");
    assert.match(r.err, /package boundary/);
    assert.match(r.err, /lib may not import server/);
    git(d, "checkout", "--", "packages/lib/src/schema.ts");
    add("packages/server/src/lib/handlers.ts", 'import "../routes/facts";\n');
    map(d, "build");
    r = map(d, "check");
    assert.match(r.err, /layer boundary/);
    assert.match(r.err, /server: lib may not import routes/);
    git(d, "checkout", "--", "packages/server/src/lib/handlers.ts");
    // Same package, same layer, different feature: only the third dimension sees it.
    add("packages/server/src/lib/handlers.ts", 'import "./db";\n');
    map(d, "build");
    r = map(d, "check");
    assert.doesNotMatch(r.err, /package boundary|layer boundary/);
    assert.match(r.err, /subsystem boundary/);
    assert.match(r.err, /http may not import data/);
    setJson(d, ".agents/map/architecture.json", (a) => {
      a.exemptions.push({ file: "packages/server/src/lib/handlers.ts", target: "packages/server/src/lib/db.ts", dimension: "subsystem", reason: "being retired", date: "2026-10-14" });
    });
    map(d, "build");
    r = map(d, "check");
    assert.equal(r.code, 0, `an exempted edge passes:\n${r.all}`);
    git(d, "checkout", "--", "packages/server/src/lib/handlers.ts");
    map(d, "build");
    r = map(d, "check");
    assert.match(r.err, /no longer match any violating import/);
  });

  test("sizes: growth past the allowance fails; freeze and ratchet only ever lower", () => {
    const d = adopted();
    setJson(d, ".agents/map/size-baseline.json", (b) => { b.cap = 6; });
    assert.equal(map(d, "freeze").code, 0);
    const base = json(d, ".agents/map/size-baseline.json").baselines;
    assert.ok(base["packages/server/src/lib/db.ts"] > 6, "an over-cap file is frozen");
    assert.equal(map(d, "check").code, 0);
    write(d, "packages/server/src/lib/db.ts", read(d, "packages/server/src/lib/db.ts") + "export const grown = 1;\n");
    map(d, "build");
    let r = map(d, "check");
    assert.match(r.err, /✗ size: .*exceed/);
    assert.match(r.err, /db\.ts\s+\(\d+ lines, allowed \d+\)/);
    const ratchet = map(d, "ratchet");
    assert.match(ratchet.out, /a baseline is never raised/);
    assert.equal(json(d, ".agents/map/size-baseline.json").baselines["packages/server/src/lib/db.ts"], base["packages/server/src/lib/db.ts"]);
    git(d, "checkout", "--", "packages/server/src/lib/db.ts");
    write(d, "packages/server/src/lib/db.ts", read(d, "packages/server/src/lib/db.ts").replace(/export async function unresolvedReceiver.*\n/, ""));
    map(d, "ratchet");
    assert.ok(json(d, ".agents/map/size-baseline.json").baselines["packages/server/src/lib/db.ts"] < base["packages/server/src/lib/db.ts"], "ratchet lowers after a shrink");
  });

  test("the back-out switch releases a failing guard, and queries say they are disabled", () => {
    const d = adopted();
    write(d, "packages/web/src/lib/util.ts", "export function shout(s: string) { return s; }\n");
    map(d, "build");
    assert.equal(map(d, "check").code, 1, "a guard fails");
    setJson(d, ".agents/map/config.json", (c) => { c.enabled = false; });
    const r = map(d, "check");
    assert.equal(r.code, 0, r.all);
    assert.equal(r.out.trim(), "map disabled by .agents/map/config.json");
    map(d, "build");
    assert.match(map(d, "deps", "packages/web/src/App.tsx").out, /DISABLED/);
  });

  test("schema: a configuration file that does not match names the file and the problem", () => {
    const d = adopted();
    setJson(d, ".agents/map/architecture.json", (a) => { a.bogus = 1; a.exemptions = [{ file: "a" }]; });
    const r = map(d, "check");
    assert.equal(r.code, 1);
    assert.match(r.err, /architecture\.json does not match the schema/);
    assert.match(r.err, /\$\.bogus: unknown key/);
    assert.match(r.err, /\$\.exemptions\[0\]: missing required key "reason"/);
  });

  test("every failure carries a command or an edit, and the document section that explains it", () => {
    const d = adopted();
    write(d, "packages/web/src/lib/util.ts", "export function shout(s: string) { return s; }\n");
    write(d, "packages/server/src/lib/handlers.ts", read(d, "packages/server/src/lib/handlers.ts") + 'import "./db";\n');
    setJson(d, ".agents/map/size-baseline.json", (b) => { b.cap = 3; });
    const r = map(d, "check");
    const blocks = r.err.split(/\n(?=✗ )/).filter((b) => b.startsWith("✗"));
    assert.ok(blocks.length >= 3, r.err);
    for (const b of blocks) {
      assert.match(b, /\n  fix: \S/, b);
      assert.match(b, /\n  why: docs\/ai-context\/agent-legible-codebase\.md#[a-z-]+/, b);
    }
    const doc = read(d, "docs/ai-context/agent-legible-codebase.md");
    for (const anchor of new Set([...r.err.matchAll(/#([a-z-]+)/g)].map((m) => m[1]))) {
      const heading = new RegExp(`^#+ ${anchor.replace(/-/g, "[ -]")}$`, "im");
      assert.match(doc, heading, `the anchor #${anchor} names a real heading`);
    }
  });

  test("the delivered eval harness builds keys independently of the map, and keeps grading material out of run worktrees", () => {
    const d = adopted();
    write(d, ".agents/map/eval-tasks.json", JSON.stringify({
      tasks: [
        { id: "h1", tier: "hidden", question: "Which files use the brand orange colour?", target: { kind: "symbol", ref: "packages/lib/src/brandTokens.ts#BRAND_ORANGE" } },
        { id: "h2", tier: "hidden", question: "Which files read the Stripe products table?", target: { kind: "relation", name: "stripe.products" } },
        { id: "s1", tier: "structural", question: "Where is the facts table used?", target: { kind: "relation", name: "facts", symbol: "packages/lib/src/schema.ts#factsTable" } },
      ],
    }));
    const k = run(d, "map-eval.mjs", ["keys"]);
    assert.equal(k.code, 0, k.all);
    const keys = json(d, ".agents/map/eval-keys.json");
    assert.ok(keys.h1.files.includes("packages/web/src/pages/Profile.tsx"));
    assert.ok(keys.h1.files.includes("scripts/tool.mjs"));
    assert.ok(keys.h2.files.includes("packages/server/src/lib/db.ts"));
    assert.ok(keys.s1.files.includes("packages/server/src/lib/db.ts"));
    assert.ok(keys.h1.verified === false, "keys start unverified");

    // The barrel case: break the declaration, and the compiler blames only the barrel —
    // diagnostics could never have produced the key above.
    const ts = createRequire(import.meta.url)(join(DEPS, "typescript"));
    write(d, "packages/lib/src/brandTokens.ts", read(d, "packages/lib/src/brandTokens.ts").replace("BRAND_ORANGE", "BRAND_RENAMED"));
    const cfg = ts.getParsedCommandLineOfConfigFile(join(d, "packages/web/tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
    const prog = ts.createProgram({ rootNames: cfg.fileNames, options: { ...cfg.options, noEmit: true } });
    const blamed = new Set(ts.getPreEmitDiagnostics(prog).filter((x) => x.file && /BRAND_ORANGE/.test(ts.flattenDiagnosticMessageText(x.messageText, "\n"))).map((x) => x.file.fileName.slice(d.length + 1)));
    assert.ok(blamed.has("packages/lib/src/index.ts"), [...blamed].join(", "));
    assert.ok(!blamed.has("packages/web/src/pages/Profile.tsx"), "the real caller gets no diagnostic");
    git(d, "checkout", "--", "packages/lib/src/brandTokens.ts");

    const s = run(d, "map-eval.mjs", ["score", "--runs", "/nonexistent.json"]);
    assert.equal(s.code, 1);
    assert.match(s.err, /not yet verified/);

    commitAll(d, "eval tasks and keys");
    const wt = join(mkdtempSync(join(tmpdir(), "map-arm-")), "arm");
    const p = run(d, "map-eval.mjs", ["prepare", "--ref", "HEAD", "--out", wt]);
    assert.equal(p.code, 0, p.all);
    assert.ok(existsSync(join(wt, "scripts/map.mjs")), "the worktree is the repository at the ref");
    assert.ok(!existsSync(join(wt, ".agents/map/eval-keys.json")), "the agent's worktree has no answer key");
    assert.ok(!existsSync(join(wt, ".agents/map/eval-tasks.json")), "nor the task file with its targets");
    assert.ok(existsSync(join(d, ".agents/map/eval-keys.json")), "the scorer still has them");

    setJson(d, ".agents/map/eval-keys.json", (all) => { for (const v of Object.values(all)) v.verified = true; });
    const runs = join(d, "..", `runs-${Date.now()}.json`);
    writeFileSync(runs, JSON.stringify([
      { task: "h1", arm: "A", files: keys.h1.files, tokens: 100 }, { task: "h1", arm: "B", files: [], tokens: 100 },
      { task: "h2", arm: "A", files: keys.h2.files, tokens: 100 }, { task: "h2", arm: "B", files: keys.h2.files, tokens: 100 },
      { task: "s1", arm: "A", files: keys.s1.files, tokens: 100 }, { task: "s1", arm: "B", files: keys.s1.files, tokens: 100 },
    ]));
    const sc = run(d, "map-eval.mjs", ["score", "--runs", runs]);
    assert.equal(sc.code, 0, sc.all);
    assert.equal(JSON.parse(sc.out).verdict.decision, "keep");
  });
}

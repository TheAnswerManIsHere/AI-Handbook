import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// The payload suite asserts this for core/scripts. This is the same assertion
// for the handbook's OWN scripts, which the payload suite cannot see: its root
// is core/, so `scripts/` there means the payload's copy.
//
// The defect (#11): comparing `import.meta.url` against a hand-built
// `file://${process.argv[1]}` fails on any checkout path needing percent
// encoding -- a space, a `#`. `main()` then never runs and the process exits
// 0. For a hook, only exit 2 blocks, so exit 0 is "allow". A directory name
// was enough to disarm every guard judgement at once.
test("no handbook script reintroduces the raw-string entry-point comparison", () => {
  const dir = join(ROOT, "scripts");
  const offenders = readdirSync(dir)
    .filter((f) => f.endsWith(".mjs"))
    .filter((f) => readFileSync(join(dir, f), "utf8").includes("file://${process.argv[1]}"));

  assert.deepEqual(
    offenders,
    [],
    "compare against pathToFileURL(process.argv[1]).href -- these checks pass by not running otherwise",
  );
});

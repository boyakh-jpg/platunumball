import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const PRODUCTION_REF = "olzxextphxpniwiiwwda";
const TEST_REF = "rankballtestproject01";
const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "simulate-backend-flow.mjs");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "rankball-sim-safety-"));

function childEnvironment(projectRef, url = `https://${projectRef}.supabase.co`) {
  return {
    SystemRoot: process.env.SystemRoot || "",
    WINDIR: process.env.WINDIR || "",
    PATH: process.env.PATH || "",
    TEMP: process.env.TEMP || "",
    TMP: process.env.TMP || "",
    SUPABASE_URL: url,
    ...(projectRef ? { SUPABASE_PROJECT_ID: projectRef } : {}),
  };
}

function runSafetyCheck(args, env) {
  const result = spawnSync(process.execPath, [scriptPath, "--safety-check-only", ...args], {
    cwd: temporaryDirectory,
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.error) throw result.error;
  return result;
}

test.after(() => {
  assert.ok(temporaryDirectory.startsWith(tmpdir()));
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("production target is blocked without an exact CLI confirmation", () => {
  const result = runSafetyCheck([], childEnvironment(PRODUCTION_REF));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /"environment":"production"/);
  assert.match(result.stderr, new RegExp(`--confirm-production=${PRODUCTION_REF}`));
});

test("production target passes a non-network safety check with exact confirmation", () => {
  const result = runSafetyCheck(
    [`--confirm-production=${PRODUCTION_REF}`],
    childEnvironment(PRODUCTION_REF),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /"directSupabaseRef":"olzxextphxpniwiiwwda"/);
  assert.doesNotMatch(result.stderr, /https:\/\//);
});

test("BOXTIER production API host requires the production confirmation", () => {
  const blocked = runSafetyCheck(
    ["--base-url=https://boxtier.kr"],
    childEnvironment(PRODUCTION_REF),
  );
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, new RegExp(`--confirm-production=${PRODUCTION_REF}`));
  assert.doesNotMatch(blocked.stderr, /remote API project ref is required/);

  const confirmed = runSafetyCheck(
    ["--base-url=https://boxtier.kr", `--confirm-production=${PRODUCTION_REF}`],
    childEnvironment(PRODUCTION_REF),
  );
  assert.equal(confirmed.status, 0, confirmed.stderr);
  assert.match(confirmed.stderr, /"apiHost":"boxtier\.kr"/);
});

test("production target rejects a confirmation for another project", () => {
  const result = runSafetyCheck(
    ["--confirm-production=anotherprojectref"],
    childEnvironment(PRODUCTION_REF),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`--confirm-production=${PRODUCTION_REF}`));
});

test("dedicated test project does not require production confirmation", () => {
  const result = runSafetyCheck([], childEnvironment(TEST_REF));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /"environment":"test"/);
  assert.match(result.stderr, new RegExp(`"directSupabaseRef":"${TEST_REF}"`));
});

test("remote test API requires and accepts a matching project ref", () => {
  const result = runSafetyCheck(
    ["--base-url=https://boxtier-test.example.com", `--remote-project-ref=${TEST_REF}`],
    childEnvironment(TEST_REF),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /"environment":"test"/);
  assert.match(result.stderr, /"apiHost":"boxtier-test\.example\.com"/);
});

test("unrecognized remote API host is blocked without a declared project ref", () => {
  const result = runSafetyCheck(
    ["--base-url=https://boxtier-test.example.com"],
    childEnvironment(TEST_REF),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /remote API project ref is required/);
});

test("remote and direct project ref mismatch is blocked", () => {
  const result = runSafetyCheck(
    ["--base-url=https://boxtier-test.example.com", "--remote-project-ref=anotherprojectref"],
    childEnvironment(TEST_REF),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /remote API project ref does not match/);
});

test("repeat and cleanup retry values above hard limits are blocked", () => {
  const repeatResult = runSafetyCheck(
    [`--confirm-production=${PRODUCTION_REF}`, "--repeat=2"],
    childEnvironment(PRODUCTION_REF),
  );
  assert.equal(repeatResult.status, 1);
  assert.match(repeatResult.stderr, /repeat exceeds hard limit 1/);

  const retryResult = runSafetyCheck(
    [`--confirm-production=${PRODUCTION_REF}`, "--max-retries=2"],
    childEnvironment(PRODUCTION_REF),
  );
  assert.equal(retryResult.status, 1);
  assert.match(retryResult.stderr, /max-retries exceeds hard limit 1/);
});

test("repeat cannot be disabled to fake a successful simulation", () => {
  const result = runSafetyCheck(
    [`--confirm-production=${PRODUCTION_REF}`, "--repeat=0"],
    childEnvironment(PRODUCTION_REF),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /repeat must be exactly 1/);
});

test("local Supabase target remains available without production confirmation", () => {
  const result = runSafetyCheck([], childEnvironment("", "http://127.0.0.1:54321"));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /"environment":"local"/);
});

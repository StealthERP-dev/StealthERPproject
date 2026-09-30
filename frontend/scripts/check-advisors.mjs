#!/usr/bin/env node
// Supabase security advisors gate (PLAT-06). Runs `supabase db advisors
// --type security` against the local (default) or linked (--linked) project,
// prints every finding, and exits 1 if any finding is a security-critical
// class this project must never ship with — except the one function that is
// an intentional public RPC (public.place_order), which is expected to be
// anon/authenticated-executable and security definer.
//
// Usage: node scripts/check-advisors.mjs [--linked]

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const linked = process.argv.includes("--linked");
const targetFlag = linked ? "--linked" : "--local";

// Test-only schemas: vendored pgTAP helpers/fixtures (supabase/tests/000_test_helpers.sql),
// never deployed — findings scoped to these schemas are noise, not real risk.
const IGNORED_SCHEMAS = new Set(["tests", "test_overrides"]);

// Finding names that are always blocking, wherever they point.
const BLOCKING_NAMES = new Set([
  "function_search_path_mutable",
  "security_definer_view",
  "rls_disabled_in_public",
  "policy_exists_rls_disabled",
  "rls_enabled_no_policy",
  "auth_users_exposed",
]);

// A security-definer function that anon/authenticated can execute is expected
// for exactly five functions: the two original intentional public RPCs plus
// the three AUTH-06 login-lockout RPCs. Four of those five are
// anon-executable (the caller isn't authenticated yet during login);
// clear_login_attempts is the exception — it is authenticated-only by
// design (it derives its identity from the caller's own session, closing
// the AUTH-06 bypass where it used to take an arbitrary p_phone), so its
// listing here permits the finding without implying it is anon-reachable.
// Either way, every name in this set is expected security-definer surface,
// not a leak.
const ALLOWED_SECURITY_DEFINER_EXECUTABLE_NAMES = new Set([
  "place_order",
  "log_event",
  "check_login_lock",
  "record_login_failure",
  "clear_login_attempts",
]);

function isSecurityDefinerExecutableFinding(name) {
  return /security_definer_function_executable/.test(name);
}

function isBlockingFinding(finding) {
  const name = finding?.name ?? "";
  const objectName = finding?.metadata?.name ?? "";

  if (BLOCKING_NAMES.has(name)) {
    return true;
  }

  if (
    isSecurityDefinerExecutableFinding(name) &&
    !ALLOWED_SECURITY_DEFINER_EXECUTABLE_NAMES.has(objectName)
  ) {
    return true;
  }

  return false;
}

async function fetchFindings() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      "npx",
      [
        "supabase",
        "db",
        "advisors",
        targetFlag,
        "--type",
        "security",
        "--level",
        "info",
        "--output-format",
        "json",
      ],
      { maxBuffer: 1024 * 1024 * 32 },
    ));
  } catch (err) {
    console.error("supabase db advisors failed to run:");
    console.error(err.stdout ?? "");
    console.error(err.stderr ?? String(err));
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    console.error("supabase db advisors did not return parseable JSON:");
    console.error(stdout);
    process.exit(1);
  }

  return Array.isArray(parsed?.results) ? parsed.results : [];
}

async function main() {
  const findings = await fetchFindings();

  let blocking = false;

  for (const finding of findings) {
    const schema = finding?.metadata?.schema;
    if (schema && IGNORED_SCHEMAS.has(schema)) {
      console.log(
        `ignored (test schema): [${finding.name}] ${finding.detail ?? finding.title ?? ""}`,
      );
      continue;
    }

    const blockingFinding = isBlockingFinding(finding);
    console.log(
      `${blockingFinding ? "BLOCKING" : "info"}: [${finding.name}] ${finding.detail ?? finding.title ?? ""}`,
    );

    if (blockingFinding) {
      blocking = true;
    }
  }

  if (findings.length === 0) {
    console.log("No advisor findings.");
  }

  if (blocking) {
    console.error("Blocking security advisor finding(s) present.");
    process.exit(1);
  }
}

main();

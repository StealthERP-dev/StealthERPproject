#!/usr/bin/env node
// Bundle / deployed-JS / src secret scanner (PLAT-07). Proves that no
// privileged Supabase key (a JWT whose payload role is not "anon", or any
// sb_secret_ key) ever reaches the built client bundle or the deployed JS,
// and that app source never even references a privileged-key env var name.
//
// Usage:
//   node scripts/check-bundle-secrets.mjs [--dir <path>]
//     Scans every file under <path> (default: .next/static) for JWT/secret-key
//     material, and always additionally scans src/ for privileged env var
//     names. Exits 1 on any finding, or if the primary target had nothing to
//     scan (missing/empty dir). Exit 0 otherwise.
//
//   node scripts/check-bundle-secrets.mjs --url <pageUrl>
//     Fetches <pageUrl>, follows every /_next/static/*.js script it
//     references, and applies the same token checks. Used against a real
//     deployed preview. Also always scans src/.
//
//   node scripts/check-bundle-secrets.mjs --self-test
//     Fail-first proof: plants a service_role-role JWT and a fake sb_secret_
//     key in a throwaway temp directory, scans only that directory, and
//     exits 0 only if the scanner flags both. Deletes the temp directory
//     afterwards either way. Does not touch the real repo's src/ or .next/.

import {
  readdirSync,
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";

// Privileged Supabase env var names that must never be referenced from src/ —
// referencing the name at all is enough to be a defense-in-depth violation,
// regardless of whether a real value is ever assigned.
const PRIVILEGED_ENV_VAR_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
];

// File types worth scanning as text. Built bundles are almost entirely .js;
// src/ is .ts/.tsx; a couple of extra text formats are included cheaply.
const SCANNED_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".json",
  ".html",
]);

// JWT shape: three base64url segments, the first two starting with the
// literal "eyJ" — the base64 encoding of `{"`, which is how every JSON JWT
// header and payload begins. The negative look-around stops a match from
// starting/ending mid-token inside a longer base64url run.
const JWT_RE =
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?![A-Za-z0-9_-])/g;
const SECRET_KEY_RE = /(?<![A-Za-z0-9_])sb_secret_[A-Za-z0-9_-]+/g;

function redact(token) {
  return `${token.slice(0, 12)}…`;
}

function decodeJwtRole(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false };
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    return {
      ok: true,
      role: typeof payload.role === "string" ? payload.role : null,
    };
  } catch {
    return { ok: false };
  }
}

function scanText(text, label, findings, roleCounts) {
  for (const match of text.matchAll(JWT_RE)) {
    const token = match[0];
    const { ok, role } = decodeJwtRole(token);
    if (!ok) {
      findings.push({
        label,
        offset: match.index,
        detail: `undecodable JWT-shaped token ${redact(token)}`,
      });
      continue;
    }
    const roleKey = role ?? "(no role claim)";
    roleCounts.set(roleKey, (roleCounts.get(roleKey) ?? 0) + 1);
    if (role !== "anon") {
      findings.push({
        label,
        offset: match.index,
        detail: `JWT with role=${roleKey} ${redact(token)}`,
      });
    }
  }
  for (const match of text.matchAll(SECRET_KEY_RE)) {
    findings.push({
      label,
      offset: match.index,
      detail: `sb_secret_ key ${redact(match[0])}`,
    });
  }
}

function walk(dir, onFile) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, onFile);
    } else if (entry.isFile() && SCANNED_EXTENSIONS.has(extname(entry.name))) {
      let text;
      try {
        text = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      onFile(full, text);
    }
  }
}

function scanDir(dirPath, findings, roleCounts) {
  let scanned = 0;
  walk(dirPath, (filePath, text) => {
    scanned += 1;
    scanText(text, filePath, findings, roleCounts);
  });
  return scanned;
}

function scanSrcForEnvVarNames(findings) {
  let scanned = 0;
  walk("src", (filePath, text) => {
    scanned += 1;
    for (const name of PRIVILEGED_ENV_VAR_NAMES) {
      const re = new RegExp(`\\b${name}\\b`, "g");
      for (const match of text.matchAll(re)) {
        findings.push({
          label: filePath,
          offset: match.index,
          detail: `src references privileged env var ${name}`,
        });
      }
    }
  });
  return scanned;
}

async function scanUrl(pageUrl, findings, roleCounts) {
  let scanned = 0;
  const pageRes = await fetch(pageUrl);
  const pageText = await pageRes.text();
  scanned += 1;
  scanText(pageText, pageUrl, findings, roleCounts);

  const scriptRe = /\/_next\/static\/[^"'\s)]+\.js/g;
  const base = new URL(pageUrl);
  const scripts = new Set();
  for (const match of pageText.matchAll(scriptRe)) {
    scripts.add(new URL(match[0], base).toString());
  }
  for (const scriptUrl of scripts) {
    const res = await fetch(scriptUrl);
    const text = await res.text();
    scanned += 1;
    scanText(text, scriptUrl, findings, roleCounts);
  }
  return scanned;
}

function printReport(
  primaryLabel,
  primaryScanned,
  srcScanned,
  findings,
  roleCounts,
) {
  console.log(
    `scanned: ${primaryScanned} file(s)/resource(s) under ${primaryLabel}, ${srcScanned} file(s) under src`,
  );
  for (const [role, count] of roleCounts) {
    console.log(`JWTs found with role=${role}: ${count}`);
  }
  for (const finding of findings) {
    console.log(
      `FINDING: ${finding.label}:${finding.offset} — ${finding.detail}`,
    );
  }
}

async function runSelfTest() {
  const dir = mkdtempSync(join(tmpdir(), "check-bundle-secrets-self-test-"));
  try {
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ role: "service_role", iss: "supabase" }),
    ).toString("base64url");
    const plantedJwt = `${header}.${payload}.fake-signature-not-real`;
    const plantedSecretKey = "sb_secret_" + "x".repeat(40);
    writeFileSync(
      join(dir, "planted.js"),
      `// self-test fixture — nothing secret-shaped is committed to git\nconst a = "${plantedJwt}";\nconst b = "${plantedSecretKey}";\n`,
    );

    const findings = [];
    const roleCounts = new Map();
    const scanned = scanDir(dir, findings, roleCounts);

    const flaggedJwt = findings.some((f) =>
      f.detail.includes("role=service_role"),
    );
    const flaggedSecretKey = findings.some((f) =>
      f.detail.includes("sb_secret_ key"),
    );

    printReport(dir, scanned, 0, findings, roleCounts);

    if (scanned === 0 || !flaggedJwt || !flaggedSecretKey) {
      console.error(
        "SELF-TEST FAILED: planted service_role JWT and/or sb_secret_ key were not flagged.",
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      `SELF-TEST PASSED: planted service_role JWT (${redact(plantedJwt)}) and sb_secret_ key (${redact(plantedSecretKey)}) were both flagged.`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = { dir: ".next/static" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") args.selfTest = true;
    else if (arg === "--dir") args.dir = argv[(i += 1)];
    else if (arg === "--url") args.url = argv[(i += 1)];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.selfTest) {
    await runSelfTest();
    return;
  }

  const findings = [];
  const roleCounts = new Map();

  const primaryLabel = args.url ?? args.dir;
  const primaryScanned = args.url
    ? await scanUrl(args.url, findings, roleCounts)
    : scanDir(args.dir, findings, roleCounts);

  const srcScanned = scanSrcForEnvVarNames(findings);

  printReport(primaryLabel, primaryScanned, srcScanned, findings, roleCounts);

  if (primaryScanned === 0) {
    console.error(
      `No files/resources were scanned under ${primaryLabel} (missing or empty). Failing closed.`,
    );
    process.exitCode = 1;
    return;
  }

  if (findings.length > 0) {
    console.error(`${findings.length} finding(s) present.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    "OK: no privileged key material found in the bundle, deployed JS, or src.",
  );
}

main();

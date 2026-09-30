import path from "node:path";
import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // `next dev` auto-generates root AGENTS.md/CLAUDE.md with an AI-agent
  // notice (see node_modules/next/dist/server/lib/generate-agent-files.js).
  // This project's own .claude/CLAUDE.md is the real instructions file;
  // disable the generator so it stops recreating the two root files.
  agentRules: false,
  // Pin Turbopack's root to the repo root (one level up) so ../shared/api-contract.ts
  // (a single raw-TypeScript file, imported as @shared/api-contract) compiles. Explicit, because a sibling
  // pnpm-workspace.yaml outside this git repo would otherwise be guessed.
  turbopack: {
    root: path.join(import.meta.dirname, ".."),
  },
  // Single source of truth for the running app version (DATA-03, doc §7):
  // package.json's version, inlined into the client bundle at build time so
  // every emitted event can be stamped with it.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;

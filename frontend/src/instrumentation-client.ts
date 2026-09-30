// Next.js's client-side instrumentation file (docs/01-app/03-api-reference/
// 03-file-conventions/instrumentation-client.mdx): runs once in the browser,
// before hydration, with no import required anywhere else.
//
// Its one job here: guarantee DATA-03's single source of truth for the
// running app version — package.json's `version`, inlined by next.config.ts
// as NEXT_PUBLIC_APP_VERSION — actually reaches a real, built client bundle.
// Next.js only substitutes `process.env.NEXT_PUBLIC_APP_VERSION` where that
// token is reachable from the compiled output; this phase wires no product
// screen that reads it yet (DATA-04..08 do, in Phases 2-6), so without this
// file the reference is tree-shaken out and the version never reaches
// `.next/static` at all. Exposing it on `window` also gives every later
// phase's browser console a cheap way to confirm which release is running.
export {};

declare global {
  interface Window {
    __APP_VERSION__?: string | null;
  }
}

window.__APP_VERSION__ = process.env.NEXT_PUBLIC_APP_VERSION ?? null;

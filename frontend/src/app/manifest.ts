import type { MetadataRoute } from "next";

// NAV-03 / D-02 / D-03: the installable web app manifest. Auto-served at
// /manifest.webmanifest and auto-linked into <head> from this file's mere
// presence under app/ — no explicit metadata.manifest reference is needed
// or wanted in layout.tsx (resolve-metadata.js:159-160).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "My Shop — Store Manager",
    short_name: "My Shop",
    id: "/",
    start_url: "/", // D-03: always the vendor's Home screen
    scope: "/",
    display: "standalone",
    // Same value as layout.tsx's viewport.themeColor and theme.css's
    // --background (#F9F8F5) — one colour, never a second value.
    // check-manifest.mjs compares this against the served theme-color meta.
    background_color: "#F9F8F5",
    theme_color: "#F9F8F5",
    icons: [
      // NOT filled from app/icon.png — the manifest's icons[] and the
      // icon/apple-icon file-convention routes are two independently
      // resolved keys (resolve-metadata.js:129). These point at literal
      // public/ files, never the /icon route (whose URL carries a
      // generated query string).
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

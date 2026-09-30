#!/usr/bin/env node
// The ONE source of every app icon (NAV-03 / D-01). Renders lucide-react's
// `Store` glyph — the same shop pictogram already shown on the setup, login,
// finish-your-shop and not-found screens (src/features/auth/components/
// setup-form.tsx:21) — through next/og's ImageResponse into plain PNGs.
//
// Run BY HAND, never from the build (RESEARCH.md's "Don't Hand-Roll": the
// icon set is fixed and small, so a generation pipeline wired into `next
// build` would be unnecessary machinery). Output is deterministic: two runs
// at the same size produce byte-identical bytes (verified at plan time and
// re-verified at execution time for 192 and 512).
//
// Usage:
//   node scripts/generate-app-icons.mjs          regenerate every row and
//                                                 write the files
//   node scripts/generate-app-icons.mjs --check  render every row in memory
//                                                 and compare byte for byte
//                                                 with the committed file;
//                                                 exit 1 on any mismatch or
//                                                 missing file, writes
//                                                 nothing
//
// Colours are the app's own theme tokens, not a new decision:
//   FOREGROUND = --foreground (src/app/theme.css:6)
//   BACKGROUND = --background (src/app/theme.css:5), also
//                layout.tsx's viewport.themeColor ("#F9F8F5")

import { ImageResponse } from "next/og.js";
import { Store } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const FOREGROUND = "#1C1917";
const BACKGROUND = "#F9F8F5";

// Every icon this project ships. `ratio` is the glyph's side as a fraction
// of the full canvas.
//
// 0.56 is the largest square that fits inside Android's maskable 80%
// safe-zone circle: 0.8 ÷ √2 ≈ 0.566, rounded down so the glyph never
// clips when an adaptive-icon launcher masks the full-bleed background into
// a circle, squircle or rounded square. The same file is used for both the
// `any` and `maskable` manifest entries — one asset, not two.
// 0.8 is used only for the 32px favicon: a favicon is never masked (no
// safe-zone constraint applies), and at 32px a 0.56 glyph box renders about
// 18px wide — too small to read as a shop pictogram. Plan time compared
// both renders at 32px and picked 0.8. It is the same glyph at a different
// scale, not a second asset.
const OUTPUTS = [
  { path: "public/icon-192.png", size: 192, ratio: 0.56 },
  { path: "public/icon-512.png", size: 512, ratio: 0.56 },
  { path: "src/app/apple-icon.png", size: 180, ratio: 0.56 },
  { path: "src/app/icon.png", size: 32, ratio: 0.8 },
];

function renderStoreSvgDataUri() {
  const svg = renderToStaticMarkup(
    createElement(Store, { size: 24, color: FOREGROUND, strokeWidth: 2 }),
  );
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

async function renderIcon(size, ratio) {
  const dataUri = renderStoreSvgDataUri();
  const glyphSide = Math.round(size * ratio);
  const image = new ImageResponse(
    {
      type: "div",
      props: {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BACKGROUND,
        },
        children: {
          type: "img",
          props: {
            src: dataUri,
            width: glyphSide,
            height: glyphSide,
          },
        },
      },
    },
    { width: size, height: size },
  );
  return Buffer.from(await image.arrayBuffer());
}

async function generateAll() {
  for (const { path, size, ratio } of OUTPUTS) {
    const buffer = await renderIcon(size, ratio);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buffer);
    console.log(`wrote ${path} (${size}x${size}, glyph ratio ${ratio})`);
  }
}

// Renders every row in memory and compares it byte for byte with the
// committed file. Proves D-01's "same glyph everywhere" is a checked
// property, not a promise — a hand-edited or swapped icon fails this.
// Writes nothing.
async function checkAll() {
  let allOk = true;
  for (const { path, size, ratio } of OUTPUTS) {
    const rendered = await renderIcon(size, ratio);
    let committed;
    try {
      committed = readFileSync(path);
    } catch {
      console.error(`not ok: ${path} is missing`);
      allOk = false;
      continue;
    }
    if (rendered.equals(committed)) {
      console.log(`ok: ${path} matches the generator byte for byte`);
    } else {
      console.error(
        `not ok: ${path} differs from the generator's output (${committed.length} bytes committed, ${rendered.length} bytes generated)`,
      );
      allOk = false;
    }
  }
  if (allOk) {
    console.log("\ngenerate-app-icons --check: PASS");
  } else {
    console.error("\ngenerate-app-icons --check: FAIL");
    process.exitCode = 1;
  }
}

async function main() {
  if (process.argv.includes("--check")) {
    await checkAll();
  } else {
    await generateAll();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exitCode = 1;
});

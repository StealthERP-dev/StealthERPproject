#!/usr/bin/env node
// Raw-fetch installability gate for the served manifest and its icons
// (NAV-03 / D-02 / D-03). Follows scripts/check-link-metadata.mjs's shape:
// raw `fetch` only, no browser, no database, `ok:`/`not ok:` lines, exit
// code 1 on any failure, a final check-manifest: PASS|FAIL line.
//
// Usage:
//   node scripts/check-manifest.mjs [baseUrl]   default http://127.0.0.1:3100
//   node scripts/check-manifest.mjs --self-test
//
// The expected D-02 strings and theme colour are the SPEC, not data —
// hardcoding them here is correct; a drifted manifest.ts should make this
// gate fail, not silently agree with whatever it finds.

const BASE = process.argv[2]?.startsWith("--")
  ? (process.env.BASE ?? "http://127.0.0.1:3100")
  : (process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:3100");

const EXPECTED_NAME = "My Shop — Store Manager";
const EXPECTED_SHORT_NAME = "My Shop";
const EXPECTED_START_URL = "/";
const EXPECTED_DISPLAY = "standalone";
const EXPECTED_APPLE_TITLE = "My Shop";

// Vendor/auth paths must carry the manifest link and the iOS web-app tags.
// Customer paths (the public storefront) must carry NONE of it — PRD §8
// "nothing to install for customers"; the per-shop storefront manifest is
// PWA-v2-01, deferred.
const SMOKE_SLUG = process.env.SMOKE_SLUG ?? "priya-stores";
const VENDOR_PATHS = ["/", "/login", "/setup"];
const CUSTOMER_PATHS = ["/terms", `/store/${SMOKE_SLUG}`];

let failed = false;

function fail(message) {
  console.error(`not ok: ${message}`);
  failed = true;
  process.exitCode = 1;
}

function ok(message) {
  console.log(`ok: ${message}`);
}

// --- Pure validators (no fetch, no I/O) -------------------------------

function parseSizes(sizesStr) {
  const match = /^(\d+)x(\d+)$/.exec(sizesStr ?? "");
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function isForbiddenIconSrc(src) {
  return (
    typeof src === "string" &&
    (src.startsWith("/icon?") ||
      src === "/icon" ||
      src.startsWith("/apple-icon"))
  );
}

function validateManifest(json) {
  const problems = [];

  if (json?.name !== EXPECTED_NAME) {
    problems.push(
      `name expected "${EXPECTED_NAME}", got ${JSON.stringify(json?.name)}`,
    );
  }
  if (json?.short_name !== EXPECTED_SHORT_NAME) {
    problems.push(
      `short_name expected "${EXPECTED_SHORT_NAME}", got ${JSON.stringify(json?.short_name)}`,
    );
  }
  if (json?.start_url !== EXPECTED_START_URL) {
    problems.push(
      `start_url expected "${EXPECTED_START_URL}", got ${JSON.stringify(json?.start_url)}`,
    );
  }
  if (json?.display !== EXPECTED_DISPLAY) {
    problems.push(
      `display expected "${EXPECTED_DISPLAY}", got ${JSON.stringify(json?.display)}`,
    );
  }

  const themeColor = json?.theme_color;
  const backgroundColor = json?.background_color;
  if (!themeColor) {
    problems.push("theme_color is missing or empty");
  }
  if (!backgroundColor) {
    problems.push("background_color is missing or empty");
  }
  if (themeColor && backgroundColor && themeColor !== backgroundColor) {
    problems.push(
      `theme_color (${JSON.stringify(themeColor)}) and background_color (${JSON.stringify(backgroundColor)}) must be equal`,
    );
  }

  const icons = Array.isArray(json?.icons) ? json.icons : null;
  if (!icons || icons.length === 0) {
    problems.push("icons array is missing or empty");
  } else {
    const has192 = icons.some(
      (icon) => icon?.sizes === "192x192" && icon?.type === "image/png",
    );
    const has512 = icons.some(
      (icon) => icon?.sizes === "512x512" && icon?.type === "image/png",
    );
    const hasMaskable = icons.some((icon) => icon?.purpose === "maskable");
    if (!has192) problems.push("icons array has no 192x192 image/png entry");
    if (!has512) problems.push("icons array has no 512x512 image/png entry");
    if (!hasMaskable)
      problems.push("icons array has no maskable-purpose entry");

    for (const icon of icons) {
      if (isForbiddenIconSrc(icon?.src)) {
        problems.push(
          `icon src ${JSON.stringify(icon?.src)} must not be the /icon or /apple-icon file-convention route`,
        );
      }
    }
  }

  return problems;
}

// bytes 0-7: PNG signature; bytes 12-15: ASCII "IHDR"; width is the
// big-endian uint32 at byte 16, height at byte 20.
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function pngDimensions(bytes) {
  if (!bytes || bytes.length < 24) return null;
  if (!Buffer.from(bytes.subarray(0, 8)).equals(PNG_SIGNATURE)) return null;
  const ihdrTag = Buffer.from(bytes.subarray(12, 16)).toString("ascii");
  if (ihdrTag !== "IHDR") return null;
  const width = Buffer.from(bytes).readUInt32BE(16);
  const height = Buffer.from(bytes).readUInt32BE(20);
  return { width, height };
}

// Tolerates either attribute order (content before rel/name, or after) —
// modelled on check-link-metadata.mjs's extractMetaContent, generalised to
// return every attribute of every matching <link> or <meta> tag.
function findTags(html, tagName) {
  const tagRe = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  const attrRe = /([a-zA-Z0-9-]+)\s*=\s*["']([^"']*)["']/g;
  const tags = html.match(tagRe) ?? [];
  return tags.map((tagString) => {
    const attrs = {};
    let match;
    attrRe.lastIndex = 0;
    while ((match = attrRe.exec(tagString))) {
      attrs[match[1]] = match[2];
    }
    return attrs;
  });
}

// A vendor/auth page must carry the manifest link and both iOS web-app
// tags — the STANDARDISED `mobile-web-app-capable` name Next 16.3.5
// actually emits (metadata.js:602-613), never only the legacy
// `apple-mobile-web-app-capable` one. Pure/structural only: the icon
// links' hrefs are fetched and size-checked separately, live only.
function validateVendorHead(html) {
  const problems = [];

  const manifestLinks = findTags(html, "link").filter(
    (attrs) => attrs.rel === "manifest",
  );
  if (!(
    manifestLinks.length === 1 &&
    manifestLinks[0].href === "/manifest.webmanifest"
  )) {
    problems.push(
      `expected exactly one <link rel="manifest" href="/manifest.webmanifest">, found ${JSON.stringify(manifestLinks)}`,
    );
  }

  const metas = findTags(html, "meta");
  const capableMeta = metas.find(
    (attrs) => attrs.name === "mobile-web-app-capable",
  );
  if (!(capableMeta && capableMeta.content === "yes")) {
    problems.push(
      `expected <meta name="mobile-web-app-capable" content="yes"> (the standardised tag, not only the apple-prefixed one)`,
    );
  }

  const titleMeta = metas.find(
    (attrs) => attrs.name === "apple-mobile-web-app-title",
  );
  if (!(titleMeta && titleMeta.content === EXPECTED_APPLE_TITLE)) {
    problems.push(
      `expected <meta name="apple-mobile-web-app-title" content="${EXPECTED_APPLE_TITLE}">, found ${JSON.stringify(titleMeta)}`,
    );
  }

  const links = findTags(html, "link");
  const appleTouchIcon = links.find(
    (attrs) => attrs.rel === "apple-touch-icon",
  );
  if (!(appleTouchIcon && appleTouchIcon.sizes === "180x180")) {
    problems.push(
      `expected <link rel="apple-touch-icon"> declaring sizes 180x180, found ${JSON.stringify(appleTouchIcon)}`,
    );
  }

  const favicon = links.find(
    (attrs) =>
      attrs.rel === "icon" &&
      attrs.type === "image/png" &&
      attrs.sizes === "32x32",
  );
  if (!favicon) {
    problems.push(
      `expected <link rel="icon" type="image/png" sizes="32x32">, none found among ${JSON.stringify(links.filter((a) => a.rel === "icon"))}`,
    );
  }

  return problems;
}

// A customer page must carry NONE of the vendor's install surface.
function validateCustomerHead(html) {
  const problems = [];

  const manifestLinks = findTags(html, "link").filter(
    (attrs) => attrs.rel === "manifest",
  );
  if (manifestLinks.length > 0) {
    problems.push(
      `expected NO <link rel="manifest">, found ${JSON.stringify(manifestLinks)}`,
    );
  }

  const metas = findTags(html, "meta");
  if (metas.some((attrs) => attrs.name === "mobile-web-app-capable")) {
    problems.push('expected NO <meta name="mobile-web-app-capable">');
  }
  if (metas.some((attrs) => attrs.name === "apple-mobile-web-app-title")) {
    problems.push('expected NO <meta name="apple-mobile-web-app-title">');
  }

  return problems;
}

// --- Fetch-backed checks ------------------------------------------------

async function checkManifestFields() {
  const res = await fetch(`${BASE}/manifest.webmanifest`);
  if (res.status !== 200) {
    fail(`GET /manifest.webmanifest returned ${res.status}, expected 200`);
    return null;
  }
  ok("GET /manifest.webmanifest returns 200");

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("manifest+json")) {
    ok(`content-type is "${contentType}"`);
  } else if (contentType.includes("json")) {
    ok(
      `content-type "${contentType}" contains "json" but not "manifest+json" — recorded, not failed`,
    );
  } else {
    fail(`content-type "${contentType}" does not contain "json"`);
  }

  let json;
  try {
    json = await res.json();
  } catch (err) {
    fail(`/manifest.webmanifest body did not parse as JSON: ${err.message}`);
    return null;
  }

  const problems = validateManifest(json);
  if (problems.length === 0) {
    ok("manifest JSON passes validateManifest with zero problems");
  } else {
    for (const problem of problems) fail(`manifest: ${problem}`);
  }

  return json;
}

async function checkIcons(json) {
  if (!json || !Array.isArray(json.icons)) return;
  for (const icon of json.icons) {
    const res = await fetch(new URL(icon.src, BASE));
    if (res.status !== 200) {
      fail(`GET ${icon.src} returned ${res.status}, expected 200`);
      continue;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType !== "image/png") {
      fail(`${icon.src} content-type is "${contentType}", expected image/png`);
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const dims = pngDimensions(bytes);
    const declared = parseSizes(icon.sizes);
    if (!dims) {
      fail(`${icon.src} does not decode as a PNG with a readable IHDR`);
    } else if (!declared) {
      fail(
        `${icon.src} declares an unparseable sizes value ${JSON.stringify(icon.sizes)}`,
      );
    } else if (
      dims.width !== declared.width ||
      dims.height !== declared.height
    ) {
      fail(
        `${icon.src} declares ${icon.sizes} but its PNG IHDR is ${dims.width}x${dims.height}`,
      );
    } else {
      ok(
        `${icon.src} is a ${dims.width}x${dims.height} image/png matching its declared sizes`,
      );
    }
  }
}

async function checkRootPage(json) {
  const res = await fetch(`${BASE}/`);
  if (res.status !== 200) {
    fail(`GET / returned ${res.status}, expected 200`);
    return;
  }
  ok("GET / returns 200");
  const html = await res.text();

  const manifestLinks = findTags(html, "link").filter(
    (attrs) => attrs.rel === "manifest",
  );
  if (
    manifestLinks.length === 1 &&
    manifestLinks[0].href === "/manifest.webmanifest"
  ) {
    ok('exactly one <link rel="manifest" href="/manifest.webmanifest"> on /');
  } else {
    fail(
      `expected exactly one <link rel="manifest" href="/manifest.webmanifest"> on /, found ${JSON.stringify(manifestLinks)}`,
    );
  }

  const themeMetas = findTags(html, "meta").filter(
    (attrs) => attrs.name === "theme-color",
  );
  const themeContent = themeMetas[0]?.content;
  if (
    json &&
    themeContent &&
    themeContent === json.theme_color &&
    themeContent === json.background_color
  ) {
    ok(
      `<meta name="theme-color"> content "${themeContent}" equals both manifest colours`,
    );
  } else {
    fail(
      `<meta name="theme-color"> content ${JSON.stringify(themeContent)} does not equal both manifest colours (theme_color=${JSON.stringify(json?.theme_color)}, background_color=${JSON.stringify(json?.background_color)})`,
    );
  }
}

async function fetchAndCheckIconLink(attrs, label) {
  if (!attrs?.href) {
    fail(`${label}: no href to fetch`);
    return;
  }
  const res = await fetch(new URL(attrs.href, BASE));
  if (res.status !== 200) {
    fail(`${label} (${attrs.href}) returned ${res.status}, expected 200`);
    return;
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType !== "image/png") {
    fail(
      `${label} (${attrs.href}) content-type is "${contentType}", expected image/png`,
    );
    return;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const dims = pngDimensions(bytes);
  const declared = parseSizes(attrs.sizes);
  if (!dims) {
    fail(
      `${label} (${attrs.href}) does not decode as a PNG with a readable IHDR`,
    );
  } else if (!declared) {
    fail(
      `${label} (${attrs.href}) declares an unparseable sizes value ${JSON.stringify(attrs.sizes)}`,
    );
  } else if (dims.width !== declared.width || dims.height !== declared.height) {
    fail(
      `${label} (${attrs.href}) declares ${attrs.sizes} but its PNG IHDR is ${dims.width}x${dims.height}`,
    );
  } else {
    ok(
      `${label} (${attrs.href}) is a ${dims.width}x${dims.height} image/png matching its declared sizes`,
    );
  }
}

async function checkVendorPaths() {
  for (const path of VENDOR_PATHS) {
    const res = await fetch(`${BASE}${path}`);
    if (res.status !== 200) {
      fail(`GET ${path} returned ${res.status}, expected 200`);
      continue;
    }
    ok(`GET ${path} returns 200`);
    const html = await res.text();
    const problems = validateVendorHead(html);
    if (problems.length === 0) {
      ok(`${path} carries the manifest link and both iOS web-app tags`);
    } else {
      for (const problem of problems) fail(`${path}: ${problem}`);
    }

    const links = findTags(html, "link");
    const appleTouchIcon = links.find(
      (attrs) => attrs.rel === "apple-touch-icon",
    );
    if (appleTouchIcon) {
      await fetchAndCheckIconLink(appleTouchIcon, `${path} apple-touch-icon`);
    }
    const favicon = links.find(
      (attrs) =>
        attrs.rel === "icon" &&
        attrs.type === "image/png" &&
        attrs.sizes === "32x32",
    );
    if (favicon) {
      await fetchAndCheckIconLink(favicon, `${path} icon`);
    }
  }
}

async function checkCustomerPaths() {
  for (const path of CUSTOMER_PATHS) {
    const res = await fetch(`${BASE}${path}`);
    if (res.status !== 200) {
      fail(`GET ${path} returned ${res.status}, expected 200`);
      continue;
    }
    ok(`GET ${path} returns 200`);
    const html = await res.text();
    const problems = validateCustomerHead(html);
    if (problems.length === 0) {
      ok(`${path} carries none of the vendor's install surface`);
    } else {
      for (const problem of problems) fail(`${path}: ${problem}`);
    }
  }
}

async function main() {
  const json = await checkManifestFields();
  await checkIcons(json);
  await checkRootPage(json);
  await checkVendorPaths();
  await checkCustomerPaths();

  if (failed) {
    console.error("\ncheck-manifest: FAIL");
  } else {
    console.log("\ncheck-manifest: PASS");
  }
}

// --- Self-test ------------------------------------------------------------

function buildFixturePng(width, height) {
  const buf = Buffer.alloc(24);
  PNG_SIGNATURE.copy(buf, 0);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

const GOOD_MANIFEST = {
  name: EXPECTED_NAME,
  short_name: EXPECTED_SHORT_NAME,
  start_url: EXPECTED_START_URL,
  display: EXPECTED_DISPLAY,
  theme_color: "#F9F8F5",
  background_color: "#F9F8F5",
  icons: [
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

const BAD_MANIFEST_FIXTURES = [
  ["icons array missing", { ...GOOD_MANIFEST, icons: undefined }],
  ["display browser", { ...GOOD_MANIFEST, display: "browser" }],
  ["short_name Store", { ...GOOD_MANIFEST, short_name: "Store" }],
  [
    "theme_color different from background_color",
    { ...GOOD_MANIFEST, theme_color: "#000000" },
  ],
  [
    "no maskable entry",
    {
      ...GOOD_MANIFEST,
      icons: GOOD_MANIFEST.icons.filter((icon) => icon.purpose !== "maskable"),
    },
  ],
  [
    "an icon src of /icon",
    {
      ...GOOD_MANIFEST,
      icons: [
        ...GOOD_MANIFEST.icons,
        { src: "/icon", sizes: "32x32", type: "image/png" },
      ],
    },
  ],
];

const GOOD_VENDOR_HEAD = `<head>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${EXPECTED_APPLE_TITLE}">
<link rel="apple-touch-icon" href="/apple-icon.png?v=1" sizes="180x180">
<link rel="icon" href="/icon.png?v=1" type="image/png" sizes="32x32">
</head>`;

const GOOD_CUSTOMER_HEAD = `<head>
<link rel="apple-touch-icon" href="/apple-icon.png?v=1" sizes="180x180">
<link rel="icon" href="/icon.png?v=1" type="image/png" sizes="32x32">
</head>`;

const BAD_VENDOR_HEAD_FIXTURES = [
  [
    "vendor head missing the manifest link",
    GOOD_VENDOR_HEAD.replace(
      '<link rel="manifest" href="/manifest.webmanifest">\n',
      "",
    ),
  ],
  [
    "vendor head carrying ONLY apple-mobile-web-app-capable, not the standardised mobile-web-app-capable",
    GOOD_VENDOR_HEAD.replace(
      '<meta name="mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-capable" content="yes">',
    ),
  ],
  [
    'vendor head whose title meta says "Store"',
    GOOD_VENDOR_HEAD.replace(
      `<meta name="apple-mobile-web-app-title" content="${EXPECTED_APPLE_TITLE}">`,
      '<meta name="apple-mobile-web-app-title" content="Store">',
    ),
  ],
];

const BAD_CUSTOMER_HEAD_FIXTURES = [
  [
    "customer head carrying the manifest link",
    GOOD_CUSTOMER_HEAD.replace(
      "<head>\n",
      '<head>\n<link rel="manifest" href="/manifest.webmanifest">\n',
    ),
  ],
];

function runSelfTest() {
  let selfTestFailed = false;

  const goodProblems = validateManifest(GOOD_MANIFEST);
  if (goodProblems.length === 0) {
    ok("self-test: the good manifest fixture produces zero problems");
  } else {
    selfTestFailed = true;
    console.error(
      `not ok: self-test: the good manifest fixture unexpectedly produced problems: ${goodProblems.join("; ")}`,
    );
  }

  for (const [label, fixture] of BAD_MANIFEST_FIXTURES) {
    const problems = validateManifest(fixture);
    if (problems.length > 0) {
      ok(
        `self-test: bad fixture "${label}" is flagged (${problems.length} problem(s))`,
      );
    } else {
      selfTestFailed = true;
      console.error(
        `not ok: self-test: bad fixture "${label}" was NOT flagged`,
      );
    }
  }

  // pngDimensions: a well-formed PNG's declared IHDR is read correctly...
  const goodPng = buildFixturePng(512, 512);
  const goodDims = pngDimensions(goodPng);
  if (goodDims && goodDims.width === 512 && goodDims.height === 512) {
    ok(
      "self-test: pngDimensions reads a well-formed 512x512 fixture correctly",
    );
  } else {
    selfTestFailed = true;
    console.error(
      `not ok: self-test: pngDimensions misread a well-formed 512x512 fixture: ${JSON.stringify(goodDims)}`,
    );
  }

  // ...and a PNG whose IHDR says 192 declared as 512x512 in the manifest
  // is caught by comparing pngDimensions' result against the declared size
  // (the same comparison checkIcons performs against a live fetch).
  const mismatchedPng = buildFixturePng(192, 192);
  const mismatchedDims = pngDimensions(mismatchedPng);
  const declared512 = parseSizes("512x512");
  const mismatchCaught =
    mismatchedDims &&
    declared512 &&
    (mismatchedDims.width !== declared512.width ||
      mismatchedDims.height !== declared512.height);
  if (mismatchCaught) {
    ok(
      "self-test: a PNG whose IHDR says 192 declared as 512x512 is caught as a mismatch",
    );
  } else {
    selfTestFailed = true;
    console.error(
      "not ok: self-test: a 192-declared-as-512 mismatch was NOT caught",
    );
  }

  // A non-PNG buffer must decode as null, not throw and not report a size.
  const nonPngBuffer = Buffer.from("this is definitely not a png file at all");
  const nonPngDims = pngDimensions(nonPngBuffer);
  if (nonPngDims === null) {
    ok("self-test: a non-PNG buffer is correctly rejected (null)");
  } else {
    selfTestFailed = true;
    console.error(
      `not ok: self-test: a non-PNG buffer was NOT rejected: ${JSON.stringify(nonPngDims)}`,
    );
  }

  const goodVendorProblems = validateVendorHead(GOOD_VENDOR_HEAD);
  if (goodVendorProblems.length === 0) {
    ok("self-test: the good vendor head fixture produces zero problems");
  } else {
    selfTestFailed = true;
    console.error(
      `not ok: self-test: the good vendor head fixture unexpectedly produced problems: ${goodVendorProblems.join("; ")}`,
    );
  }

  const goodCustomerProblems = validateCustomerHead(GOOD_CUSTOMER_HEAD);
  if (goodCustomerProblems.length === 0) {
    ok("self-test: the good customer head fixture produces zero problems");
  } else {
    selfTestFailed = true;
    console.error(
      `not ok: self-test: the good customer head fixture unexpectedly produced problems: ${goodCustomerProblems.join("; ")}`,
    );
  }

  for (const [label, fixture] of BAD_VENDOR_HEAD_FIXTURES) {
    const problems = validateVendorHead(fixture);
    if (problems.length > 0) {
      ok(
        `self-test: bad vendor-head fixture "${label}" is flagged (${problems.length} problem(s))`,
      );
    } else {
      selfTestFailed = true;
      console.error(
        `not ok: self-test: bad vendor-head fixture "${label}" was NOT flagged`,
      );
    }
  }

  for (const [label, fixture] of BAD_CUSTOMER_HEAD_FIXTURES) {
    const problems = validateCustomerHead(fixture);
    if (problems.length > 0) {
      ok(
        `self-test: bad customer-head fixture "${label}" is flagged (${problems.length} problem(s))`,
      );
    } else {
      selfTestFailed = true;
      console.error(
        `not ok: self-test: bad customer-head fixture "${label}" was NOT flagged`,
      );
    }
  }

  if (selfTestFailed) {
    console.error("\ncheck-manifest --self-test: FAIL");
    process.exitCode = 1;
  } else {
    console.log("\ncheck-manifest --self-test: PASS");
  }
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  main().catch((err) => {
    fail(err instanceof Error ? err.message : String(err));
    console.error("\ncheck-manifest: FAIL");
  });
}

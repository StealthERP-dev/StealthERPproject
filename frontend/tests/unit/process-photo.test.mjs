// Unit test (no database, no browser): proves the pipeline's DECISION
// logic — the target-dimension arithmetic, the no-upscale rule, the
// quality-stepping loop, the strict byte ceiling, the format guard and the
// undecodable path — through the injectable seam process-photo.ts exports.
// Every test injects a fake decode/createSurface/encode; no real
// createImageBitmap or canvas call is ever touched here (RESEARCH.md's
// Validation Architecture: those stay manual/smoke-only, this file proves
// the decisions built on top of them).
//
// The surface-factory assertions check what createSurface was CALLED WITH,
// not only the blob processPhoto returns — that is what makes D-11
// mechanical: a version that allocates a surface sized by the SOURCE photo
// would still return a plausible-looking blob (a real canvas silently
// produces a blank image rather than throwing), so only inspecting the
// factory's call arguments actually proves the one allocation happened at
// the target and never at the source dimensions. See this file's own
// falsifiability run, recorded in 03-04-SUMMARY.md, which broke exactly
// this and watched the corresponding test go red.

import { test } from "node:test";
import assert from "node:assert/strict";
import { processPhoto } from "../../src/features/products/lib/process-photo.ts";

/** Mirrors process-photo.ts's own fixed constants (D-02/D-04) — duplicated
 * here deliberately rather than imported, since the module under test stays
 * zero-import and exports no constants of its own. */
const TARGET_LONGEST_EDGE = 800;
const MAX_BYTES = 300 * 1024;

function makeBlob(type, size) {
  return new Blob([new Uint8Array(Math.max(0, size))], { type });
}

function makeFile() {
  return new File([new Uint8Array(1)], "photo.jpg", { type: "image/jpeg" });
}

function recordingSurfaceFactory() {
  const calls = [];
  const createSurface = (width, height) => {
    calls.push({ width, height });
    return { draw: () => {} };
  };
  return { createSurface, calls };
}

test("processPhoto: target dimensions have the fixed longest edge and preserve the source's own aspect ratio", async () => {
  const CASES = [
    { label: "landscape", width: 4000, height: 3000 },
    { label: "portrait", width: 3000, height: 4000 },
    { label: "square", width: 2000, height: 2000 },
    {
      label: "far larger than any real phone camera output",
      width: 12000,
      height: 9000,
    },
  ];

  for (const { label, width, height } of CASES) {
    const { createSurface, calls } = recordingSurfaceFactory();
    const deps = {
      decode: () => Promise.resolve({ width, height, close: () => {} }),
      createSurface,
      encode: () => Promise.resolve(makeBlob("image/jpeg", 1000)),
    };

    await processPhoto(makeFile(), deps);

    assert.equal(
      calls.length,
      1,
      `${label}: createSurface should be called exactly once`,
    );
    const { width: targetW, height: targetH } = calls[0];
    const longestTarget = Math.max(targetW, targetH);
    assert.equal(
      longestTarget,
      TARGET_LONGEST_EDGE,
      `${label}: expected the longest target edge to be ${String(TARGET_LONGEST_EDGE)}, got ${String(longestTarget)} (called with ${JSON.stringify(calls[0])})`,
    );

    const sourceRatio = width / height;
    const targetRatio = targetW / targetH;
    assert.ok(
      Math.abs(sourceRatio - targetRatio) < 0.01,
      `${label}: expected the target aspect ratio to match the source's ${sourceRatio} within tolerance, got ${targetRatio}`,
    );
  }
});

test("processPhoto: a source already smaller than the target is re-encoded at its own size, never enlarged", async () => {
  const { createSurface, calls } = recordingSurfaceFactory();
  const deps = {
    decode: () => Promise.resolve({ width: 400, height: 300, close: () => {} }),
    createSurface,
    encode: () => Promise.resolve(makeBlob("image/jpeg", 1000)),
  };

  await processPhoto(makeFile(), deps);

  assert.deepEqual(
    calls,
    [{ width: 400, height: 300 }],
    "a photo already smaller than the 800px target must not be upscaled",
  );
});

test("processPhoto: when the first quality level is already under the ceiling, the encoder runs exactly once and that blob is returned", async () => {
  const encodeCalls = [];
  const goodBlob = makeBlob("image/jpeg", 1000);
  const deps = {
    decode: () =>
      Promise.resolve({ width: 1200, height: 900, close: () => {} }),
    createSurface: () => ({ draw: () => {} }),
    encode: (surface, quality) => {
      encodeCalls.push(quality);
      return Promise.resolve(goodBlob);
    },
  };

  const result = await processPhoto(makeFile(), deps);

  assert.deepEqual(encodeCalls, [0.8]);
  assert.equal(result.error, undefined);
  assert.equal(result.blob, goodBlob);
});

test("processPhoto: when the first two quality levels are too large, the encoder steps to the third and that blob is returned", async () => {
  const encodeCalls = [];
  const tooLarge = makeBlob("image/jpeg", MAX_BYTES + 1000);
  const goodBlob = makeBlob("image/jpeg", 1000);
  const deps = {
    decode: () =>
      Promise.resolve({ width: 1200, height: 900, close: () => {} }),
    createSurface: () => ({ draw: () => {} }),
    encode: (surface, quality) => {
      encodeCalls.push(quality);
      return Promise.resolve(quality === 0.4 ? goodBlob : tooLarge);
    },
  };

  const result = await processPhoto(makeFile(), deps);

  assert.deepEqual(
    encodeCalls,
    [0.8, 0.6, 0.4],
    "the encoder must have been called exactly three times, once per quality step",
  );
  assert.equal(result.error, undefined);
  assert.equal(result.blob, goodBlob);
});

test("processPhoto: when every quality level stays over the ceiling, the too_large code is returned and no blob is handed back", async () => {
  const encodeCalls = [];
  const tooLarge = makeBlob("image/jpeg", MAX_BYTES + 1000);
  const deps = {
    decode: () =>
      Promise.resolve({ width: 1200, height: 900, close: () => {} }),
    createSurface: () => ({ draw: () => {} }),
    encode: (surface, quality) => {
      encodeCalls.push(quality);
      return Promise.resolve(tooLarge);
    },
  };

  const result = await processPhoto(makeFile(), deps);

  assert.deepEqual(encodeCalls, [0.8, 0.6, 0.4]);
  assert.equal(result.error, "too_large");
  assert.equal(result.blob, undefined);
});

test("processPhoto: a result exactly at the ceiling is not accepted — only a result strictly under it is", async () => {
  const encodeCalls = [];
  const exactlyAtCeiling = makeBlob("image/jpeg", MAX_BYTES);
  const deps = {
    decode: () =>
      Promise.resolve({ width: 1200, height: 900, close: () => {} }),
    createSurface: () => ({ draw: () => {} }),
    encode: (surface, quality) => {
      encodeCalls.push(quality);
      return Promise.resolve(exactlyAtCeiling);
    },
  };

  const result = await processPhoto(makeFile(), deps);

  assert.equal(
    encodeCalls.length,
    3,
    "a blob exactly at the ceiling must be rejected at every quality level, never accepted as an off-by-one pass",
  );
  assert.equal(result.error, "too_large");
  assert.equal(result.blob, undefined);
});

test("processPhoto: a result under the ceiling but not typed as JPEG is rejected, and stepping does not stop early on it", async () => {
  const encodeCalls = [];
  // Under the byte ceiling, but the wrong format — simulates toBlob's
  // documented PNG fallback when the requested type can't be produced.
  const wrongFormat = makeBlob("image/png", 1000);
  const deps = {
    decode: () =>
      Promise.resolve({ width: 1200, height: 900, close: () => {} }),
    createSurface: () => ({ draw: () => {} }),
    encode: (surface, quality) => {
      encodeCalls.push(quality);
      return Promise.resolve(wrongFormat);
    },
  };

  const result = await processPhoto(makeFile(), deps);

  assert.deepEqual(
    encodeCalls,
    [0.8, 0.6, 0.4],
    "a non-JPEG result under the ceiling must not stop the stepping early",
  );
  assert.equal(result.error, "too_large");
  assert.equal(result.blob, undefined);
});

test("processPhoto: a decode rejection produces the undecodable code, with no surface allocated and no encode attempted", async () => {
  let surfaceCalls = 0;
  let encodeCalls = 0;
  const deps = {
    decode: () => Promise.reject(new Error("cannot decode this format")),
    createSurface: () => {
      surfaceCalls += 1;
      return { draw: () => {} };
    },
    encode: () => {
      encodeCalls += 1;
      return Promise.resolve(makeBlob("image/jpeg", 1000));
    },
  };

  const result = await processPhoto(makeFile(), deps);

  assert.equal(result.error, "undecodable");
  assert.equal(result.blob, undefined);
  assert.equal(
    surfaceCalls,
    0,
    "a decode failure must never allocate a drawing surface",
  );
  assert.equal(encodeCalls, 0, "a decode failure must never attempt to encode");
});

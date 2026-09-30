// The browser-side photo pipeline (PROD-04). Imports nothing — not a type,
// not the `@/` alias — so `node --test` can load this file directly, the
// same zero-project-import convention `phone.ts` and `log-event-core.ts`
// already establish.
//
// D-11, and why this file allocates a drawing surface exactly once: the
// dangerous failure here is not a decode error — a format the engine can't
// read rejects cleanly, before any surface exists, and that rejection is
// this pipeline's `undecodable` code. The real danger is a modern phone
// camera's full-resolution photo exceeding a browser engine's 2D drawing
// area limit, which some engines answer with a blank or black result and NO
// thrown error anywhere. Drawing a source-resolution image first and
// shrinking it afterwards would allocate that oversized surface as an
// intermediate step; we would upload a white square and tell the vendor it
// worked, with nothing downstream able to tell the difference. This file
// never allocates a surface at the source photo's size: it decodes,
// computes the small target dimensions first, and allocates the ONE surface
// this file ever creates already at that target — so the failure this
// guards against cannot be reached by construction, not merely detected
// after the fact. A future edit splitting this into "draw full-size, then
// shrink" as an optimisation must read this comment and the falsifiability
// tests in tests/unit/process-photo.test.mjs before doing so.
//
// The decode step's own orientation option — not a hand-written EXIF
// parser — corrects a sideways photo (D-03). A manual parser risks
// double-rotating on an engine that already applies it, a well-documented
// bug class in exactly this problem space.

/** What `createSurface` hands back: something that can draw a decoded photo
 * into itself. The real implementation closes over an actual canvas; a test
 * fake only needs to exist and record what it was asked to draw. */
export interface PhotoSurface {
  draw: (image: ImageBitmap) => void;
}

/** The seam Task 2's unit suite drives: every real browser call — decode,
 * allocate, encode — goes through here, with a real-browser default so
 * every call site outside this file passes only the picked file. */
export interface ProcessPhotoDeps {
  decode: (file: File) => Promise<ImageBitmap>;
  createSurface: (width: number, height: number) => PhotoSurface;
  encode: (surface: PhotoSurface, quality: number) => Promise<Blob | null>;
}

export type ProcessPhotoErrorCode = "undecodable" | "too_large";

export type ProcessPhotoResult =
  | { blob: Blob; error?: undefined }
  | { blob?: undefined; error: ProcessPhotoErrorCode };

/** Longest edge of the resized photo (D-02). */
const TARGET_LONGEST_EDGE = 800;
/** Hard ceiling in bytes (D-04) — never relaxed, upward or downward. It is
 * what makes a shared product render as a link-preview thumbnail in
 * Phase 4. */
const MAX_BYTES = 300 * 1024;
/** Quality steps tried in order, stopping at the first result under the
 * ceiling (D-02). Only once every level here is still too large does the
 * vendor see an error. */
const QUALITY_STEPS = [0.8, 0.6, 0.4] as const;

interface RealSurface extends PhotoSurface {
  readonly canvas: HTMLCanvasElement;
}

function isRealSurface(surface: PhotoSurface): surface is RealSurface {
  return "canvas" in surface;
}

/** The one drawing-surface allocation site in this file. Always sized at
 * the caller's target dimensions — see the file header for why that
 * ordering is load-bearing. */
function createRealSurface(width: number, height: number): RealSurface {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return {
    canvas,
    draw(image) {
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(image, 0, 0, width, height);
      }
    },
  };
}

function encodeRealSurface(
  surface: PhotoSurface,
  quality: number,
): Promise<Blob | null> {
  if (!isRealSurface(surface)) return Promise.resolve(null);
  return new Promise((resolve) => {
    surface.canvas.toBlob(resolve, "image/jpeg", quality);
  });
}

const REAL_DEPS: ProcessPhotoDeps = {
  decode: (file) => createImageBitmap(file, { imageOrientation: "from-image" }),
  createSurface: createRealSurface,
  encode: encodeRealSurface,
};

/** Decode, resize (never upscale), orient and encode a picked photo into a
 * small upright JPEG, or fail with one of two codes: `undecodable` (the
 * engine could not read this file — D-01) or `too_large` (every quality
 * step stayed over the ceiling — D-02/D-04). The `deps` parameter is the
 * seam tests/unit/process-photo.test.mjs drives; every real call site
 * outside this file passes only `file`. */
export async function processPhoto(
  file: File,
  deps: ProcessPhotoDeps = REAL_DEPS,
): Promise<ProcessPhotoResult> {
  let decoded: ImageBitmap;
  try {
    decoded = await deps.decode(file);
  } catch {
    return { error: "undecodable" };
  }

  // Target size computed from the decoded image's OWN dimensions, before
  // any surface exists — this ordering is D-11 (see file header). The
  // scale is capped at 1 so a photo already smaller than the target is
  // re-encoded, never enlarged.
  const longestEdge = Math.max(decoded.width, decoded.height);
  const scale =
    longestEdge > 0 ? Math.min(1, TARGET_LONGEST_EDGE / longestEdge) : 1;
  const targetWidth = Math.max(1, Math.round(decoded.width * scale));
  const targetHeight = Math.max(1, Math.round(decoded.height * scale));

  const surface = deps.createSurface(targetWidth, targetHeight);
  surface.draw(decoded);
  decoded.close();

  for (const quality of QUALITY_STEPS) {
    const blob = await deps.encode(surface, quality);
    // The encoder falls back to a different format rather than throwing
    // when it cannot produce the requested one — verified here before the
    // size check is trusted, since a fallback format at the same quality
    // number is a different (and larger) result entirely.
    if (blob?.type === "image/jpeg" && blob.size < MAX_BYTES) {
      return { blob };
    }
  }

  return { error: "too_large" };
}

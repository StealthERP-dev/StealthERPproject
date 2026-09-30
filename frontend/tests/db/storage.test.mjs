// HTTP (Storage API) test: a signed-in vendor uploads a JPEG into their own
// store folder and anyone, with no session, can load it by public URL
// (PLAT-05 tracer). Also covers every rejected write path (cross-folder,
// oversize, non-JPEG, anonymous) and confirms a vendor cannot remove or
// overwrite another vendor's object (Task 3).

import { test } from "node:test";
import assert from "node:assert/strict";
import { anonClient, signUpVendor, randomDigits } from "./_env.mjs";

const BUCKET = "product-images";

// Signs up a fresh vendor and inserts their own stores row through their own
// session (owner_id = userId), mirroring the shape Phase 2/3 will use.
export async function createVendorStore() {
  const { client, userId, phone } = await signUpVendor();
  const slug = `t-${phone}`;

  const { data, error } = await client
    .from("stores")
    .insert({
      owner_id: userId,
      phone,
      shop_name: `Test Shop ${phone}`,
      vendor_name: "Test Vendor",
      slug,
    })
    .select("id")
    .single();
  assert.equal(error, null);

  return { client, storeId: data.id, phone };
}

// Returns a Uint8Array of exactly `size` bytes starting with the JPEG
// SOI/APP0 marker bytes (FF D8 FF E0), so the Storage API's mime sniffing (if
// any) and our own contentType assertions both see a real JPEG shape.
export function jpegBytes(size) {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
}

test("storage tracer: a vendor uploads a JPEG into their own folder and anyone can load it by public URL", async () => {
  const { client, storeId } = await createVendorStore();

  const path = `${storeId}/tracer-${randomDigits(8)}.jpg`;
  const { error: uploadError } = await client.storage
    .from(BUCKET)
    .upload(path, jpegBytes(1024), { contentType: "image/jpeg" });
  assert.equal(uploadError, null);

  const {
    data: { publicUrl },
  } = anonClient().storage.from(BUCKET).getPublicUrl(path);

  const response = await fetch(publicUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^image\/jpeg/);

  const body = await response.arrayBuffer();
  assert.equal(body.byteLength, 1024);
});

test("storage: exactly 2,097,152 bytes into own folder succeeds; 2,097,153 bytes is rejected", async () => {
  const { client, storeId } = await createVendorStore();

  const okPath = `${storeId}/max-size-${randomDigits(8)}.jpg`;
  const { error: okError } = await client.storage
    .from(BUCKET)
    .upload(okPath, jpegBytes(2097152), { contentType: "image/jpeg" });
  assert.equal(okError, null);

  const oversizePath = `${storeId}/oversize-${randomDigits(8)}.jpg`;
  const { error: oversizeError } = await client.storage
    .from(BUCKET)
    .upload(oversizePath, jpegBytes(2097153), { contentType: "image/jpeg" });
  assert.ok(oversizeError);
});

test("storage: non-JPEG content types (image/png, text/html) are rejected into own folder", async () => {
  const { client, storeId } = await createVendorStore();

  const { error: pngError } = await client.storage
    .from(BUCKET)
    .upload(`${storeId}/not-a-jpeg-${randomDigits(8)}.png`, jpegBytes(1024), {
      contentType: "image/png",
    });
  assert.ok(pngError);

  const { error: htmlError } = await client.storage
    .from(BUCKET)
    .upload(
      `${storeId}/not-a-jpeg-${randomDigits(8)}.html`,
      new TextEncoder().encode("<script>alert(1)</script>"),
      { contentType: "text/html" },
    );
  assert.ok(htmlError);
});

test("storage: uploading into another vendor's folder, at the bucket root, or with no session all fail", async () => {
  const a = await createVendorStore();
  const b = await createVendorStore();

  const { error: crossFolderError } = await a.client.storage
    .from(BUCKET)
    .upload(`${b.storeId}/cross-${randomDigits(8)}.jpg`, jpegBytes(1024), {
      contentType: "image/jpeg",
    });
  assert.ok(crossFolderError);

  const { error: rootError } = await a.client.storage
    .from(BUCKET)
    .upload(`root-${randomDigits(8)}.jpg`, jpegBytes(1024), {
      contentType: "image/jpeg",
    });
  assert.ok(rootError);

  const { error: anonError } = await anonClient()
    .storage.from(BUCKET)
    .upload(`${a.storeId}/anon-${randomDigits(8)}.jpg`, jpegBytes(1024), {
      contentType: "image/jpeg",
    });
  assert.ok(anonError);
});

test("storage: a vendor cannot remove or overwrite another vendor's object; the object stays publicly downloadable", async () => {
  const a = await createVendorStore();
  const b = await createVendorStore();

  const bPath = `${b.storeId}/owned-by-b-${randomDigits(8)}.jpg`;
  const { error: bUploadError } = await b.client.storage
    .from(BUCKET)
    .upload(bPath, jpegBytes(1024), { contentType: "image/jpeg" });
  assert.equal(bUploadError, null);

  // A's overwrite of B's object fails
  const { error: overwriteError } = await a.client.storage
    .from(BUCKET)
    .update(bPath, jpegBytes(2048), { contentType: "image/jpeg" });
  assert.ok(overwriteError);

  // A's remove of B's object leaves it publicly downloadable
  await a.client.storage.from(BUCKET).remove([bPath]);

  const {
    data: { publicUrl },
  } = anonClient().storage.from(BUCKET).getPublicUrl(bPath);
  const response = await fetch(publicUrl);
  assert.equal(response.status, 200);
});

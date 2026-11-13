import { describe, expect, it } from "vitest";
import { checkDeclaredLength, checkPhotoUpload, isPhotoId, MAX_PHOTO_BYTES, photoKey, photoUrl } from "./photo";

const ID = "3f2c1a9e-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe("isPhotoId", () => {
  it("accepts a random UUID", () => {
    expect(isPhotoId(ID)).toBe(true);
    expect(isPhotoId(crypto.randomUUID())).toBe(true);
  });

  it.each([ID.toUpperCase(), `${ID}.jpg`, "../secret", "photos/x", "", 7, null])("rejects %j", (value) => {
    expect(isPhotoId(value)).toBe(false);
  });
});

describe("photoUrl and photoKey", () => {
  it("place a photo under the API and the bucket", () => {
    expect(photoUrl(ID)).toBe(`/api/photo/${ID}`);
    expect(photoKey(ID)).toBe(`photos/${ID}.jpg`);
  });
});

describe("checkDeclaredLength", () => {
  it("rejects a declared size over the limit before reading", () => {
    expect(checkDeclaredLength(String(MAX_PHOTO_BYTES + 1))).toMatchObject({ ok: false, error: { status: 413 } });
  });

  it.each([String(MAX_PHOTO_BYTES), "12", null, "garbage"])("lets %j through to the real check", (value) => {
    expect(checkDeclaredLength(value).ok).toBe(true);
  });
});

describe("checkPhotoUpload", () => {
  it("accepts a JPEG", () => {
    expect(checkPhotoUpload("image/jpeg", JPEG)).toEqual({ ok: true, value: JPEG });
    expect(checkPhotoUpload("Image/JPEG; charset=binary", JPEG).ok).toBe(true);
  });

  it.each([null, "image/png", "text/html", "image/jpegx"])("rejects content type %j", (type) => {
    expect(checkPhotoUpload(type, JPEG)).toMatchObject({ ok: false, error: { status: 415 } });
  });

  it("rejects bytes that aren't a JPEG, whatever the header says", () => {
    const html = new TextEncoder().encode("<script>alert(1)</script>");
    expect(checkPhotoUpload("image/jpeg", html)).toMatchObject({ ok: false, error: { status: 415 } });
    expect(checkPhotoUpload("image/jpeg", new Uint8Array())).toMatchObject({ ok: false, error: { status: 415 } });
  });

  it("rejects a photo over the limit", () => {
    const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
    big.set(JPEG);
    expect(checkPhotoUpload("image/jpeg", big)).toMatchObject({ ok: false, error: { status: 413 } });
  });
});

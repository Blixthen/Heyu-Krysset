// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareImages, prepareStoreCopy, SHARE_IMAGE_BUDGET } from "./image";

/**
 * jsdom has no canvas encoder, so we fake one whose output size grows with
 * pixel count and quality. `bytesPerPixel` tunes how "heavy" the photo is.
 */
function fakeCanvas(bytesPerPixel: number) {
  const renders: { width: number; quality: number }[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    const { width } = this;
    const getImageData = (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, from: width });
    return { drawImage: vi.fn(), getImageData } as never;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement, _type, quality) {
    renders.push({ width: this.width, quality: quality as number });
    const length = Math.round(this.width * this.height * bytesPerPixel * (quality as number));
    return `data:image/jpeg;base64,${"A".repeat(length)}`;
  });
  const blobs = fakeBlobs();
  return Object.assign(renders, { blobs });
}

/** jsdom's toBlob never calls back; record what was asked for and hand back a blob. */
function fakeBlobs(blob: Blob | null = new Blob(["jpeg"], { type: "image/jpeg" })) {
  const blobs: { width: number; type?: string; quality?: unknown }[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback, type, quality) {
    blobs.push({ width: this.width, type, quality });
    callback(blob);
  });
  return blobs;
}

const close = vi.fn();

beforeEach(() => {
  close.mockReset();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 2000, height: 2800, close })));
});

const file = new File(["x"], "kryss.jpg");

describe("prepareImages", () => {
  it("keeps the analysis image at high quality and 1400px", async () => {
    const renders = fakeCanvas(0.01);
    const images = await prepareImages(file);
    expect(renders[0]).toEqual({ width: 1400, quality: 0.82 });
    expect(images.mimeType).toBe("image/jpeg");
    expect(images.analyzeBase64).not.toContain("data:");
  });

  it("reads the pixels of the analysis image", async () => {
    fakeCanvas(0.01);
    const images = await prepareImages(file);
    expect(images.pixels).toEqual({ width: 1400, height: 1960, from: 1400 });
  });

  it("still prepares the JPEGs when the browser refuses to hand out pixels", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,AAAA");
    fakeBlobs();
    const images = await prepareImages(file);
    expect(images.pixels).toBeNull();
    expect(images.analyzeBase64).toBe("AAAA");
  });

  it("uses the best share quality that fits the budget", async () => {
    fakeCanvas(0.01);
    const images = await prepareImages(file);
    expect(images.shareDataUrl.length).toBeLessThanOrEqual(SHARE_IMAGE_BUDGET + 30);
  });

  it("steps down width and quality until the share image fits", async () => {
    const renders = fakeCanvas(0.2);
    const images = await prepareImages(file);
    const base64 = images.shareDataUrl.slice(images.shareDataUrl.indexOf(",") + 1);
    expect(base64.length).toBeLessThanOrEqual(SHARE_IMAGE_BUDGET);
    expect(renders.at(-1)!.width).toBeLessThan(1400);
  });

  it("always frees the bitmap", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(prepareImages(file)).rejects.toThrow();
    expect(close).toHaveBeenCalled();
  });
});

describe("prepareStoreCopy", () => {
  const bitmap = (width: number, height: number) => vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width, height, close })));

  it("makes a sharp JPEG at most 3000px wide", async () => {
    bitmap(5712, 4284);
    const { blobs } = fakeCanvas(0.01);
    const blob = await prepareStoreCopy(file);
    expect(blobs).toEqual([{ width: 3000, type: "image/jpeg", quality: 0.8 }]);
    expect(blob?.type).toBe("image/jpeg");
    expect(close).toHaveBeenCalled();
  });

  it("keeps a smaller photo at its own size", async () => {
    const { blobs } = fakeCanvas(0.01);
    await prepareStoreCopy(file);
    expect(blobs[0].width).toBe(2000);
  });

  it("caps the pixels of a tall photo, not only its width", async () => {
    bitmap(2000, 12_000);
    const { blobs } = fakeCanvas(0.01);
    await prepareStoreCopy(file);
    // 12M pixels at 1:6 is about 1414 × 8485.
    expect(blobs[0].width).toBe(1414);
  });

  it.each([
    ["the canvas can't be made", () => vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)],
    ["the browser can't encode it", () => fakeBlobs(null)],
    ["the photo can't be decoded", () => vi.stubGlobal("createImageBitmap", vi.fn(async () => Promise.reject(new Error("bad"))))],
  ])("gives null instead of failing when %s", async (_name, breakIt) => {
    fakeCanvas(0.01);
    breakIt();
    await expect(prepareStoreCopy(file)).resolves.toBeNull();
  });
});

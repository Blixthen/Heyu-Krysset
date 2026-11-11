// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareImages, SHARE_IMAGE_BUDGET } from "./image";

/**
 * jsdom has no canvas encoder, so we fake one whose output size grows with
 * pixel count and quality. `bytesPerPixel` tunes how "heavy" the photo is.
 */
function fakeCanvas(bytesPerPixel: number) {
  const renders: { width: number; quality: number }[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement, _type, quality) {
    renders.push({ width: this.width, quality: quality as number });
    const length = Math.round(this.width * this.height * bytesPerPixel * (quality as number));
    return `data:image/jpeg;base64,${"A".repeat(length)}`;
  });
  return renders;
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

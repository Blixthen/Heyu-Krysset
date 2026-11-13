import { describe, expect, it } from "vitest";
import { anchoredScroll, BASE_WIDTH_PX, clampZoom, MAX_ZOOM, minZoom, pinchZoom, wheelZoom } from "./zoom";

describe("minZoom", () => {
  it("lets a phone zoom out until the photo fits its width", () => {
    expect(minZoom(460)).toBe(460 / BASE_WIDTH_PX);
  });

  it("never goes below the base width on a wide screen, where it already fits", () => {
    expect(minZoom(1400)).toBe(1);
  });

  it("stays at 1 when the view has no width yet", () => {
    expect(minZoom(0)).toBe(1);
    expect(minZoom(NaN)).toBe(1);
  });
});

describe("clampZoom", () => {
  it("keeps zoom between fitting the view and MAX_ZOOM", () => {
    expect(clampZoom(0.1, 460)).toBe(0.5);
    expect(clampZoom(9, 460)).toBe(MAX_ZOOM);
    expect(clampZoom(2.5, 460)).toBe(2.5);
  });

  it("falls back to 1 for a zoom that isn't a number", () => {
    expect(clampZoom(NaN, 460)).toBe(1);
    expect(clampZoom(Infinity, 460)).toBe(1);
  });
});

describe("wheelZoom", () => {
  it("zooms in when scrolling up and out when scrolling down", () => {
    expect(wheelZoom(2, -100)).toBeGreaterThan(2);
    expect(wheelZoom(2, 100)).toBeLessThan(2);
    expect(wheelZoom(2, 0)).toBe(2);
  });

  it("counts a wheel that reports lines as more than one pixel per line", () => {
    expect(wheelZoom(1, -3, 1)).toBeCloseTo(wheelZoom(1, -48));
  });

  it("undoes itself when scrolled back the same amount", () => {
    expect(wheelZoom(wheelZoom(1.5, -120), 120)).toBeCloseTo(1.5);
  });
});

describe("pinchZoom", () => {
  it("scales with how far the fingers spread", () => {
    expect(pinchZoom(1.5, 100, 200)).toBe(3);
    expect(pinchZoom(2, 200, 100)).toBe(1);
  });

  it("keeps the starting zoom when a distance is zero", () => {
    expect(pinchZoom(1.5, 0, 100)).toBe(1.5);
    expect(pinchZoom(1.5, 100, 0)).toBe(1.5);
  });
});

describe("anchoredScroll", () => {
  it("keeps the point under the anchor still when zooming in", () => {
    // The point at 300 + 100 = 400 px into the content moves to 800 px at twice the size.
    expect(anchoredScroll(300, 100, 1, 2)).toBe(700);
  });

  it("keeps it still when zooming out", () => {
    expect(anchoredScroll(700, 100, 2, 1)).toBe(300);
  });

  it("never scrolls before the start", () => {
    expect(anchoredScroll(0, 200, 2, 1)).toBe(0);
  });
});

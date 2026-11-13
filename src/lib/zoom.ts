/**
 * Zooming the crossword photo. Zoom is a factor on the grid's base width:
 * at 1 the photo is BASE_WIDTH_PX wide, or the whole view if that is wider.
 * The letter squares are placed in percentages of the photo, so they scale
 * with it. Pure: the component measures the view and applies the results.
 */

/** The photo's width at zoom 1, wide enough that letter squares are easy to tap on a phone. */
export const BASE_WIDTH_PX = 920;

/** The closest zoom. The stored photo is at most 3000 px wide, about 3.3× the base width, so beyond this it only gets blurrier. */
export const MAX_ZOOM = 4;

/** How much one press of + or − zooms. */
export const ZOOM_STEP = 1.25;

/** How fast ctrl/⌘ + wheel zooms: the factor per pixel of wheel movement. */
export const WHEEL_ZOOM_RATE = 0.002;

/** Zooming out stops when the photo fits the view's width; narrower would only leave empty space. */
export function minZoom(viewWidth: number) {
  if (!(viewWidth > 0)) return 1;
  return Math.min(1, viewWidth / BASE_WIDTH_PX);
}

export function clampZoom(zoom: number, viewWidth: number) {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(minZoom(viewWidth), zoom));
}

/** A wheel that reports lines (WheelEvent deltaMode 1, Firefox with a mouse) moves about this many pixels per line. */
const LINE_HEIGHT_PX = 16;

/** The zoom after a ctrl/⌘ + wheel event; scrolling up (negative delta) zooms in. */
export function wheelZoom(zoom: number, deltaY: number, deltaMode = 0) {
  const pixels = deltaMode === 1 ? deltaY * LINE_HEIGHT_PX : deltaY;
  return zoom * Math.exp(-pixels * WHEEL_ZOOM_RATE);
}

/** The zoom while pinching: the starting zoom scaled by how far the fingers have spread. */
export function pinchZoom(startZoom: number, startDistance: number, distance: number) {
  if (!(startDistance > 0) || !(distance > 0)) return startZoom;
  return startZoom * (distance / startDistance);
}

/**
 * The scroll offset that keeps the point under `anchor` (px from the view's
 * edge) in place when the content grows from `from` to `to` times its size.
 */
export function anchoredScroll(scroll: number, anchor: number, from: number, to: number) {
  return Math.max(0, ((scroll + anchor) * to) / from - anchor);
}

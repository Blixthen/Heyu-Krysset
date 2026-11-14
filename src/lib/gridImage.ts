import { dedupeCells, isLetterCell, MAX_CELLS, MIN_CELLS, type LetterCell } from "./crossword";

/**
 * Finds a bildkorsord's grid in the photo's pixels with classic image
 * processing: grid lines are long straight dark runs on a regular lattice,
 * which text, arrows and pictures are not. The lattice gives the square size
 * and where to start; each square is then placed on its own printed lines
 * (placeSquares), since a photographed page is seldom flat. Pure (plain pixel
 * arrays in, plain data out), so it runs the same in the browser (canvas
 * ImageData) and in tests (decoded JPEGs).
 */

/** RGBA pixels, row by row, as canvas ImageData and jpeg-js return them. */
export type Pixels = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

/**
 * Grid line positions (px) along one axis, first to last; square i lies
 * between lines[i] and lines[i + 1]. Each line sits on the detected line
 * nearest the fitted lattice, so small irregularities in a photo don't add
 * up across the page. `cut` says whether the first and last line are not
 * printed but stand for the photo's edge, which cut that row or column off.
 */
export type Lattice = { step: number; lines: number[]; cut: { first: boolean; last: boolean } };
export type Grid = { columns: Lattice; rows: Lattice };

export type SquareKind = "letter" | "other";
/** A square's edges in px, each on its own printed line where one was found. */
export type Box = { left: number; top: number; right: number; bottom: number };
/** A square placed on the photo, with which of its sides the photo's edge cut off. */
export type PlacedSquare = { row: number; col: number; box: Box; cut: Record<keyof Box, boolean> };
export type Square = {
  row: number;
  col: number;
  box: Box;
  kind: SquareKind;
  /**
   * A letter square with a small mark in it (a start arrow), read from a blank
   * centre. Less certain than a fully blank square, so worth a second opinion.
   */
  marked: boolean;
  /** Interior measurements, kept for tuning and for Gemini to double-check. */
  ink: number;
  brightness: number;
  spread: number;
};

/** Darker than this (0–255 luminance) counts as ink: grid lines, text, arrows. */
const INK = 140;
/**
 * A pixel is on a line when it is at least this much darker (0–255) than the
 * pixels LINE_REACH away on both sides across the line. Relative, because
 * printed grid lines range from black to light grey between magazines.
 */
const LINE_CONTRAST = 20;
/** How far (px) to look on each side; wider than a printed line, narrower than a square. */
const LINE_REACH = 3;
/** A run must be this share of the image's longer side to count as part of a grid line; letters are shorter. */
const MIN_RUN_SHARE = 0.025;
/** Lines weaker than this share of the strongest one are ignored when fitting the lattice. */
const MIN_LINE_SHARE = 0.2;
/**
 * …but lines down to this share still extend it: beside a picture, grid
 * lines are only a few squares long.
 */
const MIN_EXTEND_SHARE = 0.04;
/**
 * A printed line is thin: its profile must stand this share above the
 * profile PEAK_SHOULDER px to either side. Dark photographs give broad bands
 * of long runs instead, which this rejects.
 */
const MIN_PROMINENCE = 0.5;
const PEAK_SHOULDER = 6;
/**
 * Lines are measured separately in this many strips across the page and then
 * combined, so a dark picture beside part of the grid only drowns out the
 * lines in its own strip.
 */
const STRIPS = 4;
/** A lattice line matches a detected line within this share of the step. */
const LINE_TOLERANCE = 0.08;
/** Squares are measured inside this inset on each side, which skips the grid lines and corner arrows or numbers. */
const INSET = 0.2;
/** A blank letter square has less than this share of ink in its interior. */
const MAX_LETTER_INK = 0.02;
/**
 * …is at most this much darker than the white around it (see WHITE_RADIUS),
 * which keeps white and yellow squares and drops grey blocks, whatever the
 * photo's exposure and however unevenly it is lit.
 */
const MAX_LETTER_DIMMING = 25;
/** The white is that of the brightest plain grid square within this many rows and columns… */
const WHITE_RADIUS = 2;
/** …or, with none near, the page's: the 90th percentile of square brightness. */
const PAGE_WHITE_PERCENTILE = 0.9;
/**
 * …or, if darker and wholly empty, is tinted: its colour (each channel over
 * the channel mean) differs by at least this much in some channel from both
 * the paper's and neutral grey. Solution words are often printed on pale
 * green, blue or pink, while blocks are grey: the paper check keeps grey in a
 * warm photo out, the neutral check grey on cream paper.
 */
const MIN_LETTER_TINT = 0.05;
/**
 * …but pale: no channel more than this far from neutral, since a saturated
 * colour is a block or a picture. (A dark one already fails as ink, INK.)
 */
const MAX_LETTER_TINT = 0.3;
/** …is this even (standard deviation of luminance), which rules out photographs. */
const MAX_LETTER_SPREAD = 22;
/**
 * …and has printed borders on at least this many sides; a white area of a
 * picture has none. A side the photo's edge cut off stands in for at most
 * one of them, so a cut-off corner square still needs its two inner sides.
 */
const MIN_BORDERED_SIDES = 3;
/**
 * A tinted square needs all four: a coloured area of a picture, such as a
 * wall, is as even and tinted as a solution square, but the grid lines that
 * end at the picture's frame leave it without a full set.
 */
const TINTED_BORDERED_SIDES = 4;
/**
 * A solution square's number stays within this share of its side from the
 * corner (in a photo, a little past 0.4 with the lattice slightly off); a
 * clue's word, centred, reaches further.
 */
const CORNER_MARK = 0.5;
/** How far (px) from a line's expected place to look for it. */
const BORDER_REACH = 4;
/**
 * A square's own border may also sit up to this share of its side away: the
 * lattice is straight, but a photographed page is often a little tilted or
 * curved, which puts a row's line a good few px higher at one end than the
 * other. There it must be a straight, unbroken line: within SHIFTED_REACH px
 * of one offset along at least MIN_SHIFTED_COVER of the side. Text and a
 * picture's texture wander and leave gaps.
 */
const BORDER_SHIFT_SHARE = 0.15;
const SHIFTED_REACH = 1;
const MIN_SHIFTED_COVER = 0.95;
/** A side counts as bordered when line pixels cover this share of it. */
const MIN_BORDER_COVER = 0.6;
/** Rows and columns may have steps that differ by this factor; printed squares are close to square. */
const MAX_ASPECT = 1.3;
/**
 * When they differ more, the axis with the larger step was fitted to every
 * other grid line if printed lines sit midway between its lines in at least
 * this share of its squares. A curved page or two pages side by side scatter
 * the lines, and a lattice twice the size, whose tolerance is twice as wide,
 * catches more of them. Short dividers inside split clue squares, which make
 * the other axis fit half a square, leave no such lines.
 */
const MIN_MIDWAY_SHARE = 0.4;
/**
 * A start arrow sits in a corner or along an edge of a letter square, while
 * clue text fills the middle. Inside this inset (the centre third) a marked
 * letter square is as blank as an empty one…
 */
const CORE_INSET = 0.33;
/** …and the whole square (just inside its borders) has less than this share of ink; an arrow is small. */
const MAX_MARK_INK = 0.1;
/**
 * A clue square split in two has a printed divider through its middle band
 * (this share of the square from each side), with a word above and below
 * that leave the centre blank; such a divider rules out a marked square.
 */
const DIVIDER_BAND = 0.3;
/** Just inside the borders, so the printed lines themselves aren't counted as ink. */
const EDGE_INSET = 0.1;
/**
 * Some letter squares carry a short clue in a strip along their top or bottom
 * edge, ruled off by a line this far in (share of the square's height); the
 * rest of the square, where the letter goes, is blank. Nearer the middle the
 * line splits a clue square in two.
 */
const STRIP_MIN = 0.15;
const STRIP_MAX = 0.45;
/** Inset for measuring the part past a strip, keeping clear of the strip's line and any arrow on it. */
const STRIP_INSET = 0.2;
/**
 * A strip's line runs from side border to side border, so it covers at least
 * this share of the square's width; a row of clue text, which keeps clear of
 * the borders, does not.
 */
const MIN_STRIP_LINE_COVER = 0.9;
/** How far (px) above and below a strip line's row to look for its pixels. */
const STRIP_LINE_REACH = 2;
/** A square cut off by the photo's edge is still read when at least this share of it is in the photo. */
const MIN_EDGE_SHARE = 0.6;
/**
 * Squares are placed one at a time from a neighbour already placed, which
 * follows the page where one straight lattice can't: perspective makes the
 * squares near the camera bigger, a page curves towards the spine, and the
 * two pages of a spread don't line up. A new square's side across from the
 * shared one is looked for this share of its size either way…
 */
const SNAP_FAR_SHARE = 0.2;
/** …and the two sides continuing the neighbour's this share, since a grid line bends little over one square. */
const SNAP_ALONG_SHARE = 0.12;
/**
 * A snapped square's size stays within this factor of its neighbour's
 * (perspective changes it only a little from one square to the next)…
 */
const MAX_SIZE_CHANGE = 1.1;
/** …and of the lattice's step, so sizes can't wander off over many squares; otherwise its far side is on a clue's divider. */
const MAX_SIZE_FROM_STEP = 1.25;
/** Placed squares share only their borders; a box overlapping one by more than this share is the same square. */
const MAX_SQUARE_OVERLAP = 0.25;
/** How far (px) across a line to look for its pixels when snapping to it; a line drifts little over one square. */
const SNAP_LINE_REACH = 1;
/**
 * The most squares across the photo's width (or down its height) the
 * lattice search allows for. A two-page spread runs to about 45 squares
 * across, and a lattice can't be fitted below its true step, only to a
 * multiple of it: too low a limit reads every square as two by two.
 */
const MAX_SQUARES_ACROSS = 80;
/** The fewest: a single square filling a sixth of the photo. */
const MIN_SQUARES_ACROSS = 6;
/**
 * The paper is the brightest large area, so its white is the brightness only
 * this share of the photo is darker than, even with a dark table or pictures around the page.
 */
const PAPER_PERCENTILE = 0.98;
/** Every this many pixels is enough to find the paper's brightness. */
const PAPER_SAMPLE_STEP = 7;
/** At most this much brighter, so a dark photo's noise isn't blown up into lines and ink. */
const MAX_GAIN = 2;

/**
 * Luminance scaled so the paper is white (255), whatever the light: every
 * threshold here (INK, LINE_CONTRAST, MAX_LETTER_DIMMING) is set for white
 * paper, and in a dim photo the back page showing through thin newsprint is
 * as dark as INK before scaling, while the print stays much darker.
 */
function luminance(pixels: Pixels): Float32Array {
  const { width, height, data } = pixels;
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  const gain = Math.min(MAX_GAIN, 255 / Math.max(1, paperWhite(out)));
  if (gain > 1) for (let i = 0; i < out.length; i += 1) out[i] = Math.min(255, out[i] * gain);
  return out;
}

/** The page's white: a high percentile of luminance, since paper covers most of a crossword page. */
function paperWhite(lum: Float32Array) {
  const histogram = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < lum.length; i += PAPER_SAMPLE_STEP) {
    histogram[Math.min(255, Math.floor(lum[i]))] += 1;
    count += 1;
  }
  let below = 0;
  for (let level = 0; level < 256; level += 1) {
    below += histogram[level];
    if (below > count * PAPER_PERCENTILE) return level;
  }
  return 255;
}

/**
 * For each position along one axis, how many pixels lie on long dark runs
 * across the other axis. Grid lines give tall peaks; text gives nothing.
 */
function lineProfile(
  lum: Float32Array,
  width: number,
  height: number,
  vertical: boolean,
  [from, to]: [number, number] = [0, vertical ? height : width],
): Float32Array {
  const length = vertical ? width : height;
  const minRun = Math.max(8, Math.round(MIN_RUN_SHARE * Math.max(width, height)));
  const profile = new Float32Array(length);
  for (let p = 0; p < length; p += 1) {
    let run = 0;
    let total = 0;
    for (let q = from; q <= to; q += 1) {
      const dark = q < to && onLine(lum, width, vertical ? p : q, vertical ? q : p, vertical, length);
      if (dark) {
        run += 1;
      } else {
        if (run >= minRun) total += run;
        run = 0;
      }
    }
    profile[p] = total;
  }
  return profile;
}

function onLine(lum: Float32Array, width: number, x: number, y: number, vertical: boolean, length: number) {
  const along = vertical ? x : y;
  if (along < LINE_REACH || along >= length - LINE_REACH) return false;
  const here = lum[y * width + x];
  const before = vertical ? lum[y * width + x - LINE_REACH] : lum[(y - LINE_REACH) * width + x];
  const after = vertical ? lum[y * width + x + LINE_REACH] : lum[(y + LINE_REACH) * width + x];
  return here < INK || (before - here >= LINE_CONTRAST && after - here >= LINE_CONTRAST);
}

/**
 * A thin line only: darker than the paper on both sides of it. Placing
 * squares uses this, since in a dark picture every pixel is as dark as ink.
 */
function onThinLine(lum: Float32Array, width: number, x: number, y: number, vertical: boolean, length: number) {
  const along = vertical ? x : y;
  if (along < LINE_REACH || along >= length - LINE_REACH) return false;
  const here = lum[y * width + x];
  const before = vertical ? lum[y * width + x - LINE_REACH] : lum[(y - LINE_REACH) * width + x];
  const after = vertical ? lum[y * width + x + LINE_REACH] : lum[(y + LINE_REACH) * width + x];
  return before - here >= LINE_CONTRAST && after - here >= LINE_CONTRAST;
}

/** Thin local maxima above MIN_LINE_SHARE of the strongest, merging thick lines. */
function peaks(profile: Float32Array, share = MIN_LINE_SHARE): { at: number; weight: number }[] {
  let max = 0;
  for (const value of profile) max = Math.max(max, value);
  const found: { at: number; weight: number }[] = [];
  for (let p = 0; p < profile.length; p += 1) {
    if (profile[p] === 0 || profile[p] < max * share) continue;
    const shoulder = Math.max(profile[p - PEAK_SHOULDER] ?? 0, profile[p + PEAK_SHOULDER] ?? 0);
    if (profile[p] - shoulder < MIN_PROMINENCE * profile[p]) continue;
    const last = found.at(-1);
    if (last && p - last.at <= 3) {
      if (profile[p] > last.weight) Object.assign(last, { at: p, weight: profile[p] });
      continue;
    }
    found.push({ at: p, weight: profile[p] });
  }
  return found;
}

/**
 * How well a lattice fits the detected lines: how many of its lines sit on a
 * detected line, times the share of its lines (within the span it covers)
 * that do. Lines are counted, not weighed, because a few very long lines
 * (the page border, a picture's frame) would otherwise outweigh the grid.
 * A multiple of the true step supports too few lines; a fraction of it has
 * too many empty ones.
 */
function explain(lines: { at: number; weight: number }[], step: number, start: number) {
  const supported = new Set<number>();
  for (const line of lines) {
    const offset = (line.at - start) / step;
    if (Math.abs(offset - Math.round(offset)) <= LINE_TOLERANCE) supported.add(Math.round(offset));
  }
  if (supported.size === 0) return { score: 0, first: 0, last: 0 };
  const first = Math.min(...supported);
  const last = Math.max(...supported);
  return { score: supported.size ** 2 / (last - first + 1), first, last };
}

/** The regular lattice that best explains the detected lines along one axis. */
function fitLattice(
  { strong: lines, weak }: { strong: { at: number; weight: number }[]; weak: { at: number; weight: number }[] },
  length: number,
  range: [number, number] = [length / MAX_SQUARES_ACROSS, length / MIN_SQUARES_ACROSS],
): Lattice | null {
  if (lines.length < 3) return null;
  let chosen = { step: 0, start: 0, score: 0, first: 0, last: 0 };
  for (let step = range[0]; step <= range[1]; step += 0.25) {
    for (let start = 0; start < step; start += 0.5) {
      const result = explain(lines, step, start);
      if (result.score > chosen.score) chosen = { step, start, ...result };
    }
  }
  if (chosen.last - chosen.first < 2) return null;
  // The search is coarse; a least-squares fit through the matched lines
  // removes the drift that a slightly-off step builds up across the page.
  const matched = lines
    .map((line) => ({ at: line.at, index: Math.round((line.at - chosen.start) / chosen.step) }))
    .filter(({ at, index }) => Math.abs(at - (chosen.start + index * chosen.step)) <= LINE_TOLERANCE * chosen.step);
  const fit = leastSquares(matched.map(({ index }) => index), matched.map(({ at }) => at));
  const step = fit?.slope ?? chosen.step;
  const origin = fit?.intercept ?? chosen.start;
  let first = chosen.first;
  let last = chosen.last;
  const near = (index: number) =>
    weak.some((line) => Math.abs(line.at - (origin + index * step)) <= LINE_TOLERANCE * step);
  while (origin + (first - 1) * step >= 0 && near(first - 1)) first -= 1;
  while (origin + (last + 1) * step <= length && near(last + 1)) last += 1;
  // A row or column cut off by the photo's edge has no line on that side.
  const cutFirst = origin + first * step >= MIN_EDGE_SHARE * step;
  const cutLast = length - (origin + last * step) >= MIN_EDGE_SHARE * step;
  if (cutFirst) first -= 1;
  if (cutLast) last += 1;
  const nearest = (predicted: number) =>
    weak.reduce<number | null>(
      (best, line) =>
        Math.abs(line.at - predicted) <= LINE_TOLERANCE * step &&
        (best === null || Math.abs(line.at - predicted) < Math.abs(best - predicted))
          ? line.at
          : best,
      null,
    );
  const positions: number[] = [];
  for (let index = first; index <= last; index += 1) {
    const predicted = origin + index * step;
    positions.push(Math.min(length, Math.max(0, nearest(predicted) ?? predicted)));
  }
  // Only a line at or past the photo's edge stands for it (closer than
  // LINE_REACH, a printed line can't be seen); one further inside with
  // nothing printed there is blank margin, not a cut.
  const firstLine = origin + first * step;
  const lastLine = origin + last * step;
  const cut = {
    first: cutFirst && firstLine <= LINE_REACH && nearest(firstLine) === null,
    last: cutLast && lastLine >= length - LINE_REACH && nearest(lastLine) === null,
  };
  return { step, lines: positions, cut };
}

function leastSquares(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

export function findGrid(pixels: Pixels, lum = luminance(pixels)): Grid | null {
  const columnLines = stripLines(lum, pixels, true);
  const rowLines = stripLines(lum, pixels, false);
  let columns = fitLattice(columnLines, pixels.width);
  let rows = fitLattice(rowLines, pixels.height);
  if (!columns || !rows) return null;
  // Squares are close to square, so when the steps disagree, one axis is
  // refitted near the other's step: the one fitted to every other line, if
  // either was (MIN_MIDWAY_SHARE), and otherwise the one with the smaller step.
  const near = (step: number): [number, number] => [step / MAX_ASPECT, step * MAX_ASPECT];
  if (columns.step * MAX_ASPECT < rows.step) {
    if (midwayShare(rowLines.strong, rows, columns.step) >= MIN_MIDWAY_SHARE) {
      rows = fitLattice(rowLines, pixels.height, near(columns.step)) ?? rows;
    } else {
      columns = fitLattice(columnLines, pixels.width, near(rows.step)) ?? columns;
    }
  } else if (rows.step * MAX_ASPECT < columns.step) {
    if (midwayShare(columnLines.strong, columns, rows.step) >= MIN_MIDWAY_SHARE) {
      columns = fitLattice(columnLines, pixels.width, near(rows.step)) ?? columns;
    } else {
      rows = fitLattice(rowLines, pixels.height, near(columns.step)) ?? rows;
    }
  }
  return { columns, rows };
}

/**
 * The share of a lattice's squares with a detected line across their middle,
 * matched within the tolerance of the other axis's (finer) step.
 */
function midwayShare(lines: { at: number }[], lattice: Lattice, finerStep: number) {
  const squares = lattice.lines.length - 1;
  if (squares < 1) return 0;
  let split = 0;
  for (let index = 0; index < squares; index += 1) {
    const middle = (lattice.lines[index] + lattice.lines[index + 1]) / 2;
    if (lines.some((line) => Math.abs(line.at - middle) <= LINE_TOLERANCE * finerStep)) split += 1;
  }
  return split / squares;
}

/** Thin lines found in any strip, merged across strips (keeping the strongest of lines within 3 px). */
function stripLines(lum: Float32Array, pixels: Pixels, vertical: boolean) {
  const span = vertical ? pixels.height : pixels.width;
  const strong: { at: number; weight: number }[] = [];
  const weak: { at: number; weight: number }[] = [];
  for (let strip = 0; strip < STRIPS; strip += 1) {
    const range: [number, number] = [Math.round((strip * span) / STRIPS), Math.round(((strip + 1) * span) / STRIPS)];
    const profile = lineProfile(lum, pixels.width, pixels.height, vertical, range);
    strong.push(...peaks(profile));
    weak.push(...peaks(profile, MIN_EXTEND_SHARE));
  }
  return { strong: merge(strong), weak: merge(weak) };
}

function merge(lines: { at: number; weight: number }[]) {
  const merged: { at: number; weight: number }[] = [];
  for (const line of lines.toSorted((a, b) => a.at - b.at)) {
    const last = merged.at(-1);
    if (last && line.at - last.at <= 3) {
      if (line.weight > last.weight) Object.assign(last, line);
    } else {
      merged.push({ ...line });
    }
  }
  return merged;
}

/**
 * Share of one side of a square that has line pixels within BORDER_REACH of
 * it, or of a line parallel to it up to `shift` px away, whichever covers most.
 */
function borderCover(lum: Float32Array, pixels: Pixels, at: number, from: number, to: number, vertical: boolean, shift = 0) {
  const near = lineCover(lum, pixels, at, from, to, vertical, BORDER_REACH);
  if (shift === 0 || near >= MIN_BORDER_COVER) return near;
  let best = near;
  for (let centre = -shift; centre <= shift; centre += 1) {
    if (centre === 0) continue;
    const shifted = lineCover(lum, pixels, at + centre, from, to, vertical, SHIFTED_REACH);
    if (shifted >= MIN_SHIFTED_COVER) best = Math.max(best, shifted);
  }
  return best;
}

/** Share of samples along a side that have a line pixel (by `isLine`) within `reach` px of `at`. */
function lineCover(
  lum: Float32Array,
  pixels: Pixels,
  at: number,
  from: number,
  to: number,
  vertical: boolean,
  reach: number,
  isLine: typeof onLine = onLine,
) {
  const { width, height } = pixels;
  const length = vertical ? width : height;
  let samples = 0;
  let hits = 0;
  for (let t = from + (to - from) * 0.15; t <= from + (to - from) * 0.85; t += 1) {
    samples += 1;
    for (let d = -reach; d <= reach; d += 1) {
      const x = Math.round(vertical ? at + d : t);
      const y = Math.round(vertical ? t : at + d);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (isLine(lum, width, x, y, vertical, length)) {
        hits += 1;
        break;
      }
    }
  }
  return samples === 0 ? 0 : hits / samples;
}

/** Whether a printed line crosses the square's middle band, as in a split clue square. */
function divided(lum: Float32Array, pixels: Pixels, box: Box) {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  for (let y = box.top + DIVIDER_BAND * height; y <= box.bottom - DIVIDER_BAND * height; y += 2) {
    if (borderCover(lum, pixels, y, box.left, box.right, false) >= MIN_BORDER_COVER) return true;
  }
  for (let x = box.left + DIVIDER_BAND * width; x <= box.right - DIVIDER_BAND * width; x += 2) {
    if (borderCover(lum, pixels, x, box.top, box.bottom, true) >= MIN_BORDER_COVER) return true;
  }
  return false;
}

/**
 * The part of the square past a clue strip along its top or bottom edge, or
 * null if there is no such strip.
 */
function pastStrip(lum: Float32Array, pixels: Pixels, box: Box) {
  const height = box.bottom - box.top;
  for (let offset = Math.round(STRIP_MIN * height); offset <= STRIP_MAX * height; offset += 1) {
    const top = box.top + offset;
    if (stripLineCover(lum, pixels, top, box.left, box.right) >= MIN_STRIP_LINE_COVER) return { ...box, top };
    const bottom = box.bottom - offset;
    if (stripLineCover(lum, pixels, bottom, box.left, box.right) >= MIN_STRIP_LINE_COVER) return { ...box, bottom };
  }
  return null;
}

/** Share of the square's width, just inside its side borders, that a horizontal line at `y` covers. */
function stripLineCover(lum: Float32Array, pixels: Pixels, y: number, left: number, right: number) {
  const margin = BORDER_REACH + 1;
  let samples = 0;
  let hits = 0;
  for (let x = Math.round(left + margin); x <= right - margin; x += 1) {
    if (x < 0 || x >= pixels.width) continue;
    samples += 1;
    for (let d = -STRIP_LINE_REACH; d <= STRIP_LINE_REACH; d += 1) {
      const yy = Math.round(y + d);
      if (yy >= 0 && yy < pixels.height && onLine(lum, pixels.width, x, yy, false, pixels.height)) {
        hits += 1;
        break;
      }
    }
  }
  return samples === 0 ? 0 : hits / samples;
}

/**
 * Whether all ink just inside the square's borders lies in one corner, within
 * CORNER_MARK of its side from that corner, as a solution square's number does.
 */
function cornerMarkOnly(lum: Float32Array, pixels: Pixels, box: Box) {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const inner = { left: box.left + EDGE_INSET * width, top: box.top + EDGE_INSET * height, right: box.right - EDGE_INSET * width, bottom: box.bottom - EDGE_INSET * height };
  const clean = (area: typeof inner) => (measure(lum, pixels, area, 0)?.ink ?? 0) < MAX_LETTER_INK;
  return [
    [box.left + CORNER_MARK * width, box.top + CORNER_MARK * height, true, true],
    [box.right - CORNER_MARK * width, box.top + CORNER_MARK * height, false, true],
    [box.left + CORNER_MARK * width, box.bottom - CORNER_MARK * height, true, false],
    [box.right - CORNER_MARK * width, box.bottom - CORNER_MARK * height, false, false],
  ].some(([x, y, left, top]) => {
    // The rest of the square is the band beside the corner plus everything past it.
    const beside = left ? { ...inner, left: x as number } : { ...inner, right: x as number };
    const below = top ? { ...inner, top: y as number } : { ...inner, bottom: y as number };
    const besideCorner = top ? { ...beside, bottom: y as number } : { ...beside, top: y as number };
    return clean(besideCorner) && clean(below);
  });
}

/**
 * How many sides have a printed border, plus one if a side without one was
 * cut off by the photo's edge (see MIN_BORDERED_SIDES).
 */
function borderedSides(
  lum: Float32Array,
  pixels: Pixels,
  box: Box,
  cut: { left: boolean; top: boolean; right: boolean; bottom: boolean },
) {
  const { left, top, right, bottom } = box;
  // A side's line moves across it: the left and right sides sideways, by a share of the width.
  const sideways = Math.round(BORDER_SHIFT_SHARE * (right - left));
  const upDown = Math.round(BORDER_SHIFT_SHARE * (bottom - top));
  const sides = [
    { printed: borderCover(lum, pixels, left, top, bottom, true, sideways) >= MIN_BORDER_COVER, cut: cut.left },
    { printed: borderCover(lum, pixels, right, top, bottom, true, sideways) >= MIN_BORDER_COVER, cut: cut.right },
    { printed: borderCover(lum, pixels, top, left, right, false, upDown) >= MIN_BORDER_COVER, cut: cut.top },
    { printed: borderCover(lum, pixels, bottom, left, right, false, upDown) >= MIN_BORDER_COVER, cut: cut.bottom },
  ];
  const printed = sides.filter((side) => side.printed).length;
  return printed + (sides.some((side) => !side.printed && side.cut) ? 1 : 0);
}

type Colour = [r: number, g: number, b: number];
type Measure = { ink: number; brightness: number; spread: number };

/** Each channel over the channel mean, so exposure cancels out and only the hue is left. */
function chromaticity([r, g, b]: Colour): Colour {
  const mean = (r + g + b) / 3 || 1;
  return [r / mean, g / mean, b / mean];
}

/** Ink share, mean brightness and evenness inside a square, inset by `inset` of its size on each side. */
function measure(lum: Float32Array, pixels: Pixels, box: Box, inset: number): Measure | null {
  const dx = inset * (box.right - box.left);
  const dy = inset * (box.bottom - box.top);
  const x0 = Math.max(0, Math.round(box.left + dx));
  const x1 = Math.min(pixels.width, Math.round(box.right - dx));
  const y0 = Math.max(0, Math.round(box.top + dy));
  const y1 = Math.min(pixels.height, Math.round(box.bottom - dy));
  let n = 0;
  let dark = 0;
  let sum = 0;
  let sumSquares = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const value = lum[y * pixels.width + x];
      n += 1;
      sum += value;
      sumSquares += value * value;
      if (value < INK) dark += 1;
    }
  }
  if (n === 0) return null;
  const brightness = sum / n;
  return { ink: dark / n, brightness, spread: Math.sqrt(Math.max(0, sumSquares / n - brightness * brightness)) };
}

/** Mean chromaticity inside a square, inset by `inset` of its size on each side. */
function hue(pixels: Pixels, box: Box, inset: number): Colour {
  const dx = inset * (box.right - box.left);
  const dy = inset * (box.bottom - box.top);
  const rgb: Colour = [0, 0, 0];
  for (let y = Math.max(0, Math.round(box.top + dy)); y < Math.min(pixels.height, Math.round(box.bottom - dy)); y += 1) {
    for (let x = Math.max(0, Math.round(box.left + dx)); x < Math.min(pixels.width, Math.round(box.right - dx)); x += 1) {
      for (let channel = 0; channel < 3; channel += 1) rgb[channel] += pixels.data[(y * pixels.width + x) * 4 + channel];
    }
  }
  return chromaticity(rgb);
}

function average(colours: Colour[]): Colour | null {
  if (colours.length === 0) return null;
  const sum = colours.reduce<Colour>((total, [r, g, b]) => [total[0] + r, total[1] + g, total[2] + b], [0, 0, 0]);
  return [sum[0] / colours.length, sum[1] / colours.length, sum[2] / colours.length];
}

const NEUTRAL: Colour = [1, 1, 1];

function hueDistance(a: Colour, b: Colour) {
  return Math.max(...a.map((value, channel) => Math.abs(value - b[channel])));
}

/**
 * The position nearest `at`, within `reach` px, where a printed line covers
 * the span from `from` to `to`, or null if there is none. The prediction
 * comes from the neighbouring square's own side, so the nearest line is that
 * side's continuation; a clue's divider or the next line is further off. As
 * for a square's borders, a line within BORDER_REACH of where it is expected
 * may be broken (MIN_BORDER_COVER), one further off must be unbroken
 * (MIN_SHIFTED_COVER): text and a picture's texture leave gaps.
 */
function snapLine(lum: Float32Array, pixels: Pixels, at: number, from: number, to: number, vertical: boolean, reach: number, inward: 1 | -1) {
  // A thin line, or the inner edge of a thick border or picture frame: ink with the square's paper just inside it.
  const isSide: typeof onLine = (values, width, x, y, isVertical, length) => {
    if (onThinLine(values, width, x, y, isVertical, length)) return true;
    const along = isVertical ? x : y;
    // As in onLine: a line this close to the photo's edge can't be told from the edge.
    if (along < LINE_REACH || along >= length - LINE_REACH) return false;
    const inside = along + inward * LINE_REACH;
    const here = values[y * width + x];
    return here < INK && (isVertical ? values[y * width + inside] : values[inside * width + x]) - here >= LINE_CONTRAST;
  };
  for (let distance = 0; distance <= reach; distance += 1) {
    // Sampled SNAP_LINE_REACH either side, so the broken-line zone ends that much sooner.
    const needed = distance + SNAP_LINE_REACH <= BORDER_REACH ? MIN_BORDER_COVER : MIN_SHIFTED_COVER;
    let best: { at: number; cover: number } | null = null;
    for (const offset of distance === 0 ? [0] : [-distance, distance]) {
      const cover = lineCover(lum, pixels, at + offset, from, to, vertical, SNAP_LINE_REACH, isSide);
      if (cover >= needed && (!best || cover > best.cover)) best = { at: at + offset, cover };
    }
    if (best) return best.at;
  }
  return null;
}

type Side = keyof Box;
const OPPOSITE: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };
const STEPS: { side: Side; row: number; col: number }[] = [
  { side: "right", row: 0, col: 1 },
  { side: "left", row: 0, col: -1 },
  { side: "bottom", row: 1, col: 0 },
  { side: "top", row: -1, col: 0 },
];

type Placing = PlacedSquare & { found: Record<Side, boolean> };

/**
 * Snaps the given sides of a box to the printed lines near them, clipping it
 * to the photo. Returns the box, which sides are on a line, and which the
 * photo's edge cut off, or null if too little of it is in the photo.
 */
function snapBox(lum: Float32Array, pixels: Pixels, predicted: Box, reaches: Partial<Record<Side, number>>, found: Partial<Record<Side, boolean>>) {
  const box = { ...predicted };
  const isFound: Record<Side, boolean> = { left: false, top: false, right: false, bottom: false, ...found };
  // Horizontal sides first, measured along the predicted width, then the vertical ones between them.
  for (const side of ["top", "bottom", "left", "right"] as const) {
    const reach = reaches[side];
    if (reach === undefined) continue;
    const vertical = side === "left" || side === "right";
    const inward = side === "left" || side === "top" ? 1 : -1;
    const at = vertical
      ? snapLine(lum, pixels, box[side], box.top, box.bottom, true, reach, inward)
      : snapLine(lum, pixels, box[side], box.left, box.right, false, reach, inward);
    if (at !== null) box[side] = at;
    isFound[side] = at !== null;
  }
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const clipped = { left: Math.max(0, box.left), top: Math.max(0, box.top), right: Math.min(pixels.width, box.right), bottom: Math.min(pixels.height, box.bottom) };
  if ((clipped.right - clipped.left) < MIN_EDGE_SHARE * width || (clipped.bottom - clipped.top) < MIN_EDGE_SHARE * height) return null;
  // A line closer to the photo's edge than LINE_REACH can't be seen, so a side there without one was cut off.
  const cut = {
    left: !isFound.left && box.left <= LINE_REACH,
    top: !isFound.top && box.top <= LINE_REACH,
    right: !isFound.right && box.right >= pixels.width - LINE_REACH,
    bottom: !isFound.bottom && box.bottom >= pixels.height - LINE_REACH,
  };
  return { box: clipped, found: isFound, cut };
}

/**
 * Whether a square has enough printed sides, or sides the photo's edge cut
 * off, to be part of the grid. Every cut side counts here, so a square in a
 * corner of the photo is placed; classifySquares then counts at most one
 * (MIN_BORDERED_SIDES), so blank margin there isn't read as a letter square.
 */
function onGrid(found: Record<Side, boolean>, cut: Record<Side, boolean>) {
  return (Object.keys(found) as Side[]).filter((side) => found[side] || cut[side]).length >= MIN_BORDERED_SIDES;
}

/**
 * Places the grid's squares on the photo. The lattice gives the square size
 * and where to start: from the lattice squares whose four sides sit on
 * printed lines, best first, each new square is placed beside one already
 * placed and snapped to the lines around it, until the lines run out at a
 * picture or the grid's edge. A region the lattice is off for, such as the
 * other page of a spread, starts from its own best-fitting square.
 */
function placeSquares(pixels: Pixels, grid: Grid, lum = luminance(pixels)): PlacedSquare[] {
  const { columns, rows } = grid;
  const step = (vertical: boolean) => (vertical ? columns.step : rows.step);
  /** Whether a square's sizes are near the lattice's; a size the photo's edge cut short isn't checked. */
  const sized = (box: Box, cut: Record<Side, boolean>) => {
    const fits = (size: number, along: number) => size <= along * MAX_SIZE_FROM_STEP && size >= along / MAX_SIZE_FROM_STEP;
    return (cut.left || cut.right || fits(box.right - box.left, columns.step)) && (cut.top || cut.bottom || fits(box.bottom - box.top, rows.step));
  };

  const seedAt = (lattice: Box): Placing | null => {
    // The top left corner snaps to the nearest lines, even half a square off as on the other page of a spread…
    const corner = snapBox(lum, pixels, lattice, { left: Math.floor(columns.step / 2), top: Math.floor(rows.step / 2) }, {});
    if (!corner || !corner.found.left || !corner.found.top) return null;
    // …and the opposite sides one square on from there.
    const square = { ...corner.box, right: corner.box.left + columns.step, bottom: corner.box.top + rows.step };
    const far = Math.max(2, Math.round(SNAP_FAR_SHARE * Math.min(columns.step, rows.step)));
    const snapped = snapBox(lum, pixels, square, { right: far, bottom: far }, { left: true, top: true });
    return snapped && Object.values(snapped.found).every(Boolean) ? { row: 0, col: 0, ...snapped } : null;
  };
  // Seeds start where the lattice fits best: the lattice squares whose sides moved least when snapped.
  const candidates: { row: number; col: number; box: Box; seed: Placing; moved: number }[] = [];
  for (let row = 0; row < rows.lines.length - 1; row += 1) {
    for (let col = 0; col < columns.lines.length - 1; col += 1) {
      const box = { left: columns.lines[col], right: columns.lines[col + 1], top: rows.lines[row], bottom: rows.lines[row + 1] };
      const seed = seedAt(box);
      if (!seed) continue;
      const moved = (Object.keys(box) as Side[]).reduce((sum, side) => sum + Math.abs(seed.box[side] - box[side]), 0);
      candidates.push({ row, col, box, seed, moved });
    }
  }
  candidates.sort((a, b) => a.moved - b.moved);

  // Squares by position, so a square reached under two indices, or from two seeds, is placed once.
  const bucketSize = Math.max(columns.step, rows.step);
  const buckets = new Map<string, Placing[]>();
  const bucketOf = (x: number, y: number) => `${Math.floor(x / bucketSize)},${Math.floor(y / bucketSize)}`;
  /** Whether a box overlaps a placed square by more than MAX_SQUARE_OVERLAP of the smaller one. */
  const covered = (box: Box) => {
    const x = (box.left + box.right) / 2;
    const y = (box.top + box.bottom) / 2;
    const area = (b: Box) => (b.right - b.left) * (b.bottom - b.top);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const other of buckets.get(bucketOf(x + dx * bucketSize, y + dy * bucketSize)) ?? []) {
          const w = Math.min(box.right, other.box.right) - Math.max(box.left, other.box.left);
          const h = Math.min(box.bottom, other.box.bottom) - Math.max(box.top, other.box.top);
          if (w > 0 && h > 0 && w * h > MAX_SQUARE_OVERLAP * Math.min(area(box), area(other.box))) return true;
        }
      }
    }
    return false;
  };

  // Each seed grows a region of its own, numbered from its lattice square;
  // regions are numbered apart afterwards (separateRegions).
  const regions: { seed: { row: number; col: number }; squares: Map<string, Placing> }[] = [];
  const key = (row: number, col: number) => `${row},${col}`;
  for (const candidate of candidates) {
    const { seed } = candidate;
    if (covered(seed.box)) continue;
    const placed = new Map<string, Placing>();
    regions.push({ seed: candidate, squares: placed });
    const place = (square: Placing) => {
      placed.set(key(square.row, square.col), square);
      const bucket = bucketOf((square.box.left + square.box.right) / 2, (square.box.top + square.box.bottom) / 2);
      const group = buckets.get(bucket);
      if (group) group.push(square);
      else buckets.set(bucket, [square]);
    };
    place(seed);
    const queue: Placing[] = [seed];
    for (let next = 0; next < queue.length; next += 1) {
      const from = queue[next];
      for (const { side, row, col } of STEPS) {
        const at = { row: from.row + row, col: from.col + col };
        if (placed.has(key(at.row, at.col))) continue;
        // A side cut off by the photo's edge has nothing beyond it.
        if (from.cut[side]) continue;
        const shared = OPPOSITE[side];
        const vertical = side === "left" || side === "right";
        // A size the photo's edge cut short says nothing of the next square's; the lattice's does.
        const across = vertical ? from.cut.left || from.cut.right : from.cut.top || from.cut.bottom;
        const alongCut = vertical ? from.cut.top || from.cut.bottom : from.cut.left || from.cut.right;
        const size = across ? step(vertical) : vertical ? from.box.right - from.box.left : from.box.bottom - from.box.top;
        const alongSize = alongCut ? step(!vertical) : vertical ? from.box.bottom - from.box.top : from.box.right - from.box.left;
        const predicted = { ...from.box };
        predicted[shared] = from.box[side];
        predicted[side] = from.box[side] + (side === "right" || side === "bottom" ? size : -size);
        const far = Math.max(2, Math.round(SNAP_FAR_SHARE * size));
        const along = Math.max(2, Math.round(SNAP_ALONG_SHARE * alongSize));
        const reaches: Partial<Record<Side, number>> = vertical ? { [side]: far, top: along, bottom: along } : { [side]: far, left: along, right: along };
        // A side shared with a square already placed is that square's side,
        // which keeps a column of split clue squares from drifting onto their dividers.
        for (const other of STEPS) {
          if (other.side === shared) continue;
          const neighbour = placed.get(key(at.row + other.row, at.col + other.col));
          if (!neighbour) continue;
          predicted[other.side] = neighbour.box[OPPOSITE[other.side]];
          reaches[other.side] = Math.min(reaches[other.side] ?? along, along);
        }
        const snapped = snapBox(lum, pixels, predicted, reaches, { [shared]: from.found[side] });
        if (!snapped) continue;
        // Only the size across a cut side is exempt; the other is checked as usual.
        const cutAcross = vertical ? snapped.cut.left || snapped.cut.right : snapped.cut.top || snapped.cut.bottom;
        const newSize = vertical ? snapped.box.right - snapped.box.left : snapped.box.bottom - snapped.box.top;
        if (!cutAcross && (newSize > size * MAX_SIZE_CHANGE || newSize < size / MAX_SIZE_CHANGE)) continue;
        if (!sized(snapped.box, snapped.cut) || !onGrid(snapped.found, snapped.cut) || covered(snapped.box)) continue;
        const square = { ...at, ...snapped };
        place(square);
        queue.push(square);
      }
    }
  }
  return separateRegions(regions);
}

/**
 * Numbers the squares of all regions from 0 without two sharing an index.
 * A region keeps its seed's lattice row and column where that is free (the
 * usual case, one region per page), and otherwise moves right past the
 * columns already taken, as the other page of a spread is.
 */
export function separateRegions(regions: { seed: { row: number; col: number }; squares: Map<string, PlacedSquare> }[]): PlacedSquare[] {
  const result: PlacedSquare[] = [];
  const taken = new Set<string>();
  for (const { seed, squares } of regions) {
    const own = [...squares.values()];
    // Growth numbers from the seed at (0, 0); the lattice square it started from places it.
    const free = (dCol: number) => own.every((square) => !taken.has(`${square.row + seed.row},${square.col + seed.col + dCol}`));
    let dCol = 0;
    while (!free(dCol)) dCol += 1;
    for (const square of own) {
      const placed = { row: square.row + seed.row, col: square.col + seed.col + dCol, box: square.box, cut: square.cut };
      taken.add(`${placed.row},${placed.col}`);
      result.push(placed);
    }
  }
  // Squares grown above or left of where the lattice starts get negative indices.
  const firstRow = Math.min(...result.map((square) => square.row));
  const firstCol = Math.min(...result.map((square) => square.col));
  return result.map((square) => ({ ...square, row: square.row - firstRow, col: square.col - firstCol }));
}

/** Measures each square's interior and borders and calls it a blank letter square or something else. */
export function classifySquares(pixels: Pixels, grid: Grid, lum = luminance(pixels)): Square[] {
  const measured: (Measure & {
    row: number;
    col: number;
    core: Measure;
    whole: Measure;
    sides: number;
    box: Box;
  })[] = [];
  for (const { row, col, box, cut } of placeSquares(pixels, grid, lum)) {
    const interior = measure(lum, pixels, box, INSET);
    const core = measure(lum, pixels, box, CORE_INSET);
    const whole = measure(lum, pixels, box, EDGE_INSET);
    if (!interior || !core || !whole) continue;
    const sides = borderedSides(lum, pixels, box, cut);
    measured.push({ row, col, ...interior, core, whole, sides, box });
  }
  const plain = (area: Measure) => area.ink < MAX_LETTER_INK && area.spread <= MAX_LETTER_SPREAD;
  // Photos are often lit unevenly, so each square is compared with the
  // brightest plain grid square near it, not itself; pictures can't lower it.
  const paperLevel = new Map<string, number>();
  for (const square of measured) {
    if (square.sides >= MIN_BORDERED_SIDES && plain(square)) paperLevel.set(`${square.row},${square.col}`, square.brightness);
  }
  const sorted = measured.map((square) => square.brightness).toSorted((a, b) => a - b);
  const pageWhite = sorted[Math.floor(sorted.length * PAGE_WHITE_PERCENTILE)] ?? 255;
  const localWhite = (square: (typeof measured)[number]) => {
    let white: number | undefined;
    for (let row = square.row - WHITE_RADIUS; row <= square.row + WHITE_RADIUS; row += 1) {
      for (let col = square.col - WHITE_RADIUS; col <= square.col + WHITE_RADIUS; col += 1) {
        const level = row === square.row && col === square.col ? undefined : paperLevel.get(`${row},${col}`);
        if (level !== undefined && (white === undefined || level > white)) white = level;
      }
    }
    return white ?? pageWhite;
  };
  const whites = new Map(measured.map((square) => [square, localWhite(square)]));
  const blank = (area: Measure, square: (typeof measured)[number]) =>
    plain(area) && area.brightness >= (whites.get(square) ?? 255) - MAX_LETTER_DIMMING;
  const bordered = (square: (typeof measured)[number]) => square.sides >= MIN_BORDERED_SIDES;
  const paper = average(measured.filter((square) => bordered(square) && blank(square, square)).map((square) => hue(pixels, square.box, INSET)));
  const tinted = (square: (typeof measured)[number], inset: number) => {
    if (paper === null) return false;
    const colour = hue(pixels, square.box, inset);
    const fromNeutral = hueDistance(colour, NEUTRAL);
    return hueDistance(colour, paper) >= MIN_LETTER_TINT && fromNeutral >= MIN_LETTER_TINT && fromNeutral <= MAX_LETTER_TINT;
  };
  return measured.map((square) => {
    const { row, col, ink, brightness, spread, core, whole, box } = square;
    const enclosed = square.sides >= TINTED_BORDERED_SIDES;
    const empty = bordered(square) && (blank(square, square) || (enclosed && plain(square) && tinted(square, INSET)));
    // A tinted letter square may carry a number in one corner; a tinted clue
    // square with a blank centre has words reaching past it.
    const numbered = enclosed && plain(core) && tinted(square, CORE_INSET) && cornerMarkOnly(lum, pixels, box);
    const blankCore = blank(core, square) || numbered;
    const marked = bordered(square) && !empty && blankCore && whole.ink < MAX_MARK_INK && !divided(lum, pixels, box);
    const rest = bordered(square) && !empty && !marked ? pastStrip(lum, pixels, box) : null;
    const restMeasure = rest && measure(lum, pixels, rest, STRIP_INSET);
    const stripped = restMeasure !== null && blank(restMeasure, square);
    return { row, col, box, kind: empty || marked || stripped ? "letter" : "other", marked: marked || stripped, ink, brightness, spread };
  });
}

/** Letter squares as app cells, in 0–1000 coordinates relative to the image. */
export function toLetterCells(pixels: Pixels, squares: Square[]): LetterCell[] {
  const sx = 1000 / pixels.width;
  const sy = 1000 / pixels.height;
  return squares
    .filter((square) => square.kind === "letter")
    .map(({ row, col, box }) => {
      const x = Math.round(box.left * sx);
      const y = Math.round(box.top * sy);
      return { row, col, x, y, w: Math.round(box.right * sx) - x, h: Math.round(box.bottom * sy) - y };
    });
}

/**
 * The whole reading: letter cells ready for a puzzle, or null when the photo
 * doesn't read as a usable grid (then the caller asks Gemini instead). Cells
 * pass the same validation as Gemini's, so either source yields the same shape.
 */
export function readGrid(pixels: Pixels): LetterCell[] | null {
  const lum = luminance(pixels);
  const grid = findGrid(pixels, lum);
  if (!grid) return null;
  const cells = dedupeCells(toLetterCells(pixels, classifySquares(pixels, grid, lum)).filter(isLetterCell));
  return cells.length >= MIN_CELLS && cells.length <= MAX_CELLS ? cells : null;
}

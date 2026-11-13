import { dedupeCells, isLetterCell, MAX_CELLS, MIN_CELLS, type LetterCell } from "./crossword";

/**
 * Finds a bildkorsord's grid in the photo's pixels with classic image
 * processing: grid lines are long straight dark runs on a regular lattice,
 * which text, arrows and pictures are not. Pure (plain pixel arrays in,
 * plain data out), so it runs the same in the browser (canvas ImageData)
 * and in tests (decoded JPEGs).
 */

/** RGBA pixels, row by row, as canvas ImageData and jpeg-js return them. */
export type Pixels = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

/**
 * Grid line positions (px) along one axis, first to last; square i lies
 * between lines[i] and lines[i + 1]. Each line sits on the detected line
 * nearest the fitted lattice, so small irregularities in a photo don't add
 * up across the page.
 */
export type Lattice = { step: number; lines: number[] };
export type Grid = { columns: Lattice; rows: Lattice };

export type SquareKind = "letter" | "other";
export type Square = {
  row: number;
  col: number;
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
 * …is at most this much darker than the page's white (the 90th percentile of
 * square brightness), which keeps white and yellow squares and drops grey
 * blocks, whatever the photo's exposure.
 */
const MAX_LETTER_DIMMING = 25;
/**
 * …or, if darker and wholly empty, is tinted: its colour (each channel over
 * the channel mean) differs by at least this much in some channel from both
 * the paper's and neutral grey. Solution words are often printed on pale
 * green, blue or pink, while blocks are grey: the paper check keeps grey in a
 * warm photo out, the neutral check grey on cream paper.
 */
const MIN_LETTER_TINT = 0.05;
/** …is this even (standard deviation of luminance), which rules out photographs. */
const MAX_LETTER_SPREAD = 22;
/** …and has printed borders on at least this many sides; a white area of a picture has none. */
const MIN_BORDERED_SIDES = 3;
/** How far (px) from the lattice line to look for a square's printed border. */
const BORDER_REACH = 4;
/** A side counts as bordered when line pixels cover this share of it. */
const MIN_BORDER_COVER = 0.6;
/** Rows and columns may have steps that differ by this factor; printed squares are close to square. */
const MAX_ASPECT = 1.3;
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

function luminance(pixels: Pixels): Float32Array {
  const { width, height, data } = pixels;
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return out;
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
  range: [number, number] = [length / 40, length / 6],
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
  if (origin + first * step >= MIN_EDGE_SHARE * step) first -= 1;
  if (length - (origin + last * step) >= MIN_EDGE_SHARE * step) last += 1;
  const positions: number[] = [];
  for (let index = first; index <= last; index += 1) {
    const predicted = origin + index * step;
    const nearest = weak.reduce<number | null>(
      (best, line) =>
        Math.abs(line.at - predicted) <= LINE_TOLERANCE * step &&
        (best === null || Math.abs(line.at - predicted) < Math.abs(best - predicted))
          ? line.at
          : best,
      null,
    );
    positions.push(Math.min(length, Math.max(0, nearest ?? predicted)));
  }
  return { step, lines: positions };
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

export function findGrid(pixels: Pixels): Grid | null {
  const lum = luminance(pixels);
  const columnLines = stripLines(lum, pixels, true);
  const rowLines = stripLines(lum, pixels, false);
  let columns = fitLattice(columnLines, pixels.width);
  let rows = fitLattice(rowLines, pixels.height);
  if (!columns || !rows) return null;
  // Short dividers inside split clue squares can make one axis fit half a
  // square. Squares are close to square, so refit that axis near the other's step.
  if (columns.step * MAX_ASPECT < rows.step) {
    columns = fitLattice(columnLines, pixels.width, [rows.step / MAX_ASPECT, rows.step * MAX_ASPECT]) ?? columns;
  } else if (rows.step * MAX_ASPECT < columns.step) {
    rows = fitLattice(rowLines, pixels.height, [columns.step / MAX_ASPECT, columns.step * MAX_ASPECT]) ?? rows;
  }
  return { columns, rows };
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

/** Share of one side of a square that has line pixels within BORDER_REACH of it. */
function borderCover(lum: Float32Array, pixels: Pixels, at: number, from: number, to: number, vertical: boolean) {
  const { width, height } = pixels;
  const length = vertical ? width : height;
  let samples = 0;
  let hits = 0;
  for (let t = from + (to - from) * 0.15; t <= from + (to - from) * 0.85; t += 1) {
    samples += 1;
    for (let d = -BORDER_REACH; d <= BORDER_REACH; d += 1) {
      const x = Math.round(vertical ? at + d : t);
      const y = Math.round(vertical ? t : at + d);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (onLine(lum, width, x, y, vertical, length)) {
        hits += 1;
        break;
      }
    }
  }
  return samples === 0 ? 0 : hits / samples;
}

/** Whether a printed line crosses the square's middle band, as in a split clue square. */
function divided(lum: Float32Array, pixels: Pixels, box: { left: number; top: number; right: number; bottom: number }) {
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
function pastStrip(lum: Float32Array, pixels: Pixels, box: { left: number; top: number; right: number; bottom: number }) {
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

function borderedSides(lum: Float32Array, pixels: Pixels, left: number, top: number, right: number, bottom: number) {
  return [
    borderCover(lum, pixels, left, top, bottom, true),
    borderCover(lum, pixels, right, top, bottom, true),
    borderCover(lum, pixels, top, left, right, false),
    borderCover(lum, pixels, bottom, left, right, false),
  ].filter((cover) => cover >= MIN_BORDER_COVER).length;
}

type Colour = [r: number, g: number, b: number];
type Measure = { ink: number; brightness: number; spread: number };

/** Each channel over the channel mean, so exposure cancels out and only the hue is left. */
function chromaticity([r, g, b]: Colour): Colour {
  const mean = (r + g + b) / 3 || 1;
  return [r / mean, g / mean, b / mean];
}

/** Ink share, mean brightness and evenness inside a square, inset by `inset` of its size on each side. */
function measure(lum: Float32Array, pixels: Pixels, box: { left: number; top: number; right: number; bottom: number }, inset: number): Measure | null {
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
function hue(pixels: Pixels, box: { left: number; top: number; right: number; bottom: number }, inset: number): Colour {
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

/** Measures each square's interior and borders and calls it a blank letter square or something else. */
export function classifySquares(pixels: Pixels, grid: Grid): Square[] {
  const lum = luminance(pixels);
  const measured: (Measure & {
    row: number;
    col: number;
    core: Measure;
    whole: Measure;
    sides: number;
    box: { left: number; top: number; right: number; bottom: number };
  })[] = [];
  for (let row = 0; row < grid.rows.lines.length - 1; row += 1) {
    for (let col = 0; col < grid.columns.lines.length - 1; col += 1) {
      const box = {
        left: grid.columns.lines[col],
        right: grid.columns.lines[col + 1],
        top: grid.rows.lines[row],
        bottom: grid.rows.lines[row + 1],
      };
      const interior = measure(lum, pixels, box, INSET);
      const core = measure(lum, pixels, box, CORE_INSET);
      const whole = measure(lum, pixels, box, EDGE_INSET);
      if (!interior || !core || !whole) continue;
      const sides = borderedSides(lum, pixels, box.left, box.top, box.right, box.bottom);
      measured.push({ row, col, ...interior, core, whole, sides, box });
    }
  }
  const sorted = measured.map((square) => square.brightness).toSorted((a, b) => a - b);
  const white = sorted[Math.floor(sorted.length * 0.9)] ?? 255;
  const plain = (area: Measure) => area.ink < MAX_LETTER_INK && area.spread <= MAX_LETTER_SPREAD;
  const blank = (area: Measure) => plain(area) && area.brightness >= white - MAX_LETTER_DIMMING;
  const bordered = (square: (typeof measured)[number]) => square.sides >= MIN_BORDERED_SIDES;
  const paper = average(measured.filter((square) => bordered(square) && blank(square)).map((square) => hue(pixels, square.box, INSET)));
  // Only a whole empty square may be tinted: a tinted clue square can have a
  // blank centre or a blank part past a line, and must not pass as marked.
  const tintedEmpty = (square: (typeof measured)[number]) => {
    if (paper === null || !plain(square)) return false;
    const colour = hue(pixels, square.box, INSET);
    return hueDistance(colour, paper) >= MIN_LETTER_TINT && hueDistance(colour, NEUTRAL) >= MIN_LETTER_TINT;
  };
  return measured.map((square) => {
    const { row, col, ink, brightness, spread, core, whole, box } = square;
    const empty = bordered(square) && (blank(square) || tintedEmpty(square));
    const marked = bordered(square) && !empty && blank(core) && whole.ink < MAX_MARK_INK && !divided(lum, pixels, box);
    const rest = bordered(square) && !empty && !marked ? pastStrip(lum, pixels, box) : null;
    const restMeasure = rest && measure(lum, pixels, rest, STRIP_INSET);
    const stripped = restMeasure !== null && blank(restMeasure);
    return { row, col, kind: empty || marked || stripped ? "letter" : "other", marked: marked || stripped, ink, brightness, spread };
  });
}

/** Letter squares as app cells, in 0–1000 coordinates relative to the image. */
export function toLetterCells(pixels: Pixels, grid: Grid, squares: Square[]): LetterCell[] {
  const sx = 1000 / pixels.width;
  const sy = 1000 / pixels.height;
  return squares
    .filter((square) => square.kind === "letter")
    .map((square) => {
      const x = Math.round(grid.columns.lines[square.col] * sx);
      const y = Math.round(grid.rows.lines[square.row] * sy);
      const w = Math.round(grid.columns.lines[square.col + 1] * sx) - x;
      const h = Math.round(grid.rows.lines[square.row + 1] * sy) - y;
      return { row: square.row, col: square.col, x, y, w, h };
    });
}

/**
 * The whole reading: letter cells ready for a puzzle, or null when the photo
 * doesn't read as a usable grid (then the caller asks Gemini instead). Cells
 * pass the same validation as Gemini's, so either source yields the same shape.
 */
export function readGrid(pixels: Pixels): LetterCell[] | null {
  const grid = findGrid(pixels);
  if (!grid) return null;
  const cells = dedupeCells(toLetterCells(pixels, grid, classifySquares(pixels, grid)).filter(isLetterCell));
  return cells.length >= MIN_CELLS && cells.length <= MAX_CELLS ? cells : null;
}

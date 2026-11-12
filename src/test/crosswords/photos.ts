import type { LetterCell } from "@/lib/crossword";
import type { ModelReply } from "@/lib/analyze";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Real crossword photos used by the offline replay tests
 * (`crosswords.test.ts`) and the live Gemini eval (`pnpm eval`).
 * They are Swedish bildkorsord pages photographed from magazines.
 */

/** [x, y] in the app's 0–1000 coordinates relative to the full image. */
export type Point = [x: number, y: number];

export type CrosswordPhoto = {
  name: string;
  /** What the photo shows, for test names and failure messages. */
  description: string;
  /**
   * Fewest letter squares a usable reading must find. Set well below the
   * real count: Gemini's exact count varies between runs, and a reading that
   * misses this many squares is unusable anyway.
   */
  minCells: number;
  /**
   * Hand-checked centres of letter squares (every one must be inside a found
   * cell) and of clue, block or picture areas (none may be). Spread over the
   * page, so a grid that is shifted or misses a region fails.
   */
  letterPoints: Point[];
  cluePoints: Point[];
  /**
   * The exact findProblems output for the recorded reply, so the replay test
   * catches both a regression and an improvement (update the list then).
   * The live eval reports these instead of failing, since readings vary.
   */
  knownProblems?: string[];
};

export const CROSSWORD_PHOTOS: CrosswordPhoto[] = [
  {
    name: "valpar",
    description: "puppies, picture top right, yellow cross",
    minCells: 120,
    letterPoints: [[153, 67], [210, 543], [210, 804], [843, 629], [96, 846], [900, 543]],
    cluePoints: [[36, 29], [39, 325], [571, 214], [871, 414], [443, 414], [39, 804], [154, 543]],
    knownProblems: [
      "clue area at (39, 325) read as letter square (6,0)",
      "clue area at (154, 543) read as letter square (11,1)",
    ],
  },
  {
    name: "psalmen",
    description: "painting, text box bottom left",
    minCells: 60,
    letterPoints: [[111, 423], [182, 476], [676, 587], [182, 750], [818, 93], [889, 697]],
    cluePoints: [[321, 179], [107, 364], [286, 929], [818, 529], [39, 529], [606, 914], [676, 425]],
    knownProblems: [
      "cells (5,0) and (6,7) overlap",
      "clue area at (107, 364) read as letter square (6,0)",
      "clue area at (818, 529) read as letter square (9,9)",
    ],
  },
  {
    name: "grillfest",
    description: "food, watermark across the grid",
    minCells: 90,
    letterPoints: [[161, 471], [780, 638], [100, 528], [533, 802], [841, 83], [904, 914]],
    cluePoints: [[286, 179], [471, 414], [36, 525], [841, 686], [471, 968], [904, 29]],
    knownProblems: [
      "letter square at (780, 638) not found",
      "letter square at (533, 802) not found",
      "clue area at (841, 686) read as letter square (11,9)",
      "clue area at (471, 968) read as letter square (16,6)",
      "clue area at (904, 29) read as letter square (0,2)",
    ],
  },
  {
    name: "badminton",
    description: "garden party, watermark across the grid",
    minCells: 100,
    letterPoints: [[225, 477], [726, 644], [114, 533], [782, 97], [336, 859], [671, 969]],
    cluePoints: [[300, 214], [57, 532], [559, 423], [838, 859], [838, 571], [950, 41]],
    knownProblems: [
      "clue area at (838, 859) read as letter square (14,13)",
      "clue area at (950, 41) read as letter square (0,5)",
    ],
  },
  {
    name: "byn",
    description: "village landscape, numbered squares",
    minCells: 100,
    letterPoints: [[616, 156], [89, 565], [324, 389], [675, 681], [851, 798], [148, 971]],
    cluePoints: [[286, 143], [558, 39], [324, 331], [675, 273], [793, 681], [31, 623], [558, 681]],
    knownProblems: [
      "letter square at (324, 389) not found",
      "letter square at (148, 971) not found",
    ],
  },
  {
    name: "nallar",
    description: "teddy bears, bottom rows cut off",
    minCells: 100,
    letterPoints: [[549, 149], [251, 954], [123, 551], [336, 666], [890, 91], [719, 781]],
    cluePoints: [[250, 250], [506, 143], [633, 668], [377, 896], [846, 611], [974, 379]],
    knownProblems: [
      "clue area at (633, 668) read as letter square (8,14)",
      "clue area at (377, 896) read as letter square (12,8)",
      "clue area at (846, 611) read as letter square (7,19)",
    ],
  },
  {
    name: "trott",
    description: "tired office worker, yellow row",
    minCells: 130,
    letterPoints: [[144, 406], [196, 451], [357, 634], [837, 132], [464, 771], [784, 954]],
    cluePoints: [[214, 179], [91, 361], [37, 679], [677, 587], [944, 41], [570, 86]],
    knownProblems: [
      "letter square at (464, 771) not found",
      "clue area at (91, 361) read as letter square (6,1)",
      "clue area at (37, 679) read as letter square (13,0)",
      "clue area at (677, 587) read as letter square (11,9)",
      "clue area at (570, 86) read as letter square (0,0)",
    ],
  },
];

const DIRECTORY = fileURLToPath(new URL(".", import.meta.url));

export function photoPath(photo: CrosswordPhoto) {
  return `${DIRECTORY}${photo.name}.jpg`;
}

export function replyPath(photo: CrosswordPhoto) {
  return `${DIRECTORY}${photo.name}.reply.json`;
}

/** Base64 of the photo, as the browser sends it to /api/analyze-crossword. */
export function readPhotoBase64(photo: CrosswordPhoto) {
  return readFileSync(photoPath(photo)).toString("base64");
}

/** A recorded Gemini reply, written by `pnpm eval:record`. */
export type RecordedReply = { model: string; reply: ModelReply };

/** Two cells overlapping more than this share of the smaller one are the same square read twice. */
const MAX_OVERLAP = 0.5;

function overlapShare(a: LetterCell, b: LetterCell) {
  const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  return (width * height) / Math.min(a.w * a.h, b.w * b.h);
}

/**
 * Problems that make a reading unusable in the app, as readable strings
 * (empty when the reading is fine). Pure, so the eval and the replay tests
 * apply exactly the same rules.
 */
export function findProblems(photo: CrosswordPhoto, cells: LetterCell[]): string[] {
  const problems: string[] = [];
  if (cells.length < photo.minCells) {
    problems.push(`found ${cells.length} letter squares, expected at least ${photo.minCells}`);
  }

  for (let i = 0; i < cells.length; i += 1) {
    for (let j = i + 1; j < cells.length; j += 1) {
      if (overlapShare(cells[i], cells[j]) > MAX_OVERLAP) {
        problems.push(`cells ${cellName(cells[i])} and ${cellName(cells[j])} overlap`);
      }
    }
  }

  for (const point of photo.letterPoints) {
    if (!cells.some((cell) => contains(cell, point))) problems.push(`letter square at ${pointName(point)} not found`);
  }
  for (const point of photo.cluePoints) {
    const cell = cells.find((candidate) => contains(candidate, point));
    if (cell) problems.push(`clue area at ${pointName(point)} read as letter square ${cellName(cell)}`);
  }
  return problems;
}

function contains(cell: LetterCell, [x, y]: Point) {
  return x >= cell.x && x <= cell.x + cell.w && y >= cell.y && y <= cell.y + cell.h;
}

function pointName([x, y]: Point) {
  return `(${x}, ${y})`;
}

function cellName(cell: LetterCell) {
  return `(${cell.row},${cell.col})`;
}

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
  /**
   * The same for the image reading (readGrid), which must read most photos
   * with no problems; for one it can't read fully yet, what it misses.
   */
  knownGridProblems?: string[];
};

export const CROSSWORD_PHOTOS: CrosswordPhoto[] = [
  {
    name: "valpar",
    description: "puppies, picture top right, yellow cross",
    minCells: 120,
    letterPoints: [[153, 67], [210, 543], [210, 804], [843, 629], [96, 846], [900, 543], [97, 67], [38, 500], [97, 587]],
    cluePoints: [[36, 29], [39, 325], [571, 214], [871, 414], [443, 414], [39, 804], [154, 543], [327, 760], [212, 846], [38, 890]],
    knownProblems: [
      "clue area at (39, 325) read as letter square (6,0)",
      "clue area at (154, 543) read as letter square (11,1)",
      "clue area at (327, 760) read as letter square (16,4)",
      "clue area at (212, 846) read as letter square (18,3)",
      "clue area at (38, 890) read as letter square (19,0)",
    ],
  },
  {
    name: "psalmen",
    description: "painting, text box bottom left",
    minCells: 60,
    letterPoints: [[111, 423], [182, 476], [676, 587], [182, 750], [818, 93], [889, 697], [675, 147], [40, 476], [251, 366]],
    cluePoints: [[321, 179], [107, 364], [286, 929], [818, 529], [39, 529], [606, 914], [676, 425]],
    knownProblems: [
      "cells (5,0) and (6,7) overlap",
      "letter square at (675, 147) not found",
      "letter square at (40, 476) not found",
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
    letterPoints: [[616, 156], [89, 565], [324, 389], [675, 681], [851, 798], [148, 971], [558, 155], [441, 331], [30, 739]],
    cluePoints: [[286, 143], [558, 39], [324, 331], [675, 273], [793, 681], [31, 623], [558, 681]],
    knownProblems: [
      "letter square at (324, 389) not found",
      "letter square at (148, 971) not found",
      "letter square at (558, 155) not found",
      "letter square at (441, 331) not found",
      "letter square at (30, 739) not found",
    ],
  },
  {
    name: "nallar",
    description: "teddy bears, bottom rows cut off",
    minCells: 100,
    letterPoints: [[549, 149], [251, 954], [123, 551], [336, 666], [890, 91], [719, 781], [505, 263], [206, 493], [37, 838], [37, 608]],
    cluePoints: [[250, 250], [506, 143], [633, 668], [377, 896], [846, 611], [974, 379]],
    knownProblems: [
      "letter square at (505, 263) not found",
      "letter square at (206, 493) not found",
      "clue area at (633, 668) read as letter square (8,14)",
      "clue area at (377, 896) read as letter square (12,8)",
      "clue area at (846, 611) read as letter square (7,19)",
    ],
  },
  {
    name: "trott",
    description: "tired office worker, yellow row",
    minCells: 130,
    letterPoints: [[144, 406], [196, 451], [357, 634], [837, 132], [464, 771], [784, 954], [90, 588], [37, 497], [624, 87]],
    cluePoints: [[214, 179], [91, 361], [37, 679], [677, 587], [944, 41], [570, 86], [144, 360]],
    knownProblems: [
      "letter square at (464, 771) not found",
      "clue area at (91, 361) read as letter square (6,1)",
      "clue area at (37, 679) read as letter square (13,0)",
      "clue area at (677, 587) read as letter square (11,9)",
      "clue area at (570, 86) read as letter square (0,0)",
      "clue area at (144, 360) read as letter square (6,2)",
    ],
  },
  {
    name: "ljuset",
    description: "two people, phone photo, clue strips across letter squares",
    minCells: 100,
    // Includes three letter squares with a clue strip along the top (FRIDEN, UTHUS, SES DEMONSTRERA).
    letterPoints: [[536, 368], [536, 481], [817, 43], [111, 418], [678, 87], [606, 87], [889, 966], [533, 910], [44, 582], [961, 195], [389, 362]],
    cluePoints: [[676, 199], [606, 529], [394, 745], [750, 747], [278, 173], [211, 867], [183, 475], [467, 362], [889, 418], [958, 964], [889, 39], [533, 689]],
    knownProblems: [
      "letter square at (536, 368) not found",
      "letter square at (817, 43) not found",
      "letter square at (44, 582) not found",
      "letter square at (389, 362) not found",
      "clue area at (183, 475) read as letter square (7,1)",
    ],
  },
  {
    name: "mumin",
    description: "Moomin print, picture top right, solution squares tinted green",
    minCells: 150,
    // The first five letter points are green; the big arrows that lead the solution word between them are not letter squares.
    letterPoints: [[363, 182], [363, 494], [473, 689], [803, 689], [586, 689], [143, 222], [912, 845], [308, 143], [747, 416], [143, 845]],
    cluePoints: [[88, 143], [418, 182], [363, 338], [376, 689], [693, 689], [858, 689], [693, 245], [208, 74], [912, 768], [199, 769], [473, 651]],
    knownProblems: [
      "letter square at (473, 689) not found",
      "letter square at (308, 143) not found",
      "clue area at (363, 338) read as letter square (4,4)",
      "clue area at (376, 689) read as letter square (12,4)",
      "clue area at (693, 689) read as letter square (12,8)",
      "clue area at (858, 689) read as letter square (12,11)",
      "clue area at (912, 768) read as letter square (13,12)",
      "clue area at (199, 769) read as letter square (13,1)",
    ],
  },
  {
    name: "brasan",
    description: "fireplace screenshot, cropped at the grid's left and bottom edges",
    minCells: 150,
    // The first two letter points are cut off by the photo's edge: bottom left, and bottom right beside the grey block.
    // The image reading finds both; knownProblems is only Gemini's recorded reply, which misses the first.
    letterPoints: [[29, 977], [912, 977], [737, 171], [675, 266], [206, 503], [970, 456], [29, 740], [499, 833], [853, 740]],
    cluePoints: [[675, 142], [324, 456], [29, 552], [559, 882], [970, 977], [242, 195], [29, 456], [794, 977]],
    knownProblems: [
      "letter square at (29, 977) not found",
      "letter square at (970, 456) not found",
      "letter square at (499, 833) not found",
      "clue area at (559, 882) read as letter square (15,7)",
    ],
  },
  {
    name: "rullstolen",
    description: "newsprint in dim light, with the back page showing through and teal numbered squares",
    minCells: 120,
    // Spread over the squares the back page shows through (lower left, right edge), the teal squares 1–5 and the yellow row.
    letterPoints: [
      [92.5, 778], [147, 840], [92.5, 961], [912.5, 108], [857.5, 164], [689, 227], [857.5, 409], [92.5, 593], [580, 654],
      [362.5, 836], [912.5, 900], [634, 961], [912.5, 283], [525, 346], [312.5, 470], [967.5, 593], [802, 840], [471, 593],
      [800, 37],
    ],
    // The second clue point is a plain patch of wall in the photo, tinted like a solution square.
    cluePoints: [[197, 409], [145.6, 49], [35.6, 513], [472, 532], [857.5, 846], [187.5, 186], [884, 967], [689, 409], [525, 714], [967.5, 45], [34, 963]],
    // Gemini's recorded reply; the image reading finds every labelled square.
    knownProblems: [
      "letter square at (912.5, 108) not found",
      "letter square at (857.5, 409) not found",
      "letter square at (580, 654) not found",
      "letter square at (362.5, 836) not found",
      "letter square at (471, 593) not found",
      "letter square at (800, 37) not found",
      "clue area at (857.5, 846) read as letter square (10,11)",
    ],
  },
  {
    name: "dubbelkryss",
    description: "two-page spread scaled down to 1200 px, about 41 squares across, with a curved right page",
    minCells: 100,
    // Both pages, including the yellow solution rows and the columns beside the spine.
    letterPoints: [
      [420, 627], [294, 664], [66, 768], [89, 833], [135, 867], [758, 220], [800, 312], [885, 371], [540, 634], [592, 823],
      [469, 702], [518, 774], [518, 811],
    ],
    // Clue squares on both pages, also beside the spine, which a lattice two squares wide covers, and both pictures.
    cluePoints: [
      [246, 597], [318, 691], [266, 725], [34, 763], [66, 832], [783, 181], [690, 338], [885, 440], [595, 536], [615, 608],
      [564, 854], [120, 300], [850, 650], [469, 639], [541, 772],
    ],
    // The column beside the spine curves away, so its squares look narrower than their neighbours.
    knownGridProblems: ["letter square at (518, 774) not found", "letter square at (518, 811) not found"],
    // Gemini's recorded reply finds only part of the grid; the image reading is the one that reads this photo.
    knownProblems: [
      "found 55 letter squares, expected at least 100",
      "letter square at (420, 627) not found",
      "letter square at (294, 664) not found",
      "letter square at (66, 768) not found",
      "letter square at (89, 833) not found",
      "letter square at (135, 867) not found",
      "letter square at (758, 220) not found",
      "letter square at (800, 312) not found",
      "letter square at (885, 371) not found",
      "letter square at (540, 634) not found",
      "letter square at (592, 823) not found",
      "letter square at (469, 702) not found",
      "letter square at (518, 774) not found",
      "letter square at (518, 811) not found",
      "clue area at (783, 181) read as letter square (12,11)",
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

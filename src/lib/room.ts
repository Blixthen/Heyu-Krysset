import type { CrosswordPuzzle } from "./crossword";

/**
 * Each crossword is solved in its own room: its own realtime channel, with
 * its own chat, letters and players. A copy started over stays in the room
 * of the puzzle it copies (restartOf names the first one), so starting over
 * keeps everyone together.
 */
export function roomOf(puzzle: Pick<CrosswordPuzzle, "id" | "restartOf">) {
  return puzzle.restartOf ?? puzzle.id;
}

/**
 * The realtime channel of a room. The topic from /api/room is secret, so
 * knowing a puzzle id, which is in every link, isn't enough to join.
 */
export function roomChannel(topic: string, room: string) {
  return `${topic}:${room}`;
}

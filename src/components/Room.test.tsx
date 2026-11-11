// @vitest-environment jsdom
import { emptyBoard } from "@/lib/board";
import { makePuzzle } from "@/test/fixtures";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const room = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/hooks/useCrosswordRoom", () => ({ useCrosswordRoom: () => room.current }));

const { Room } = await import("./Room");

function roomState(overrides: object = {}) {
  return {
    clientId: "me",
    status: "live",
    connectionError: "",
    sendError: "",
    shareError: "",
    messages: [],
    board: emptyBoard,
    reconnect: vi.fn(),
    sendMessage: vi.fn(),
    publishPuzzle: vi.fn(),
    setLetter: vi.fn(),
    ...overrides,
  };
}

describe("Room", () => {
  afterEach(cleanup);

  it("shows the uploader when there is no puzzle", () => {
    room.current = roomState();
    render(<Room nickname="Nova" onLeave={() => {}} />);
    expect(screen.getByText("Här hamnar korsordet")).toBeTruthy();
    expect(screen.queryByText("Nytt korsord")).toBeNull();
  });

  it("lets you replace an existing puzzle", () => {
    room.current = roomState({ board: { puzzle: makePuzzle(), letters: {} } });
    render(<Room nickname="Nova" onLeave={() => {}} />);
    expect(screen.getByText("Nytt korsord")).toBeTruthy();
    expect(screen.getAllByRole("textbox").length).toBeGreaterThan(1);
  });

  it("shows share errors", () => {
    room.current = roomState({ shareError: "Korsordet kunde inte delas med de andra." });
    render(<Room nickname="Nova" onLeave={() => {}} />);
    expect(screen.getByText("Korsordet kunde inte delas med de andra.")).toBeTruthy();
  });
});

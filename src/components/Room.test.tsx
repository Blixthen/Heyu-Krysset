// @vitest-environment jsdom
import { emptyBoard } from "@/lib/board";
import { makePuzzle } from "@/test/fixtures";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    reactions: new Map(),
    react: vi.fn(),
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
    room.current = roomState({ board: { puzzle: makePuzzle(), letters: {}, authors: {} } });
    render(<Room nickname="Nova" onLeave={() => {}} />);
    expect(screen.getByText("Nytt korsord")).toBeTruthy();
    expect(screen.getAllByRole("textbox").length).toBeGreaterThan(1);
  });

  it("lists the players who typed letters, with the colour their letters have", () => {
    const board = { puzzle: makePuzzle(), letters: { "0-0": "A", "0-1": "B" }, authors: { "0-0": "Liv", "0-1": "Ann" } };
    room.current = roomState({ board });
    render(<Room nickname="Nova" onLeave={() => {}} />);
    const players = screen.getAllByRole("listitem").filter((item) => item.closest('[aria-label="Spelare"]'));
    expect(players.map((item) => item.textContent)).toEqual(["Ann", "Liv"]);
    // Ann and Liv hash to the same colour, so Liv moves on to another; each dot matches its letters' tint.
    const dot = (item: Element) => item.querySelector("span")?.className.match(/\bbg-(\w+)-300\b/)?.[1];
    const tint = (label: string) => screen.getByLabelText(label).className.match(/\bbg-(\w+)-300\/40\b/)?.[1];
    expect(dot(players[0])).toBe(tint("Rad 1, ruta 2"));
    expect(dot(players[1])).toBe(tint("Rad 1, ruta 1"));
    expect(dot(players[0])).not.toBe(dot(players[1]));
  });

  it("folds the chat on phones and counts messages that arrive while it is folded", () => {
    const message = (id: string) => ({ id, senderId: "peer", nickname: "Kim", text: id, sentAt: "" });
    room.current = roomState({ messages: [message("m1")] });
    const { rerender } = render(<Room nickname="Nova" onLeave={() => {}} />);
    const toggle = () => screen.getByRole("button", { name: /Livechatt/ });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().textContent).toContain("1 nya");

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(toggle().textContent).not.toContain("nya");

    fireEvent.click(toggle());
    expect(toggle().textContent).not.toContain("nya");
    room.current = roomState({ messages: [message("m1"), message("m2"), message("m3")] });
    rerender(<Room nickname="Nova" onLeave={() => {}} />);
    expect(toggle().textContent).toContain("2 nya");
  });

  it("shows the banner photo behind the header, still when less motion is asked for", () => {
    room.current = roomState();
    render(<Room nickname="Nova" onLeave={() => {}} />);
    const header = screen.getByRole("banner");
    expect(header.querySelector("img")?.getAttribute("src")).toBe("/banner.webp");
    const still = header.querySelector('source[media="(prefers-reduced-motion: reduce)"]');
    expect(still?.getAttribute("srcset")).toBe("/banner-still.webp");
    // Decorative (empty alt), so screen readers skip it.
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows share errors", () => {
    room.current = roomState({ shareError: "Korsordet kunde inte delas med de andra." });
    render(<Room nickname="Nova" onLeave={() => {}} />);
    expect(screen.getByText("Korsordet kunde inte delas med de andra.")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { makePuzzle } from "@/test/fixtures";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/nickname", () => ({ useNickname: () => "Nova", saveNickname: vi.fn() }));

// Stand-ins that show what they were given and expose their callbacks as buttons.
const mounts = vi.hoisted(() => ({ rooms: 0 }));
vi.mock("@/components/Home", () => ({
  Home: (props: { onOpen: (id: string) => void; onShare: (shared: unknown) => void }) =>
    createElement(
      "div",
      null,
      createElement("p", null, "home"),
      createElement("button", { onClick: () => props.onOpen(A) }, "open"),
      createElement("button", { onClick: () => props.onShare({ puzzle: makePuzzle({ id: B }), file: new File([], "k.jpg") }) }, "share"),
    ),
}));
vi.mock("@/components/Room", async () => {
  const { useState } = await import("react");
  return {
    Room: (props: { linkedPuzzleId?: string; shared?: { puzzle: { id: string } }; onHome: () => void; onSharedTaken?: () => void }) => {
      // Counts mounts, so a test can tell a fresh room from a re-render.
      useState(() => (mounts.rooms += 1));
      return createElement(
        "div",
        null,
        createElement("p", null, `room ${props.linkedPuzzleId} ${props.shared ? `shared ${props.shared.puzzle.id}` : "linked"}`),
        createElement("button", { onClick: props.onHome }, "home"),
        createElement("button", { onClick: props.onSharedTaken }, "taken"),
      );
    },
  };
});

const { App } = await import("./App");

const A = "aaaaaaaa-8b4d-4c6e-9a1b-2d3e4f5a6b7c";
const B = "bbbbbbbb-8b4d-4c6e-9a1b-2d3e4f5a6b7c";

describe("App", () => {
  beforeEach(() => {
    mounts.rooms = 0;
    window.history.replaceState(null, "", "/");
  });
  afterEach(cleanup);

  it("starts on the list, or in the room of the crossword the link opens", () => {
    render(<App />);
    expect(screen.getByText("home")).toBeTruthy();
    cleanup();
    render(<App linkedPuzzleId={A} />);
    expect(screen.getByText(`room ${A} linked`)).toBeTruthy();
  });

  it("opens a crossword's room at its link, and Back returns to the list", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByText(`room ${A} linked`)).toBeTruthy();
    expect(window.location.pathname).toBe(`/p/${A}`);

    act(() => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByText("home")).toBeTruthy();
  });

  it("opens a crossword just shared in its room, handing it over, and goes home from the room", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "share" }));
    expect(screen.getByText(`room ${B} shared ${B}`)).toBeTruthy();
    expect(window.location.pathname).toBe(`/p/${B}`);

    fireEvent.click(screen.getByRole("button", { name: "home" }));
    expect(screen.getByText("home")).toBeTruthy();
    expect(window.location.pathname).toBe("/");
  });

  it("forgets a crossword just shared once its room took it, so a later room opens it by its link", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "share" }));
    fireEvent.click(screen.getByRole("button", { name: "taken" }));
    expect(screen.getByText(`room ${B} linked`)).toBeTruthy();
    expect(mounts.rooms).toBe(1);
  });

  it("starts a fresh room for another crossword, but not when the address only follows a restart", () => {
    render(<App linkedPuzzleId={A} />);
    expect(mounts.rooms).toBe(1);
    // The room keeps the address on its current puzzle, which a restart changes.
    act(() => window.history.replaceState(null, "", `/p/${B}`));
    expect(mounts.rooms).toBe(1);

    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(screen.getByText(`room ${B} linked`)).toBeTruthy();
    expect(mounts.rooms).toBe(2);
  });
});

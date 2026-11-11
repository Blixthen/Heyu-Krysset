// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveNickname, useNickname } from "./nickname";

function Probe() {
  const nickname = useNickname();
  return <span>{nickname === null ? "server" : nickname}</span>;
}

describe("useNickname", () => {
  afterEach(() => {
    saveNickname("");
    localStorage.clear();
  });

  it("is null during server rendering, so nothing reads localStorage there", () => {
    expect(renderToString(<Probe />)).toContain("server");
  });

  it("reads the saved nickname and updates on save", () => {
    localStorage.setItem("heyu-crossword-nickname", "Nova");
    const { result } = renderHook(() => useNickname());
    expect(result.current).toBe("Nova");
    act(() => saveNickname("Kim"));
    expect(result.current).toBe("Kim");
    expect(localStorage.getItem("heyu-crossword-nickname")).toBe("Kim");
  });

  it("clears the nickname", () => {
    saveNickname("Nova");
    const { result } = renderHook(() => useNickname());
    act(() => saveNickname(""));
    expect(result.current).toBe("");
    expect(localStorage.getItem("heyu-crossword-nickname")).toBeNull();
  });

  it("falls back to memory when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const { result } = renderHook(() => useNickname());
    act(() => saveNickname("Nova"));
    expect(result.current).toBe("Nova");
  });
});

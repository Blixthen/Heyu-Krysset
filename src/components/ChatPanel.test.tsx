// @vitest-environment jsdom
import type { DisplayMessage } from "@/hooks/useCrosswordRoom";
import type { Reactions } from "@/lib/reactions";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";

const base: DisplayMessage = {
  id: "m1",
  senderId: "me",
  nickname: "Nova",
  text: "Hej",
  sentAt: "2026-11-08T12:00:00.000Z",
};

function renderPanel(props: Partial<ComponentProps<typeof ChatPanel>> = {}) {
  const onSend = vi.fn();
  const onReconnect = vi.fn();
  render(
    <ChatPanel
      clientId="me"
      status="live"
      connectionError=""
      sendError=""
      messages={[]}
      onSend={onSend}
      onReconnect={onReconnect}
      {...props}
    />,
  );
  return { onSend, onReconnect };
}

describe("ChatPanel", () => {
  afterEach(cleanup);

  it("decides 'mine' by sender id, not by nickname", () => {
    renderPanel({
      messages: [base, { ...base, id: "m2", senderId: "impostor", text: "Jag är också Nova" }],
    });
    expect(screen.getByText("Hej").closest("article")?.className).toContain("ml-auto");
    expect(screen.getByText("Jag är också Nova").closest("article")?.className).not.toContain("ml-auto");
  });

  it("flags messages that failed to send", () => {
    renderPanel({ messages: [{ ...base, failed: true }] });
    expect(screen.getByText("Skickades inte")).toBeTruthy();
  });

  it("renders a message with an unparseable timestamp without crashing", () => {
    renderPanel({ messages: [{ ...base, sentAt: "garbage" }] });
    expect(screen.getByText("Hej")).toBeTruthy();
  });

  it("sends trimmed text and clears the draft", () => {
    const { onSend } = renderPanel();
    const input = screen.getByLabelText("Meddelande") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  hallå  " } });
    fireEvent.click(screen.getByLabelText("Skicka meddelande"));
    expect(onSend).toHaveBeenCalledWith("hallå");
    expect(input.value).toBe("");
  });

  it("folds and unfolds from its heading, showing how many messages are new", () => {
    const onToggle = vi.fn();
    renderPanel({ open: false, unread: 3, onToggle });
    const toggle = screen.getByRole("button", { name: /Livechatt/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("3 nya");
    expect(document.getElementById("chat-body")?.className).toMatch(/(^| )hidden( |$)/);
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("shows the messages when unfolded", () => {
    renderPanel({ open: true, unread: 0, onToggle: vi.fn() });
    expect(screen.getByRole("button", { name: "Livechatt" }).getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("chat-body")?.className).not.toMatch(/(^| )hidden( |$)/);
  });

  it("offers a manual reconnect after giving up", () => {
    const { onReconnect } = renderPanel({ status: "error", connectionError: "Kanalen svarade inte." });
    fireEvent.click(screen.getByText("Försök igen"));
    expect(onReconnect).toHaveBeenCalled();
  });

  it("does not offer reconnect while still connecting", () => {
    renderPanel({ status: "connecting", connectionError: "Kanalen svarade inte." });
    expect(screen.queryByText("Försök igen")).toBeNull();
  });

  describe("reactions", () => {
    const peerMessage: DisplayMessage = { ...base, id: "m2", senderId: "peer", nickname: "Kim", text: "Svårt!" };

    it("reacts with an emoji picked from a message's picker, then closes it", () => {
      const onReact = vi.fn();
      renderPanel({ messages: [base, peerMessage], onReact });
      fireEvent.click(screen.getByRole("button", { name: "Reagera på Kims meddelande" }));
      fireEvent.click(screen.getByRole("button", { name: "Reagera med 😂" }));
      expect(onReact).toHaveBeenCalledWith("m2", "😂");
      expect(screen.queryByRole("group", { name: "Välj reaktion" })).toBeNull();
    });

    it("shows who reacted, marks our own reaction, and toggles it on tap", () => {
      const onReact = vi.fn();
      const reactions = new Map([
        ["m2", new Map([["👍", new Map([["peer", "Kim"], ["me", "Nova"]])], ["❤️", new Map([["peer", "Kim"]])]])],
      ]) as Reactions;
      renderPanel({ messages: [peerMessage], reactions, onReact });
      const thumbs = screen.getByRole("button", { name: "👍 2: Kim, Nova" });
      expect(thumbs.getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: "❤️ 1: Kim" }).getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(thumbs);
      expect(onReact).toHaveBeenCalledWith("m2", "👍");
    });

    it("offers no reactions on a message that failed to send", () => {
      renderPanel({ messages: [{ ...base, failed: true }], onReact: vi.fn() });
      expect(screen.queryByRole("button", { name: /Reagera/ })).toBeNull();
    });
  });
});

// @vitest-environment jsdom
import type { DisplayMessage } from "@/hooks/useCrosswordRoom";
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

  it("offers a manual reconnect after giving up", () => {
    const { onReconnect } = renderPanel({ status: "error", connectionError: "Kanalen svarade inte." });
    fireEvent.click(screen.getByText("Försök igen"));
    expect(onReconnect).toHaveBeenCalled();
  });

  it("does not offer reconnect while still connecting", () => {
    renderPanel({ status: "connecting", connectionError: "Kanalen svarade inte." });
    expect(screen.queryByText("Försök igen")).toBeNull();
  });
});

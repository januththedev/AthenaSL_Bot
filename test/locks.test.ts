import { describe, expect, it } from "vitest";
import { messageMatchesLock } from "../src/modules/locks.js";
import type { Message } from "grammy/types";

function textMsg(text: string): Message {
  return {
    message_id: 1,
    date: 0,
    chat: { id: -100, title: "t", type: "supergroup" },
    text,
  } as unknown as Message;
}

describe("messageMatchesLock", () => {
  it("matches url via entities", () => {
    const msg = {
      ...textMsg("go to https://example.com"),
      entities: [{ offset: 6, length: 19, type: "url" }],
    } as unknown as Message;
    expect(messageMatchesLock(msg, "url")).toBe(true);
    expect(messageMatchesLock(textMsg("plain words"), "url")).toBe(false);
  });

  it("matches media locks", () => {
    const photo = { ...textMsg(""), photo: [{ file_id: "x" }] } as unknown as Message;
    expect(messageMatchesLock(photo, "photo")).toBe(true);
    expect(messageMatchesLock(photo, "all")).toBe(true);
    expect(messageMatchesLock(photo, "video")).toBe(false);
  });

  it("detects forwards and inline usage", () => {
    const fwd = { ...textMsg(""), forward_origin: { type: "user" } } as unknown as Message;
    expect(messageMatchesLock(fwd, "forward")).toBe(true);
    const inline = { ...textMsg(""), via_bot: { id: 1 } } as unknown as Message;
    expect(messageMatchesLock(inline, "inline")).toBe(true);
  });

  it("ignores plain text for the all lock", () => {
    expect(messageMatchesLock(textMsg("just talking"), "all")).toBe(false);
  });
});

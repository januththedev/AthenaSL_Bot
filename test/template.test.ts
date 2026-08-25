import { describe, expect, it } from "vitest";
import { renderTemplate, escapeHtml } from "../src/utils.js";

const vars = {
  user: { id: 42, is_bot: false, first_name: "Ada", last_name: "<Lovelace>", username: "ada_l" },
  chatName: "Study & Chill",
  memberCount: 1234,
};

describe("renderTemplate", () => {
  it("replaces all supported fillings", () => {
    const out = renderTemplate(
      "{first}|{last}|{fullname}|{username}|{id}|{chatname}|{count}",
      vars,
    );
    expect(out).toBe("Ada|<Lovelace>|Ada <Lovelace>|@ada_l|42|Study & Chill|1234");
  });

  it("falls back gracefully when user data is missing", () => {
    const out = renderTemplate(
      "Hi {first} ({username}), id={id}, count={count}",
      { chatName: "X", memberCount: 0 },
    );
    expect(out).toBe("Hi friend ((no username)), id=?, count=0");
  });

  it("leaves unknown text untouched", () => {
    expect(renderTemplate("no tokens here", { chatName: "c", memberCount: 1 })).toBe(
      "no tokens here",
    );
  });
});

describe("escapeHtml", () => {
  it("escapes HTML-sensitive characters", () => {
    expect(escapeHtml("<b>Tom & Jerry</b>")).toBe("&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;");
  });
});

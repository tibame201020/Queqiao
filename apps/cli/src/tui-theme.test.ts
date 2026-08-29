import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { createQueqiaoTheme, shouldUseCliColor, TUI_GLYPHS } from "./tui-theme.js";

describe("Queqiao CLI theme", () => {
  it("disables color for non-TTY, NO_COLOR, and TERM=dumb", () => {
    expect(shouldUseCliColor({ isTTY: false, noColor: undefined, term: "xterm-256color" })).toBe(false);
    expect(shouldUseCliColor({ isTTY: true, noColor: "1", term: "xterm-256color" })).toBe(false);
    expect(shouldUseCliColor({ isTTY: true, noColor: undefined, term: "dumb" })).toBe(false);
    expect(shouldUseCliColor({ isTTY: true, noColor: undefined, term: "xterm-256color" })).toBe(true);
  });

  it("keeps semantic glyphs intact when color is disabled", () => {
    const theme = createQueqiaoTheme(false);
    expect(theme.accent(TUI_GLYPHS.focus)).toBe("›");
    expect(theme.success(TUI_GLYPHS.selected)).toBe("■");
    expect(theme.danger(TUI_GLYPHS.danger)).toBe("×");
  });

  it("keeps structural color semantic and removable", () => {
    const plain = createQueqiaoTheme(false);
    expect(plain.identifier("stable")).toBe("stable");
    expect(plain.link("https://example.test/")).toBe("https://example.test/");
    expect(plain.code("queqiao worker status")).toBe("queqiao worker status");
    expect(plain.value("8076")).toBe("8076");

    const colored = createQueqiaoTheme(true);
    expect(stripVTControlCharacters(colored.identifier("stable"))).toBe("stable");
    expect(stripVTControlCharacters(colored.link("https://example.test/"))).toBe("https://example.test/");
    expect(stripVTControlCharacters(colored.code("queqiao worker status"))).toBe("queqiao worker status");
    expect(stripVTControlCharacters(colored.value("8076"))).toBe("8076");
    expect(colored.identifier("stable")).not.toBe("stable");
  });

  it("uses ANSI only as an enhancement", () => {
    const theme = createQueqiaoTheme(true);
    expect(stripVTControlCharacters(theme.accent("focus"))).toBe("focus");
    expect(stripVTControlCharacters(theme.success("ok"))).toBe("ok");
    expect(stripVTControlCharacters(theme.danger("error"))).toBe("error");
  });
});

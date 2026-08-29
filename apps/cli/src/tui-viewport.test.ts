import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { ACCESS_TOOL_OPTIONS, DEFAULT_ACCESS_TOOLS } from "./access-configuration.js";
import { renderQueqiaoMultiSelectFrame } from "./tui-multiselect.js";
import { renderQueqiaoSelectFrame } from "./tui-select.js";
import { TUI_GLYPHS } from "./tui-theme.js";
import { resolveChoiceViewport, wrapChoiceText } from "./tui-viewport.js";

function plain(value: string): string {
  return stripVTControlCharacters(value);
}

describe("TUI viewport", () => {
  it("wraps secondary text before the terminal wraps it", () => {
    const lines = wrapChoiceText("alpha beta gamma delta epsilon", 12);
    expect(lines.every((line) => line.length <= 12)).toBe(true);
    expect(lines.join(" ")).toBe("alpha beta gamma delta epsilon");
  });

  it("keeps the focused option visible while bounding variable-height choices", () => {
    const viewport = resolveChoiceViewport([
      ["one", "detail"],
      ["two", "detail", "detail"],
      ["three", "detail"],
      ["four", "detail", "detail"],
      ["five", "detail"],
    ], 3, 7);
    expect(viewport.start).toBeLessThanOrEqual(3);
    expect(viewport.end).toBeGreaterThanOrEqual(3);
    const rows = Array.from({ length: viewport.end - viewport.start + 1 }, (_, offset) => viewport.start + offset)
      .reduce((sum, index) => sum + [2, 3, 2, 3, 2][index]!, 0)
      + (viewport.hiddenBefore ? 1 : 0)
      + (viewport.hiddenAfter ? 1 : 0);
    expect(rows).toBeLessThanOrEqual(7);
  });

  it.each([
    [80, 24],
    [60, 24],
  ])("keeps the full Tools frame inside %i x %i and preserves guide indentation", (columns, rows) => {
    const output = plain(renderQueqiaoMultiSelectFrame({
      message: "Tools",
      options: ACCESS_TOOL_OPTIONS.map((option) => ({ ...option })),
      selected: [...DEFAULT_ACCESS_TOOLS],
      cursor: ACCESS_TOOL_OPTIONS.findIndex((option) => option.value === "run"),
      state: "active",
      withGuide: true,
      terminalColumns: columns,
      terminalRows: rows,
    }));
    const lines = output.split("\n");
    expect(lines.length).toBeLessThanOrEqual(rows);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(columns);
    expect(output).toContain(`${TUI_GLYPHS.focus} ${TUI_GLYPHS.unselected} run`);
    expect(lines.some((line) => /\d+ more$/.test(line))).toBe(true);
    const guideDescriptionPrefix = `${TUI_GLYPHS.guide}      `;
    for (const line of lines) {
      if (/^(Run command|configured coding|native process|Extension proxy|Queqiao extensions|installed extension|Worker-authoritative)/.test(line.trim())) {
        expect(line.startsWith(guideDescriptionPrefix)).toBe(true);
      }
    }
  });

  it("wraps single-select descriptions on the same guide column", () => {
    const output = plain(renderQueqiaoSelectFrame({
      message: "Access profile",
      options: [
        { value: "reader", label: "Reader", description: "Tools: workspace_info, read_file, list_workspaces, open_workspace, list_directory, search_text" },
        { value: "editor", label: "Editor", description: "Tools: workspace_info, read_file, list_workspaces, open_workspace, list_directory, search_text, write_file, edit_file" },
      ],
      cursor: 1,
      state: "active",
      withGuide: true,
      terminalColumns: 60,
      terminalRows: 24,
    }));
    const lines = output.split("\n");
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(60);
    const guideDescriptionPrefix = `${TUI_GLYPHS.guide}      `;
    const descriptions = lines.filter((line) => line.includes("Tools:") || line.trim().startsWith("open_workspace") || line.trim().startsWith("list_directory") || line.trim().startsWith("search_text"));
    expect(descriptions.length).toBeGreaterThan(0);
    for (const line of descriptions) expect(line.startsWith(guideDescriptionPrefix)).toBe(true);
  });
});

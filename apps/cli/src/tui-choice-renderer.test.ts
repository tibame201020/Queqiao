import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { multiChoicePresentation, renderMultiChoiceLines, renderSingleChoiceLines } from "./tui-choice-renderer.js";
import { createQueqiaoTheme } from "./tui-theme.js";

const option = {
  label: "read_file",
  description: "Read UTF-8 text from a workspace-relative path.",
};

function plain(lines: string[]): string[] {
  return lines.map((line) => stripVTControlCharacters(line));
}

const monochrome = createQueqiaoTheme(false);

describe("Queqiao choice renderer", () => {
  it("uses independent non-color channels for focus and selection", () => {
    expect(renderMultiChoiceLines(option, { focused: false, selected: false }, monochrome)[0]).toBe("  □ read_file");
    expect(renderMultiChoiceLines(option, { focused: false, selected: true }, monochrome)[0]).toBe("  ■ read_file");
    expect(renderMultiChoiceLines(option, { focused: true, selected: false }, monochrome)[0]).toBe("› □ read_file");
    expect(renderMultiChoiceLines(option, { focused: true, selected: true }, monochrome)[0]).toBe("› ■ read_file");
  });

  it("keeps descriptions emphasized for selected or focused rows", () => {
    expect(multiChoicePresentation({ focused: false, selected: false }).descriptionMuted).toBe(true);
    expect(multiChoicePresentation({ focused: false, selected: true }).descriptionMuted).toBe(false);
    expect(multiChoicePresentation({ focused: true, selected: false }).descriptionMuted).toBe(false);
    expect(multiChoicePresentation({ focused: true, selected: true }).descriptionMuted).toBe(false);
  });

  it("never dims the primary option label", () => {
    for (const state of [
      { focused: false, selected: false },
      { focused: false, selected: true },
      { focused: true, selected: false },
      { focused: true, selected: true },
    ]) {
      expect(renderMultiChoiceLines(option, state)[0]).not.toContain("\u001b[2m");
    }
  });

  it("renders multiline secondary information on a stable content column", () => {
    expect(plain(renderMultiChoiceLines({
      label: "Gateway: stable",
      description: "Persistent: C:\\Queqiao\\gateway\nRuntime: C:\\Temp\\gateway",
    }, { focused: true, selected: true }))).toEqual([
      "› ■ Gateway: stable",
      "    Persistent: C:\\Queqiao\\gateway",
      "    Runtime: C:\\Temp\\gateway",
    ]);
  });

  it("uses the same focus grammar for single-choice rows without a selection marker", () => {
    expect(plain(renderSingleChoiceLines({
      label: "Reader",
      description: "Tools: read_file, search_text",
    }, { focused: true }))).toEqual([
      "› Reader",
      "    Tools: read_file, search_text",
    ]);
    expect(plain(renderSingleChoiceLines({ label: "Editor" }, { focused: false }))).toEqual(["  Editor"]);
  });

  it("keeps disabled state readable without relying on color", () => {
    expect(renderMultiChoiceLines({ label: "shell" }, { focused: false, selected: false, disabled: true }, monochrome)[0]).toBe("  □ shell");
  });
});

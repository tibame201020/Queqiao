import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { renderQueqiaoSelectFrame } from "./tui-select.js";

function plain(value: string): string {
  return stripVTControlCharacters(value);
}

describe("Queqiao single-select primitive", () => {
  it("renders focus with structured secondary information", () => {
    const output = plain(renderQueqiaoSelectFrame({
      message: "Access profile",
      options: [
        { value: "reader", label: "Reader", description: "Tools: read_file, search_text" },
        { value: "editor", label: "Editor", description: "Tools: read_file, write_file, edit_file" },
      ],
      value: "reader",
      cursor: 1,
      state: "active",
      withGuide: false,
    }));

    expect(output).toContain("  Reader");
    expect(output).toContain("    Tools: read_file, search_text");
    expect(output).toContain("> Editor");
    expect(output).toContain("↑/↓ to navigate • Enter: confirm");
    expect(output).not.toContain("[x]");
  });

  it("summarizes the selected primary label on submit", () => {
    const output = plain(renderQueqiaoSelectFrame({
      message: "Select Gateway",
      options: [{ value: "stable", label: "stable" }],
      value: "stable",
      cursor: 0,
      state: "submit",
      withGuide: true,
    }));

    expect(output).toContain("◇  Select Gateway");
    expect(output).toContain("stable");
    expect(output).not.toContain("Enter: confirm");
  });
});

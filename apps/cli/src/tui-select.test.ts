import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { renderQueqiaoSelectFrame } from "./tui-select.js";

describe("Queqiao single-select primitive", () => {
  it("renders focus with structured secondary information", () => {
    const output = stripVTControlCharacters(renderQueqiaoSelectFrame({
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
    expect(output).toContain("› Editor");
    expect(output).toContain("↑/↓ navigate · Enter confirm");
    expect(output).not.toContain("■");
  });

  it("summarizes the selected primary label on submit", () => {
    const output = stripVTControlCharacters(renderQueqiaoSelectFrame({
      message: "Select Gateway",
      options: [{ value: "stable", label: "stable" }],
      value: "stable",
      cursor: 0,
      state: "submit",
      withGuide: true,
    }));

    expect(output).toContain("◇  Select Gateway");
    expect(output).toContain("stable");
    expect(output).not.toContain("Enter confirm");
  });
});

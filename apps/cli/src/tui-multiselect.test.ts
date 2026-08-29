import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { renderQueqiaoMultiSelectFrame } from "./tui-multiselect.js";

function plain(value: string): string {
  return stripVTControlCharacters(value);
}

describe("Queqiao multi-select primitive", () => {
  it("renders focus and selection independently with multiline secondary information", () => {
    const output = plain(renderQueqiaoMultiSelectFrame({
      message: "Select local Queqiao data to remove",
      options: [
        {
          value: "gateway:stable",
          label: "Gateway: stable",
          description: "Persistent: C:\\Queqiao\\gateway\nRuntime: C:\\Temp\\gateway",
        },
        {
          value: "extension-hub",
          label: "Extension Hub",
          description: "Path: C:\\Queqiao\\extensions",
        },
      ],
      selected: ["gateway:stable"],
      cursor: 1,
      state: "active",
      withGuide: false,
    }));

    expect(output).toContain("  [x] Gateway: stable");
    expect(output).toContain("      Persistent: C:\\Queqiao\\gateway");
    expect(output).toContain("      Runtime: C:\\Temp\\gateway");
    expect(output).toContain("> [ ] Extension Hub");
    expect(output).toContain("      Path: C:\\Queqiao\\extensions");
  });

  it("uses a domain-supplied submit summary", () => {
    const output = plain(renderQueqiaoMultiSelectFrame({
      message: "Tools",
      options: [{ value: "read_file", label: "read_file" }],
      selected: ["read_file"],
      cursor: 0,
      state: "submit",
      withGuide: true,
      summary: (selected) => `${selected.length} tools selected`,
    }));

    expect(output).toContain("◇  Tools");
    expect(output).toContain("1 tools selected");
    expect(output).not.toContain("Space: select");
  });
});

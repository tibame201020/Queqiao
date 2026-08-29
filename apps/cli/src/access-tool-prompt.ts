import { styleText } from "node:util";
import { MultiSelectPrompt, settings } from "@clack/core";
import type { CorePublicToolName } from "@queqiao/core-manifest";
import type { AccessToolOption } from "./access-configuration.js";
import { renderAccessToolOption } from "./access-configuration.js";

const CHECKED = "◼";
const UNCHECKED = "◻";
const ACTIVE = "◆";
const SUBMIT = "◇";
const BAR = "│";
const END = "└";

export async function accessToolMultiselect(options: AccessToolOption[], initialValues: CorePublicToolName[]): Promise<CorePublicToolName[] | symbol> {
  return new MultiSelectPrompt({
    options,
    initialValues,
    required: true,
    validate(value) {
      if (!value?.length) return "Please select at least one tool.";
    },
    render() {
      const withGuide = settings.withGuide;
      const selected = this.value ?? [];
      const prefix = withGuide ? `${styleText("cyan", BAR)}  ` : "";
      const headerSymbol = this.state === "submit" ? styleText("green", SUBMIT) : styleText("cyan", ACTIVE);
      const header = `${headerSymbol}  Tools`;

      if (this.state === "submit") {
        return `${header}\n${withGuide ? styleText("gray", BAR) : ""}  ${styleText("dim", `${selected.length} tools selected`)}`;
      }

      const lines = this.options.flatMap((option, index) => {
        const isSelected = selected.includes(option.value);
        const isFocused = index === this.cursor;
        const checkbox = isSelected ? styleText("green", CHECKED) : styleText("dim", UNCHECKED);
        const rendered = renderAccessToolOption(option, isSelected, isFocused).split("\n");
        const name = isFocused ? rendered[0] : isSelected ? rendered[0] : styleText("dim", rendered[0] ?? option.label);
        const description = rendered[1] ?? "";
        return [
          `${prefix}${checkbox} ${name}`,
          `${prefix}  ${description}`,
        ];
      });

      const error = this.state === "error" ? [`${prefix}${styleText("yellow", this.error)}`] : [];
      const footer = `${prefix}${styleText("dim", "↑/↓ to navigate • Space: select • Enter: confirm")}`;
      const end = withGuide ? styleText("cyan", END) : "";
      return [header, ...(withGuide ? [styleText("gray", BAR)] : []), ...lines, ...error, footer, end].join("\n");
    },
  }).prompt() as Promise<CorePublicToolName[] | symbol>;
}

import { styleText } from "node:util";
import { MultiSelectPrompt, settings } from "@clack/core";
import type { CorePublicToolName } from "@queqiao/core-manifest";
import type { AccessToolOption } from "./access-configuration.js";
import { renderMultiChoiceLines } from "./tui-choice-renderer.js";

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
        const rendered = renderMultiChoiceLines(option, {
          selected: selected.includes(option.value),
          focused: index === this.cursor,
        });
        return rendered.map((line) => `${prefix}${line}`);
      });

      const error = this.state === "error" ? [`${prefix}${styleText("yellow", this.error)}`] : [];
      const footer = `${prefix}${styleText("dim", "↑/↓ to navigate • Space: select • Enter: confirm")}`;
      const end = withGuide ? styleText("cyan", END) : "";
      return [header, ...(withGuide ? [styleText("gray", BAR)] : []), ...lines, ...error, footer, end].join("\n");
    },
  }).prompt() as Promise<CorePublicToolName[] | symbol>;
}

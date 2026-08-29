import { styleText } from "node:util";
import { SelectPrompt, settings } from "@clack/core";
import { renderSingleChoiceLines } from "./tui-choice-renderer.js";

const ACTIVE = "◆";
const SUBMIT = "◇";
const BAR = "│";
const END = "└";

export type QueqiaoSelectOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type QueqiaoSelectFrame<T extends string = string> = {
  message: string;
  options: QueqiaoSelectOption<T>[];
  value?: T;
  cursor: number;
  state: string;
  error?: string;
  withGuide: boolean;
};

export function renderQueqiaoSelectFrame<T extends string>(frame: QueqiaoSelectFrame<T>): string {
  const prefix = frame.withGuide ? `${styleText("cyan", BAR)}  ` : "";
  const headerSymbol = frame.state === "submit" ? styleText("green", SUBMIT) : styleText("cyan", ACTIVE);
  const header = `${headerSymbol}  ${frame.message}`;

  if (frame.state === "submit") {
    const selected = frame.options.find((option) => option.value === frame.value);
    return `${header}\n${frame.withGuide ? styleText("gray", BAR) : ""}  ${styleText("dim", selected?.label ?? String(frame.value ?? ""))}`;
  }

  const lines = frame.options.flatMap((option, index) => renderSingleChoiceLines(option, {
    focused: index === frame.cursor,
  }).map((line) => `${prefix}${line}`));
  const error = frame.state === "error" && frame.error
    ? [`${prefix}${styleText("yellow", frame.error)}`]
    : [];
  const footer = `${prefix}${styleText("dim", "↑/↓ to navigate • Enter: confirm")}`;
  const end = frame.withGuide ? styleText("cyan", END) : "";
  return [header, ...(frame.withGuide ? [styleText("gray", BAR)] : []), ...lines, ...error, footer, end].join("\n");
}

export async function queqiaoSelect<T extends string>(options: {
  message: string;
  choices: QueqiaoSelectOption<T>[];
  initialValue?: T;
}): Promise<T | symbol> {
  return new SelectPrompt<QueqiaoSelectOption<T>>({
    options: options.choices,
    ...(options.initialValue ? { initialValue: options.initialValue } : {}),
    render() {
      return renderQueqiaoSelectFrame({
        message: options.message,
        options: this.options,
        ...(this.value === undefined ? {} : { value: this.value }),
        cursor: this.cursor,
        state: this.state,
        ...(this.state === "error" ? { error: this.error } : {}),
        withGuide: settings.withGuide,
      });
    },
  }).prompt() as Promise<T | symbol>;
}

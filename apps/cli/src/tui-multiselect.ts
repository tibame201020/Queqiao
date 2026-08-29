import { styleText } from "node:util";
import { MultiSelectPrompt, settings } from "@clack/core";
import { renderMultiChoiceLines } from "./tui-choice-renderer.js";

const ACTIVE = "◆";
const SUBMIT = "◇";
const BAR = "│";
const END = "└";

export type QueqiaoMultiSelectOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type QueqiaoMultiSelectFrame<T extends string = string> = {
  message: string;
  options: QueqiaoMultiSelectOption<T>[];
  selected: readonly T[];
  cursor: number;
  state: string;
  error?: string;
  withGuide: boolean;
  summary?: (selected: readonly T[]) => string;
};

export function renderQueqiaoMultiSelectFrame<T extends string>(frame: QueqiaoMultiSelectFrame<T>): string {
  const prefix = frame.withGuide ? `${styleText("cyan", BAR)}  ` : "";
  const headerSymbol = frame.state === "submit" ? styleText("green", SUBMIT) : styleText("cyan", ACTIVE);
  const header = `${headerSymbol}  ${frame.message}`;
  const summary = frame.summary ?? ((selected: readonly T[]) => `${selected.length} selected`);

  if (frame.state === "submit") {
    return `${header}\n${frame.withGuide ? styleText("gray", BAR) : ""}  ${styleText("dim", summary(frame.selected))}`;
  }

  const lines = frame.options.flatMap((option, index) => renderMultiChoiceLines(option, {
    selected: frame.selected.includes(option.value),
    focused: index === frame.cursor,
  }).map((line) => `${prefix}${line}`));
  const error = frame.state === "error" && frame.error
    ? [`${prefix}${styleText("yellow", frame.error)}`]
    : [];
  const footer = `${prefix}${styleText("dim", "↑/↓ to navigate • Space: select • Enter: confirm")}`;
  const end = frame.withGuide ? styleText("cyan", END) : "";
  return [header, ...(frame.withGuide ? [styleText("gray", BAR)] : []), ...lines, ...error, footer, end].join("\n");
}

export async function queqiaoMultiselect<T extends string>(options: {
  message: string;
  choices: QueqiaoMultiSelectOption<T>[];
  initialValues?: T[];
  required?: boolean;
  validate?: (value: T[] | undefined) => string | undefined;
  summary?: (selected: readonly T[]) => string;
}): Promise<T[] | symbol> {
  const validate = options.validate;
  return new MultiSelectPrompt<QueqiaoMultiSelectOption<T>>({
    options: options.choices,
    ...(options.initialValues ? { initialValues: options.initialValues } : {}),
    required: options.required ?? true,
    ...(validate ? { validate(value) { return validate(value); } } : {}),
    render() {
      return renderQueqiaoMultiSelectFrame({
        message: options.message,
        options: this.options,
        selected: this.value ?? [],
        cursor: this.cursor,
        state: this.state,
        ...(this.state === "error" ? { error: this.error } : {}),
        withGuide: settings.withGuide,
        ...(options.summary ? { summary: options.summary } : {}),
      });
    },
  }).prompt() as Promise<T[] | symbol>;
}

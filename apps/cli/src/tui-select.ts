import { SelectPrompt, settings } from "@clack/core";
import { renderSingleChoiceLines } from "./tui-choice-renderer.js";
import { createQueqiaoTheme, renderPromptSymbol, TUI_GLYPHS, TUI_HINTS } from "./tui-theme.js";

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
  const theme = createQueqiaoTheme();
  const prefix = frame.withGuide ? `${theme.subtle(TUI_GLYPHS.guide)}  ` : "";
  const submitted = frame.state === "submit";
  const header = `${renderPromptSymbol(frame.state, theme)}  ${theme.strong(frame.message)}`;

  if (submitted) {
    const selected = frame.options.find((option) => option.value === frame.value);
    const summary = selected?.label ?? String(frame.value ?? "");
    return `${header}\n${frame.withGuide ? theme.subtle(TUI_GLYPHS.guide) : ""}  ${theme.muted(summary)}`;
  }

  const lines = frame.options.flatMap((option, index) => renderSingleChoiceLines(option, {
    focused: index === frame.cursor,
    disabled: option.disabled === true,
  }, theme).map((line) => `${prefix}${line}`));
  const error = frame.state === "error" && frame.error
    ? [`${prefix}${theme.danger(`${TUI_GLYPHS.danger} ${frame.error}`)}`]
    : [];
  const footer = `${prefix}${theme.muted(TUI_HINTS.select)}`;
  const end = frame.withGuide ? theme.subtle(TUI_GLYPHS.guideEnd) : "";
  return [header, ...(frame.withGuide ? [theme.subtle(TUI_GLYPHS.guide)] : []), ...lines, ...error, footer, end].join("\n");
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

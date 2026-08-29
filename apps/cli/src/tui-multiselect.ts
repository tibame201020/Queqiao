import { MultiSelectPrompt, settings } from "@clack/core";
import { renderMultiChoiceLines } from "./tui-choice-renderer.js";
import { createQueqiaoTheme, renderPromptSymbol, TUI_GLYPHS, TUI_HINTS } from "./tui-theme.js";
import { resolveChoiceViewport } from "./tui-viewport.js";

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
  terminalRows?: number;
  terminalColumns?: number;
};

export function renderQueqiaoMultiSelectFrame<T extends string>(frame: QueqiaoMultiSelectFrame<T>): string {
  const theme = createQueqiaoTheme();
  const prefix = frame.withGuide ? `${theme.subtle(TUI_GLYPHS.guide)}  ` : "";
  const submitted = frame.state === "submit";
  const header = `${renderPromptSymbol(frame.state, theme)}  ${theme.strong(frame.message)}`;
  const summary = frame.summary ?? ((selected: readonly T[]) => `${selected.length} selected`);

  if (submitted) {
    return `${header}\n${frame.withGuide ? theme.subtle(TUI_GLYPHS.guide) : ""}  ${theme.muted(summary(frame.selected))}`;
  }

  const terminalColumns = Math.max(20, frame.terminalColumns ?? process.stdout.columns ?? 80);
  const contentWidth = Math.max(12, terminalColumns - (frame.withGuide ? 3 : 0));
  const renderedOptions = frame.options.map((option, index) => renderMultiChoiceLines(option, {
    selected: frame.selected.includes(option.value),
    focused: index === frame.cursor,
    disabled: option.disabled === true,
  }, theme, contentWidth).map((line) => `${prefix}${line}`));
  const error = frame.state === "error" && frame.error
    ? [`${prefix}${theme.danger(`${TUI_GLYPHS.danger} ${frame.error}`)}`]
    : [];
  const terminalRows = Math.max(6, frame.terminalRows ?? process.stdout.rows ?? 24);
  const chromeRows = 1 + (frame.withGuide ? 1 : 0) + error.length + 1 + (frame.withGuide ? 1 : 0);
  const viewport = resolveChoiceViewport(renderedOptions, frame.cursor, Math.max(1, terminalRows - chromeRows));
  const lines: string[] = [];
  if (viewport.hiddenBefore) lines.push(`${prefix}${theme.muted(`↑ ${viewport.hiddenBefore} more`)}`);
  for (let index = viewport.start; index <= viewport.end; index += 1) lines.push(...(renderedOptions[index] ?? []));
  if (viewport.hiddenAfter) lines.push(`${prefix}${theme.muted(`↓ ${viewport.hiddenAfter} more`)}`);
  const footer = `${prefix}${theme.muted(TUI_HINTS.multiselect)}`;
  const end = frame.withGuide ? theme.subtle(TUI_GLYPHS.guideEnd) : "";
  return [header, ...(frame.withGuide ? [theme.subtle(TUI_GLYPHS.guide)] : []), ...lines, ...error, footer, end].join("\n");
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
        ...(process.stdout.rows ? { terminalRows: process.stdout.rows } : {}),
        ...(process.stdout.columns ? { terminalColumns: process.stdout.columns } : {}),
      });
    },
  }).prompt() as Promise<T[] | symbol>;
}

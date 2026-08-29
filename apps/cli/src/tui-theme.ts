import { styleText } from "node:util";

export type QueqiaoTheme = {
  color: boolean;
  accent: (text: string) => string;
  success: (text: string) => string;
  warning: (text: string) => string;
  danger: (text: string) => string;
  strong: (text: string) => string;
  muted: (text: string) => string;
  subtle: (text: string) => string;
  accentStrong: (text: string) => string;
};

function paint(color: boolean, styles: string | string[], text: string): string {
  return color ? styleText(styles as Parameters<typeof styleText>[0], text) : text;
}

export function shouldUseCliColor(input: {
  isTTY?: boolean;
  noColor?: string;
  term?: string;
} = {}): boolean {
  const isTTY = input.isTTY ?? Boolean(process.stdout.isTTY);
  const noColor = input.noColor ?? process.env.NO_COLOR;
  const term = input.term ?? process.env.TERM;
  return isTTY && noColor === undefined && term !== "dumb";
}

export function createQueqiaoTheme(color = shouldUseCliColor()): QueqiaoTheme {
  return {
    color,
    accent: (text) => paint(color, "cyan", text),
    success: (text) => paint(color, "green", text),
    warning: (text) => paint(color, "yellow", text),
    danger: (text) => paint(color, "red", text),
    strong: (text) => paint(color, "bold", text),
    muted: (text) => paint(color, "dim", text),
    subtle: (text) => paint(color, "gray", text),
    accentStrong: (text) => paint(color, ["cyan", "bold"], text),
  };
}

export const TUI_GLYPHS = {
  promptActive: "◆",
  promptComplete: "◇",
  guide: "│",
  guideEnd: "└",
  focus: "›",
  selected: "■",
  unselected: "□",
  success: "✓",
  warning: "!",
  danger: "×",
  info: "•",
} as const;

export const TUI_HINTS = {
  select: "↑/↓ navigate · Enter confirm",
  multiselect: "↑/↓ navigate · Space toggle · Enter confirm",
} as const;

export function renderPromptSymbol(state: string, theme: QueqiaoTheme): string {
  if (state === "submit") return theme.success(TUI_GLYPHS.promptComplete);
  if (state === "cancel") return theme.muted(TUI_GLYPHS.promptComplete);
  if (state === "error") return theme.danger(TUI_GLYPHS.promptActive);
  return theme.accent(TUI_GLYPHS.promptActive);
}

export function styleCliHelpText(text: string, color = shouldUseCliColor()): string {
  const theme = createQueqiaoTheme(color);
  return text.split("\n").map((line) => {
    if (/^(Usage:|Commands:|Global options:|Diagnostics:|Advanced compatibility commands:)/.test(line)) {
      return theme.strong(line);
    }
    if (/^Run \"queqiao /.test(line)) return theme.muted(line);
    return line;
  }).join("\n");
}

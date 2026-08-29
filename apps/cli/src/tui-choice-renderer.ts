import { createQueqiaoTheme, TUI_GLYPHS, type QueqiaoTheme } from "./tui-theme.js";
import { wrapChoiceText } from "./tui-viewport.js";

export type MultiChoiceVisualState = {
  focused: boolean;
  selected: boolean;
  disabled?: boolean;
};

export type MultiChoiceContent = {
  label: string;
  description?: string;
};

export type SingleChoiceVisualState = {
  focused: boolean;
  disabled?: boolean;
};

export type MultiChoicePresentation = {
  focusMarker: typeof TUI_GLYPHS.focus | " ";
  selectionMarker: typeof TUI_GLYPHS.selected | typeof TUI_GLYPHS.unselected;
  descriptionMuted: boolean;
};

export function multiChoicePresentation(state: MultiChoiceVisualState): MultiChoicePresentation {
  return {
    focusMarker: state.focused ? TUI_GLYPHS.focus : " ",
    selectionMarker: state.selected ? TUI_GLYPHS.selected : TUI_GLYPHS.unselected,
    descriptionMuted: !state.focused && !state.selected,
  };
}

function descriptionLines(description: string | undefined, maxWidth?: number): string[] {
  if (!description) return [];
  const width = maxWidth === undefined ? undefined : Math.max(1, maxWidth - 4);
  return width === undefined ? description.split("\n") : wrapChoiceText(description, width);
}

export function renderSingleChoiceLines(
  option: MultiChoiceContent,
  state: SingleChoiceVisualState,
  theme: QueqiaoTheme = createQueqiaoTheme(),
  maxWidth?: number,
): string[] {
  const focus = state.focused ? theme.accent(TUI_GLYPHS.focus) : " ";
  const label = state.disabled
    ? theme.muted(option.label)
    : state.focused
      ? theme.accentStrong(option.label)
      : option.label;
  const secondary = descriptionLines(option.description, maxWidth)
    .map((line) => state.focused && !state.disabled ? line : theme.muted(line));

  return [
    `${focus} ${label}`,
    ...secondary.map((line) => `    ${line}`),
  ];
}

export function renderMultiChoiceLines(
  option: MultiChoiceContent,
  state: MultiChoiceVisualState,
  theme: QueqiaoTheme = createQueqiaoTheme(),
  maxWidth?: number,
): string[] {
  const presentation = multiChoicePresentation(state);
  const focus = state.focused ? theme.accent(presentation.focusMarker) : presentation.focusMarker;
  const selection = state.selected
    ? theme.success(presentation.selectionMarker)
    : state.disabled
      ? theme.muted(presentation.selectionMarker)
      : theme.subtle(presentation.selectionMarker);
  const label = state.disabled
    ? theme.muted(option.label)
    : state.focused
      ? theme.accentStrong(option.label)
      : state.selected
        ? theme.success(option.label)
        : option.label;
  const secondary = descriptionLines(option.description, maxWidth)
    .map((line) => presentation.descriptionMuted || state.disabled ? theme.muted(line) : line);

  return [
    `${focus} ${selection} ${label}`,
    ...secondary.map((line) => `    ${line}`),
  ];
}

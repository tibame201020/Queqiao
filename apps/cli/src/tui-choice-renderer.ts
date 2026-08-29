import { styleText } from "node:util";

export type MultiChoiceVisualState = {
  focused: boolean;
  selected: boolean;
};

export type MultiChoiceContent = {
  label: string;
  description?: string;
};

export type SingleChoiceVisualState = {
  focused: boolean;
};

export type MultiChoicePresentation = {
  focusMarker: ">" | " ";
  selectionMarker: "[x]" | "[ ]";
  descriptionMuted: boolean;
};

export function multiChoicePresentation(state: MultiChoiceVisualState): MultiChoicePresentation {
  return {
    focusMarker: state.focused ? ">" : " ",
    selectionMarker: state.selected ? "[x]" : "[ ]",
    descriptionMuted: !state.focused && !state.selected,
  };
}

export function renderSingleChoiceLines(
  option: MultiChoiceContent,
  state: SingleChoiceVisualState,
): string[] {
  const focus = state.focused ? styleText("cyan", ">") : " ";
  const label = state.focused ? styleText("cyan", option.label) : option.label;
  const descriptionLines = option.description
    ? option.description.split("\n").map((line) => state.focused ? line : styleText("dim", line))
    : [];

  return [
    `${focus} ${label}`,
    ...descriptionLines.map((line) => `    ${line}`),
  ];
}

export function renderMultiChoiceLines(
  option: MultiChoiceContent,
  state: MultiChoiceVisualState,
): string[] {
  const presentation = multiChoicePresentation(state);
  const focus = state.focused ? styleText("cyan", presentation.focusMarker) : presentation.focusMarker;
  const selection = state.selected ? styleText("green", presentation.selectionMarker) : presentation.selectionMarker;
  const label = state.focused ? styleText("cyan", option.label) : option.label;
  const descriptionLines = option.description
    ? option.description.split("\n").map((line) => presentation.descriptionMuted ? styleText("dim", line) : line)
    : [];

  return [
    `${focus} ${selection} ${label}`,
    ...descriptionLines.map((line) => `      ${line}`),
  ];
}

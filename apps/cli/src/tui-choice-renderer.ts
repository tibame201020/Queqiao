import { styleText } from "node:util";

export type MultiChoiceVisualState = {
  focused: boolean;
  selected: boolean;
};

export type MultiChoiceContent = {
  label: string;
  description?: string;
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

export function renderMultiChoiceLines(
  option: MultiChoiceContent,
  state: MultiChoiceVisualState,
): string[] {
  const presentation = multiChoicePresentation(state);
  const focus = state.focused ? styleText("cyan", presentation.focusMarker) : presentation.focusMarker;
  const selection = state.selected ? styleText("green", presentation.selectionMarker) : presentation.selectionMarker;
  const label = state.focused ? styleText("cyan", option.label) : option.label;
  const description = option.description || "";
  const renderedDescription = presentation.descriptionMuted
    ? styleText("dim", description)
    : description;

  return [
    `${focus} ${selection} ${label}`,
    `      ${renderedDescription}`,
  ];
}

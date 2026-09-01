export type WorkstationSemanticRole = "accent" | "modal" | "success" | "warning" | "danger" | "muted";

export type WorkstationPalette = Record<WorkstationSemanticRole, string>;

export type WorkstationColorChoice = {
  id: string;
  label: string;
  value: string;
};

export const workstationColorChoices = [
  { id: "cyan", label: "Cyan", value: "#67d5e8" },
  { id: "sky", label: "Sky", value: "#69c7ed" },
  { id: "blue", label: "Blue", value: "#6ea8fe" },
  { id: "indigo", label: "Indigo", value: "#8f9cf4" },
  { id: "violet", label: "Violet", value: "#c4a7e7" },
  { id: "lavender", label: "Lavender", value: "#d8b9ff" },
  { id: "magenta", label: "Magenta", value: "#e879f9" },
  { id: "rose", label: "Rose", value: "#f08ca8" },
  { id: "red", label: "Red", value: "#f05d78" },
  { id: "coral", label: "Coral", value: "#ff7f73" },
  { id: "orange", label: "Orange", value: "#e3a15f" },
  { id: "amber", label: "Amber", value: "#e3bd83" },
  { id: "yellow", label: "Yellow", value: "#e5c07b" },
  { id: "lime", label: "Lime", value: "#b8d96b" },
  { id: "green", label: "Green", value: "#7bd88f" },
  { id: "emerald", label: "Emerald", value: "#66c99a" },
  { id: "teal", label: "Teal", value: "#63c7bd" },
  { id: "mint", label: "Mint", value: "#8dddc2" },
  { id: "silver", label: "Silver", value: "#b8bcc6" },
  { id: "gray", label: "Gray", value: "#7c8492" },
  { id: "slate", label: "Slate", value: "#6f7785" },
  { id: "warm-gray", label: "Warm Gray", value: "#92877f" },
  { id: "sand", label: "Sand", value: "#c8ad7f" },
  { id: "white", label: "White", value: "#e7e9ee" },
] as const satisfies readonly WorkstationColorChoice[];

export const workstationSemanticRoles = [
  { id: "accent", label: "Select / Focus", description: "Focused pane, selected row, active input and primary interaction." },
  { id: "success", label: "Active / Success", description: "Running, reachable, healthy and successful operation state." },
  { id: "warning", label: "Warning", description: "Degraded state, caution and recoverable attention." },
  { id: "danger", label: "Danger / Error", description: "Destructive actions, failures and blocking errors." },
  { id: "modal", label: "Modal", description: "Transaction, details, help and settings modal chrome." },
  { id: "muted", label: "Muted", description: "Secondary metadata, disabled text and low-emphasis guidance." },
] as const satisfies readonly { id: WorkstationSemanticRole; label: string; description: string }[];

export const DEFAULT_WORKSTATION_PALETTE: WorkstationPalette = {
  accent: "#67d5e8",
  modal: "#c4a7e7",
  success: "#7bd88f",
  warning: "#e5c07b",
  danger: "#f05d78",
  muted: "#7c8492",
};

const legacyPalettePresets = {
  aurora: DEFAULT_WORKSTATION_PALETTE,
  amber: { accent: "#69c7ed", modal: "#e3bd83", success: "#7bd88f", warning: "#e5c07b", danger: "#f05d78", muted: "#7c8492" },
  rose: { accent: "#69c7ed", modal: "#c4a7e7", success: "#7bd88f", warning: "#e5c07b", danger: "#f05d78", muted: "#7c8492" },
  ice: { accent: "#67d5e8", modal: "#69c7ed", success: "#7bd88f", warning: "#e5c07b", danger: "#f05d78", muted: "#7c8492" },
} as const satisfies Record<string, WorkstationPalette>;

export type LegacyWorkstationPaletteId = keyof typeof legacyPalettePresets;

export function isWorkstationColorValue(value: unknown): value is string {
  return typeof value === "string" && workstationColorChoices.some((choice) => choice.value === value);
}

export function isLegacyWorkstationPaletteId(value: unknown): value is LegacyWorkstationPaletteId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(legacyPalettePresets, value);
}

export function resolveLegacyWorkstationPalette(id: LegacyWorkstationPaletteId): WorkstationPalette {
  return { ...legacyPalettePresets[id] };
}

export function resolveWorkstationPalette(colors?: Partial<WorkstationPalette>): WorkstationPalette {
  return { ...DEFAULT_WORKSTATION_PALETTE, ...colors };
}

export function workstationColorChoiceFor(value: string): WorkstationColorChoice {
  return workstationColorChoices.find((choice) => choice.value === value) ?? workstationColorChoices[0]!;
}

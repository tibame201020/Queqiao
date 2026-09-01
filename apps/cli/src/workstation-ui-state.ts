export type WorkstationDomain = "gateways" | "workers" | "workspaces" | "profiles" | "extensions" | "diagnostics";
export type WorkstationDomainGroup = "RUNTIME" | "AUTHORITY" | "CAPABILITIES" | "SYSTEM";
export type WorkstationLayout = "wide" | "standard" | "narrow" | "too-small";
export type WorkstationWindow = "control" | "inventory" | "inspector";

export type WorkstationDomainDescriptor = {
  id: WorkstationDomain;
  label: string;
  shortLabel: string;
  group: WorkstationDomainGroup;
};

export const workstationDomains = [
  { id: "gateways", label: "Gateways", shortLabel: "Gateway", group: "RUNTIME" },
  { id: "workers", label: "Workers", shortLabel: "Worker", group: "RUNTIME" },
  { id: "workspaces", label: "Workspaces", shortLabel: "Workspace", group: "AUTHORITY" },
  { id: "profiles", label: "Access Profiles", shortLabel: "Profile", group: "AUTHORITY" },
  { id: "extensions", label: "Extensions", shortLabel: "Extension", group: "CAPABILITIES" },
  { id: "diagnostics", label: "Diagnostics", shortLabel: "Health", group: "SYSTEM" },
] as const satisfies readonly WorkstationDomainDescriptor[];

export type WorkstationUiState = {
  layout: WorkstationLayout;
  domain: WorkstationDomain;
  focusedWindow: WorkstationWindow;
  selection: Record<WorkstationDomain, number>;
};

function clampSelection(index: number, size: number): number {
  if (size <= 0) return 0;
  return Math.min(Math.max(index, 0), size - 1);
}

export function resolveWorkstationLayout(width: number, height: number): WorkstationLayout {
  if (width < 60 || height < 18) return "too-small";
  if (width >= 120) return "wide";
  if (width >= 80) return "standard";
  return "narrow";
}

export function domainAt(index: number): WorkstationDomainDescriptor {
  const normalized = ((index % workstationDomains.length) + workstationDomains.length) % workstationDomains.length;
  return workstationDomains[normalized]!;
}

export function createWorkstationUiState(layout: WorkstationLayout): WorkstationUiState {
  return {
    layout,
    domain: "gateways",
    focusedWindow: layout === "wide" ? "control" : "inventory",
    selection: { gateways: 0, workers: 0, workspaces: 0, profiles: 0, extensions: 0, diagnostics: 0 },
  };
}

export function setDomain(state: WorkstationUiState, domain: WorkstationDomain): WorkstationUiState {
  return { ...state, domain };
}

export function moveDomain(state: WorkstationUiState, delta: number): WorkstationUiState {
  const index = workstationDomains.findIndex((entry) => entry.id === state.domain);
  return setDomain(state, domainAt(index + delta).id);
}

export function moveInventorySelection(state: WorkstationUiState, delta: number, size: number): WorkstationUiState {
  if (size <= 0) return { ...state, selection: { ...state.selection, [state.domain]: 0 } };
  const current = clampSelection(state.selection[state.domain], size);
  const next = ((current + delta) % size + size) % size;
  return { ...state, selection: { ...state.selection, [state.domain]: next } };
}

export function reconcileInventorySelection(state: WorkstationUiState, size: number): WorkstationUiState {
  const current = state.selection[state.domain];
  const next = clampSelection(current, size);
  return next === current ? state : { ...state, selection: { ...state.selection, [state.domain]: next } };
}

export function setFocusedWindow(state: WorkstationUiState, window: WorkstationWindow): WorkstationUiState {
  if (state.layout === "too-small") return state;
  if (state.layout !== "wide" && window === "control") return { ...state, focusedWindow: "inventory" };
  return { ...state, focusedWindow: window };
}

function visibleWindows(layout: WorkstationLayout): WorkstationWindow[] {
  if (layout === "wide") return ["control", "inventory", "inspector"];
  if (layout === "too-small") return [];
  return ["inventory", "inspector"];
}

export function moveFocusedWindowSpatial(state: WorkstationUiState, delta: 1 | -1): WorkstationUiState {
  const windows = visibleWindows(state.layout);
  if (!windows.length) return state;
  const current = Math.max(0, windows.indexOf(state.focusedWindow));
  const next = Math.min(Math.max(current + delta, 0), windows.length - 1);
  return next === current ? state : { ...state, focusedWindow: windows[next]! };
}

export function nextFocusedWindow(state: WorkstationUiState, delta: 1 | -1): WorkstationUiState {
  const windows = visibleWindows(state.layout);
  if (!windows.length) return state;
  const current = Math.max(0, windows.indexOf(state.focusedWindow));
  const next = ((current + delta) % windows.length + windows.length) % windows.length;
  return { ...state, focusedWindow: windows[next]! };
}

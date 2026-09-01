import { describe, expect, it } from "vitest";
import { createWorkstationUiState, domainAt, moveDomain, moveFocusedWindowSpatial, moveInventorySelection, resolveWorkstationLayout, setDomain, setFocusedWindow, type WorkstationDomain } from "./workstation-ui-state.js";

describe("Workstation v2 presentation state", () => {
  it.each([
    [140, 35, "wide"],
    [120, 30, "wide"],
    [119, 30, "standard"],
    [100, 28, "standard"],
    [80, 24, "standard"],
    [79, 24, "narrow"],
    [60, 18, "narrow"],
    [59, 24, "too-small"],
    [100, 17, "too-small"],
  ] as const)("resolves %sx%s as %s", (width, height, expected) => {
    expect(resolveWorkstationLayout(width, height)).toBe(expected);
  });

  it("groups domains by product ownership rather than a flat peer menu", () => {
    expect(domainAt(0)).toMatchObject({ id: "gateways", group: "RUNTIME" });
    expect(domainAt(1)).toMatchObject({ id: "workers", group: "RUNTIME" });
    expect(domainAt(2)).toMatchObject({ id: "workspaces", group: "AUTHORITY" });
    expect(domainAt(3)).toMatchObject({ id: "profiles", group: "AUTHORITY" });
    expect(domainAt(4)).toMatchObject({ id: "extensions", group: "CAPABILITIES" });
    expect(domainAt(5)).toMatchObject({ id: "diagnostics", group: "SYSTEM" });
  });

  it("preserves inventory selection independently for every domain", () => {
    let state = createWorkstationUiState("wide");
    state = moveInventorySelection(state, 2, 5);
    expect(state.selection.workers).toBe(0);
    expect(state.selection.gateways).toBe(2);

    state = setDomain(state, "workers");
    state = moveInventorySelection(state, 1, 3);
    expect(state.selection.workers).toBe(1);
    expect(state.selection.gateways).toBe(2);

    state = setDomain(state, "gateways");
    expect(state.selection.gateways).toBe(2);
  });

  it("adapts focus windows when layout collapses", () => {
    let state = createWorkstationUiState("wide");
    state = setFocusedWindow(state, "control");
    expect(state.focusedWindow).toBe("control");

    state = { ...state, layout: "standard" };
    state = setFocusedWindow(state, "control");
    expect(state.focusedWindow).toBe("inventory");

    state = { ...state, layout: "narrow" };
    state = setFocusedWindow(state, "inspector");
    expect(state.focusedWindow).toBe("inspector");
  });

  it("moves domain without destroying per-domain selection", () => {
    let state = createWorkstationUiState("wide");
    state = moveInventorySelection(state, 1, 4);
    state = moveDomain(state, 1);
    expect(state.domain).toBe("workers");
    state = moveInventorySelection(state, 2, 4);
    state = moveDomain(state, -1);
    expect(state.domain).toBe("gateways");
    expect(state.selection.gateways).toBe(1);
    expect(state.selection.workers).toBe(2);
  });

  it("moves focus spatially without wrapping at pane edges", () => {
    let wide = createWorkstationUiState("wide");
    expect(moveFocusedWindowSpatial(wide, -1).focusedWindow).toBe("control");
    wide = moveFocusedWindowSpatial(wide, 1);
    expect(wide.focusedWindow).toBe("inventory");
    wide = moveFocusedWindowSpatial(wide, 1);
    expect(wide.focusedWindow).toBe("inspector");
    expect(moveFocusedWindowSpatial(wide, 1).focusedWindow).toBe("inspector");
    expect(moveFocusedWindowSpatial(wide, -1).focusedWindow).toBe("inventory");

    let standard = createWorkstationUiState("standard");
    expect(moveFocusedWindowSpatial(standard, -1).focusedWindow).toBe("inventory");
    standard = moveFocusedWindowSpatial(standard, 1);
    expect(standard.focusedWindow).toBe("inspector");
    expect(moveFocusedWindowSpatial(standard, 1).focusedWindow).toBe("inspector");
    expect(moveFocusedWindowSpatial(standard, -1).focusedWindow).toBe("inventory");

    let narrow = createWorkstationUiState("narrow");
    narrow = moveFocusedWindowSpatial(narrow, 1);
    expect(narrow.focusedWindow).toBe("inspector");
    expect(moveFocusedWindowSpatial(narrow, -1).focusedWindow).toBe("inventory");
  });
});

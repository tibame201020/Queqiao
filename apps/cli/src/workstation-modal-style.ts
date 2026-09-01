import { resolveWorkstationPalette } from "./workstation-theme.js";

export const workstationModalChromeColor = resolveWorkstationPalette().modal;

export function workstationModalWidth(terminalWidth: number): number {
  if (terminalWidth >= 120) return Math.min(96, terminalWidth - 16);
  if (terminalWidth >= 80) return terminalWidth - 12;
  return terminalWidth - 4;
}

export function workstationModalMaxHeight(terminalHeight: number): number {
  return Math.max(8, terminalHeight - 8);
}

export function workstationFloatingModalGeometry(
  terminalWidth: number,
  terminalHeight: number,
  width: number,
  height: number,
  clearance = 1,
  placement: "upper" | "center" = "upper",
) {
  const verticalDivisor = placement === "center" ? 2 : 3;
  return {
    top: Math.max(0, Math.floor((terminalHeight - height) / verticalDivisor) - clearance),
    left: Math.max(0, Math.floor((terminalWidth - width) / 2) - clearance),
    outerWidth: width + clearance * 2,
    outerHeight: height + clearance * 2,
    clearance,
  };
}

export function workstationDetailModalHeight(terminalHeight: number): number {
  const available = workstationModalMaxHeight(terminalHeight);
  if (terminalHeight >= 34) return Math.min(22, available);
  if (terminalHeight >= 26) return Math.min(18, available);
  return Math.min(16, available);
}

export function workstationHelpModalHeight(terminalHeight: number): number {
  return Math.min(18, workstationModalMaxHeight(terminalHeight));
}

export function workstationSettingsModalHeight(terminalHeight: number): number {
  return Math.min(20, workstationModalMaxHeight(terminalHeight));
}

export function workstationActionModalHeight(terminalHeight: number, promptKind: string | undefined, phase: "running" | "result"): number {
  const available = workstationModalMaxHeight(terminalHeight);
  if (promptKind) {
    if (terminalHeight >= 34) return Math.min(22, available);
    if (terminalHeight >= 26) return Math.min(18, available);
    return Math.min(16, available);
  }
  if (phase === "result") return terminalHeight >= 34 ? Math.min(20, available) : Math.min(18, available);
  return Math.min(13, available);
}

import type { QueqiaoDoctorResult } from "./doctor.js";

export type WorkstationDiagnosticState = "healthy" | "warning" | "error" | "stopped";

export type WorkstationDiagnosticEntry = {
  key: string;
  label: string;
  state: WorkstationDiagnosticState;
  summary: string;
  detail?: string;
  remediation?: string;
};

export type WorkstationExtensionHealthViewModel = {
  state: WorkstationDiagnosticState;
  summary: string;
  extensionCount?: number;
  workerCount?: number;
  issues: string[];
};

export type WorkstationDiagnosticWarning = {
  key: string;
  source: string;
  summary: string;
  remediation?: string;
};

export type WorkstationDiagnosticsViewModel = {
  ok: boolean;
  core: WorkstationDiagnosticEntry[];
  routing: WorkstationDiagnosticEntry[];
  extensions: WorkstationExtensionHealthViewModel;
  warnings: WorkstationDiagnosticWarning[];
};

type DoctorRole = QueqiaoDoctorResult["gateways"][number];

type RuntimeHealthCandidate = {
  reachable?: boolean;
  healthy?: boolean;
  identityMatches?: boolean;
  status?: number;
  error?: string;
};

type RuntimeStatusCandidate = {
  active?: boolean;
  managed?: boolean;
  pid?: number;
  health?: RuntimeHealthCandidate;
};

function coreEntry(roleLabel: "Gateway" | "Worker", entry: DoctorRole): WorkstationDiagnosticEntry {
  const status = entry.status as RuntimeStatusCandidate | undefined;
  const health = status?.health;
  const label = `${roleLabel} ${entry.name}`;
  if (entry.error) {
    return {
      key: `${entry.role}:${entry.name}`,
      label,
      state: "error",
      summary: entry.error,
      remediation: `Repair ${roleLabel} configuration before using the runtime.`,
    };
  }
  if (!status?.active) {
    return {
      key: `${entry.role}:${entry.name}`,
      label,
      state: "stopped",
      summary: "stopped",
      remediation: `Start ${roleLabel} ${entry.name}.`,
    };
  }
  if (entry.ok && health?.healthy !== false) {
    return {
      key: `${entry.role}:${entry.name}`,
      label,
      state: "healthy",
      summary: health?.status ? `healthy · HTTP ${health.status}` : "healthy",
      ...(status.pid ? { detail: `PID ${status.pid}${status.managed ? " · managed" : " · unmanaged"}` } : {}),
    };
  }
  const reachable = health?.reachable !== false;
  return {
    key: `${entry.role}:${entry.name}`,
    label,
    state: reachable ? "warning" : "error",
    summary: reachable ? `degraded${health?.status ? ` · HTTP ${health.status}` : ""}` : "unreachable",
    ...(health?.error ? { detail: health.error } : {}),
    remediation: reachable
      ? `Inspect ${roleLabel} health and downstream routing.`
      : `Check ${roleLabel} runtime and local health endpoint.`,
  };
}

function routingEntries(result: QueqiaoDoctorResult): WorkstationDiagnosticEntry[] {
  return result.gateways.flatMap((gateway) => {
    const environments = gateway.routing?.environments ?? [];
    return environments.map((environment) => ({
      key: `route:${gateway.name}:${environment.environmentId}`,
      label: `${gateway.name} → ${environment.environmentId}`,
      state: environment.reachable ? "healthy" as const : "warning" as const,
      summary: environment.reachable ? "reachable" : "unreachable",
      ...(environment.lastSuccessAt ? { detail: `last success ${environment.lastSuccessAt}` } : environment.checkedAt ? { detail: `checked ${environment.checkedAt}` } : {}),
      ...(!environment.reachable ? { remediation: "Check the Worker runtime and Gateway membership transport." } : {}),
    }));
  });
}

function extensionView(value: unknown): WorkstationExtensionHealthViewModel {
  if (!value || typeof value !== "object") return { state: "error", summary: "Extension Hub diagnostics unavailable", issues: ["Extension Hub doctor returned an invalid result"] };
  const candidate = value as { ok?: unknown; extensionCount?: unknown; workerCount?: unknown; issues?: unknown; error?: unknown };
  const ok = candidate.ok === true;
  const issues = Array.isArray(candidate.issues) ? candidate.issues.filter((entry): entry is string => typeof entry === "string") : [];
  if (typeof candidate.error === "string" && candidate.error) issues.unshift(candidate.error);
  return {
    state: ok ? "healthy" : "warning",
    summary: ok ? "healthy" : issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"}` : "diagnostics failed",
    ...(Number.isInteger(candidate.extensionCount) ? { extensionCount: Number(candidate.extensionCount) } : {}),
    ...(Number.isInteger(candidate.workerCount) ? { workerCount: Number(candidate.workerCount) } : {}),
    issues,
  };
}

function warningFromEntry(entry: WorkstationDiagnosticEntry): WorkstationDiagnosticWarning | undefined {
  if (entry.state === "healthy") return undefined;
  return {
    key: entry.key,
    source: entry.label,
    summary: entry.summary,
    ...(entry.remediation ? { remediation: entry.remediation } : {}),
  };
}

export function createWorkstationDiagnosticsViewModel(result: QueqiaoDoctorResult): WorkstationDiagnosticsViewModel {
  const core = [
    ...result.gateways.map((entry) => coreEntry("Gateway", entry)),
    ...result.workers.map((entry) => coreEntry("Worker", entry)),
  ];
  const routing = routingEntries(result);
  const extensions = extensionView(result.extensions);
  const warnings = [
    ...core.map(warningFromEntry).filter((entry): entry is WorkstationDiagnosticWarning => Boolean(entry)),
    ...routing.map(warningFromEntry).filter((entry): entry is WorkstationDiagnosticWarning => Boolean(entry)),
    ...extensions.issues.map((issue, index) => ({
      key: `extension:${index}`,
      source: "Extension Hub",
      summary: issue,
      remediation: "Repair Extension Hub integrity before loading or attaching the affected extension.",
    })),
  ];
  if (extensions.state !== "healthy" && !extensions.issues.length) {
    warnings.push({ key: "extension:health", source: "Extension Hub", summary: extensions.summary, remediation: "Run Extension Hub diagnostics and repair the reported integrity failure." });
  }
  return {
    ok: result.ok && warnings.length === 0,
    core,
    routing,
    extensions,
    warnings,
  };
}

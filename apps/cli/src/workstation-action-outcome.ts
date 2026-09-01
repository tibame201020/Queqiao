export type WorkstationActionOutcomeStatus = "success" | "noop" | "warning" | "cancelled" | "error";
export type WorkstationActionOutcomeTone = "default" | "muted" | "success" | "warning" | "danger";

export type WorkstationActionOutcomeDetail = {
  label: string;
  value: string;
  tone?: WorkstationActionOutcomeTone;
};

export type WorkstationActionOutcome = {
  status: WorkstationActionOutcomeStatus;
  title: string;
  summary?: string;
  details?: WorkstationActionOutcomeDetail[];
  sideEffects?: WorkstationActionOutcomeDetail[];
  remediation?: string[];
};

/** Transitional renderer seam for older UI tests. Production Workstation actions return typed outcomes. */
export type WorkstationLegacyActionResult = { title: string; body: string };
export type WorkstationActionResult = WorkstationActionOutcome | WorkstationLegacyActionResult;

export function isWorkstationActionOutcome(value: WorkstationActionResult): value is WorkstationActionOutcome {
  return "status" in value;
}

export function normalizeWorkstationActionOutcome(value: WorkstationActionResult): WorkstationActionOutcome {
  if (isWorkstationActionOutcome(value)) return value;
  const body = value.body.trim();
  const humanSummary = body && !body.startsWith("{") && !body.startsWith("[") ? body : undefined;
  return { status: "success", title: value.title, ...(humanSummary ? { summary: humanSummary } : {}) };
}

export function actionOutcome(
  status: WorkstationActionOutcomeStatus,
  title: string,
  options: Omit<WorkstationActionOutcome, "status" | "title"> = {},
): WorkstationActionOutcome {
  return { status, title, ...options };
}

export function outcomeValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function outcomeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

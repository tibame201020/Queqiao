import { AuditLogStore, auditCategorySchema, auditOutcomeSchema, createAuditEvent, type AuditEventInput, type AuditQuery } from "@queqiao/audit";

export type AuditCliFilters = {
  limit?: string;
  category?: string;
  outcome?: string;
  action?: string;
};

export async function recordCliAudit(directory: string, input: Omit<AuditEventInput, "component">): Promise<boolean> {
  try {
    await new AuditLogStore(directory).append(createAuditEvent({ ...input, component: "cli" }));
    return true;
  } catch (error) {
    console.error("Audit append failed", error);
    return false;
  }
}

export async function listAuditEvents(directory: string, filters: AuditCliFilters = {}) {
  const limit = filters.limit === undefined ? 100 : Number(filters.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error("--limit must be an integer between 1 and 1000");
  const category = filters.category === undefined ? undefined : auditCategorySchema.parse(filters.category);
  const outcome = filters.outcome === undefined ? undefined : auditOutcomeSchema.parse(filters.outcome);
  const action = filters.action?.trim();
  if (filters.action !== undefined && !action) throw new Error("--action must not be empty");
  const query: AuditQuery = {
    limit,
    ...(category ? { category } : {}),
    ...(outcome ? { outcome } : {}),
    ...(action ? { action } : {}),
  };
  const result = await new AuditLogStore(directory).query(query);
  return { schemaVersion: "1.0" as const, events: result.events, issues: result.issues };
}

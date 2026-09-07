import { randomUUID } from "node:crypto";
import { appendFile, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { secureRuntimeDirectory, secureRuntimeFile } from "@queqiao/platform-paths";

export const AUDIT_SCHEMA_VERSION = 1 as const;
export const DEFAULT_AUDIT_MAX_FILE_BYTES = 1_048_576;
export const DEFAULT_AUDIT_MAX_FILES = 4;
export const DEFAULT_AUDIT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export const auditComponentSchema = z.enum(["gateway", "worker", "cli"]);
export const auditCategorySchema = z.enum(["auth", "enrollment", "worker_session", "workspace", "extension", "tool", "transport", "system"]);
export const auditOutcomeSchema = z.enum(["success", "denied", "failed", "cancelled"]);
const auditObjectSchema = z.record(z.string(), z.unknown());

export const auditEventSchema = z.object({
  schemaVersion: z.literal(AUDIT_SCHEMA_VERSION),
  id: z.uuid(),
  at: z.iso.datetime({ offset: true }),
  component: auditComponentSchema,
  category: auditCategorySchema,
  action: z.string().min(1).max(96).regex(/^[a-z0-9][a-z0-9._-]*$/),
  outcome: auditOutcomeSchema,
  subject: auditObjectSchema.optional(),
  detail: auditObjectSchema.optional(),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditSink = { append(event: AuditEvent): Promise<void> };
export type AuditEventInput = Omit<AuditEvent, "schemaVersion" | "id" | "at" | "subject" | "detail"> & {
  id?: string;
  at?: string;
  subject?: Record<string, unknown>;
  detail?: Record<string, unknown>;
};

const MAX_STRING_LENGTH = 2_048;
const MAX_DEPTH = 6;
const MAX_ARRAY_LENGTH = 50;
const MAX_OBJECT_KEYS = 100;
const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";
const SENSITIVE_KEY_MARKERS = [
  "approvalsecret", "secret", "token", "credential", "password", "authorization", "cookie",
  "privatekey", "clientsecret", "refreshtoken", "accesstoken", "joincode",
];
const SENSITIVE_QUERY_PARAMETERS = new Set(["code", "token", "access_token", "refresh_token", "client_secret", "approval_secret"]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return SENSITIVE_KEY_MARKERS.some((marker) => normalized.includes(marker));
}

function redactUrlSecrets(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    let changed = false;
    for (const key of [...url.searchParams.keys()]) {
      if (!SENSITIVE_QUERY_PARAMETERS.has(key.toLowerCase())) continue;
      url.searchParams.set(key, REDACTED);
      changed = true;
    }
    return changed ? url.href : value;
  } catch {
    return value;
  }
}

function redactCredentialShapes(value: string): string {
  if (/^qjq1:/i.test(value)) return REDACTED;
  if (/^bearer\s+\S+/i.test(value)) return REDACTED;
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return REDACTED;
  return redactUrlSecrets(value);
}

function boundedString(value: string): string {
  const redacted = redactCredentialShapes(value);
  return redacted.length <= MAX_STRING_LENGTH ? redacted : `${redacted.slice(0, MAX_STRING_LENGTH)}${TRUNCATED}`;
}

function sanitizeValue(value: unknown, depth: number, key?: string): unknown {
  if (key && sensitiveKey(key)) return REDACTED;
  if (depth > MAX_DEPTH) return TRUNCATED;
  if (typeof value === "string") return boundedString(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return boundedString(value.toString());
  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return boundedString(value.href);
  if (Array.isArray(value)) {
    const bounded = value.slice(0, MAX_ARRAY_LENGTH).map((entry) => sanitizeValue(entry, depth + 1));
    if (value.length > MAX_ARRAY_LENGTH) bounded.push(TRUNCATED);
    return bounded;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS);
    for (const [entryKey, entryValue] of entries) result[entryKey] = sanitizeValue(entryValue, depth + 1, entryKey);
    if (Object.keys(value as Record<string, unknown>).length > MAX_OBJECT_KEYS) result["__truncated__"] = TRUNCATED;
    return result;
  }
  if (typeof value === "undefined") return undefined;
  return boundedString(String(value));
}

function sanitizeObject(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return sanitizeValue(value, 0) as Record<string, unknown>;
}

export function createAuditEvent(input: AuditEventInput): AuditEvent {
  return auditEventSchema.parse({
    schemaVersion: AUDIT_SCHEMA_VERSION,
    id: input.id ?? randomUUID(),
    at: input.at ?? new Date().toISOString(),
    component: input.component,
    category: input.category,
    action: input.action,
    outcome: input.outcome,
    ...(input.subject ? { subject: sanitizeObject(input.subject) } : {}),
    ...(input.detail ? { detail: sanitizeObject(input.detail) } : {}),
  });
}

export type AuditQuery = {
  limit?: number;
  component?: AuditEvent["component"];
  category?: AuditEvent["category"];
  outcome?: AuditEvent["outcome"];
  action?: string;
  after?: string;
  before?: string;
};

export type AuditQueryIssue = { file: string; line: number; error: string };
export type AuditQueryResult = { events: readonly AuditEvent[]; issues: readonly AuditQueryIssue[] };

type AuditLogStoreOptions = {
  maxFileBytes?: number;
  maxFiles?: number;
  maxAgeMs?: number;
  now?: () => number;
};

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

async function exists(file: string): Promise<boolean> {
  try { await stat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export class AuditLogStore {
  readonly #directory: string;
  readonly #maxFileBytes: number;
  readonly #maxFiles: number;
  readonly #maxAgeMs: number;
  readonly #now: () => number;
  readonly #activeFile: string;

  constructor(directory: string, options: AuditLogStoreOptions = {}) {
    this.#directory = path.resolve(directory);
    this.#maxFileBytes = positiveInteger(options.maxFileBytes ?? DEFAULT_AUDIT_MAX_FILE_BYTES, "maxFileBytes");
    this.#maxFiles = positiveInteger(options.maxFiles ?? DEFAULT_AUDIT_MAX_FILES, "maxFiles");
    this.#maxAgeMs = positiveInteger(options.maxAgeMs ?? DEFAULT_AUDIT_MAX_AGE_MS, "maxAgeMs");
    this.#now = options.now ?? Date.now;
    this.#activeFile = path.join(this.#directory, "events.jsonl");
  }

  #rotatedFile(generation: number): string {
    return path.join(this.#directory, `events.${generation}.jsonl`);
  }

  async #pruneExpired(): Promise<void> {
    const cutoff = this.#now() - this.#maxAgeMs;
    const files = [this.#activeFile, ...Array.from({ length: this.#maxFiles }, (_, index) => this.#rotatedFile(index + 1))];
    for (const file of files) {
      try {
        const metadata = await stat(file);
        if (metadata.mtimeMs < cutoff) await rm(file, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  async #rotate(): Promise<void> {
    await rm(this.#rotatedFile(this.#maxFiles), { force: true });
    for (let generation = this.#maxFiles - 1; generation >= 1; generation -= 1) {
      const source = this.#rotatedFile(generation);
      if (await exists(source)) await rename(source, this.#rotatedFile(generation + 1));
    }
    if (await exists(this.#activeFile)) await rename(this.#activeFile, this.#rotatedFile(1));
  }

  async append(event: AuditEvent): Promise<void> {
    const validated = auditEventSchema.parse(event);
    const line = `${JSON.stringify(validated)}\n`;
    const lineBytes = Buffer.byteLength(line);
    if (lineBytes > this.#maxFileBytes) throw new Error("Audit event exceeds maxFileBytes");

    await secureRuntimeDirectory(this.#directory);
    await this.#pruneExpired();
    let currentSize = 0;
    try { currentSize = (await stat(this.#activeFile)).size; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (currentSize > 0 && currentSize + lineBytes > this.#maxFileBytes) await this.#rotate();

    const existed = await exists(this.#activeFile);
    await appendFile(this.#activeFile, line, { encoding: "utf8", mode: 0o600 });
    if (!existed) await secureRuntimeFile(this.#activeFile);
  }

  async query(query: AuditQuery = {}): Promise<AuditQueryResult> {
    const limit = Math.min(1_000, positiveInteger(query.limit ?? 100, "limit"));
    const after = query.after ? Date.parse(query.after) : undefined;
    const before = query.before ? Date.parse(query.before) : undefined;
    if (query.after && !Number.isFinite(after)) throw new Error("after must be an ISO date-time");
    if (query.before && !Number.isFinite(before)) throw new Error("before must be an ISO date-time");

    const events: AuditEvent[] = [];
    const issues: AuditQueryIssue[] = [];
    const files = [this.#activeFile, ...Array.from({ length: this.#maxFiles }, (_, index) => this.#rotatedFile(index + 1))];
    for (const file of files) {
      if (events.length >= limit) break;
      let text: string;
      try { text = await readFile(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      const lines = text.split(/\r?\n/);
      for (let index = lines.length - 1; index >= 0 && events.length < limit; index -= 1) {
        const line = lines[index];
        if (!line) continue;
        try {
          const parsed = auditEventSchema.parse(JSON.parse(line));
          const timestamp = Date.parse(parsed.at);
          if (query.component && parsed.component !== query.component) continue;
          if (query.category && parsed.category !== query.category) continue;
          if (query.outcome && parsed.outcome !== query.outcome) continue;
          if (query.action && parsed.action !== query.action) continue;
          if (after !== undefined && timestamp < after) continue;
          if (before !== undefined && timestamp > before) continue;
          events.push(parsed);
        } catch (error) {
          issues.push({ file: path.basename(file), line: index + 1, error: error instanceof Error ? error.message : "Invalid audit record" });
        }
      }
    }
    return Object.freeze({ events: Object.freeze(events), issues: Object.freeze(issues) });
  }
}




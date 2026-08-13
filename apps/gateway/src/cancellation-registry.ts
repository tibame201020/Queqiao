export type McpRequestId = string | number;

const DEFAULT_MAX_ENTRIES = 512;
const DEFAULT_MAX_ENTRIES_PER_PRINCIPAL = 64;
const DEFAULT_TTL_MS = 5 * 60_000;

type Entry = {
  readonly principalId: string;
  readonly requestId: McpRequestId;
  readonly controller: AbortController;
  readonly timeout: ReturnType<typeof setTimeout>;
};

export type CancellationLease = {
  readonly signal: AbortSignal;
  release(): void;
};

export class McpCancellationCapacityError extends Error {
  constructor() { super("MCP cancellation capacity reached"); }
}

function validRequestId(value: unknown): value is McpRequestId {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}

function keyOf(principalId: string, requestId: McpRequestId): string {
  return `${principalId}\u0000${typeof requestId}:${String(requestId)}`;
}

export class McpCancellationRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly countsByPrincipal = new Map<string, number>();

  constructor(
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
    private readonly maxEntriesPerPrincipal = DEFAULT_MAX_ENTRIES_PER_PRINCIPAL,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError("maxEntries must be a positive integer");
    if (!Number.isInteger(maxEntriesPerPrincipal) || maxEntriesPerPrincipal < 1) throw new RangeError("maxEntriesPerPrincipal must be a positive integer");
    if (!Number.isFinite(ttlMs) || ttlMs < 1) throw new RangeError("ttlMs must be positive and finite");
  }

  begin(principalId: string, requestId: McpRequestId): CancellationLease {
    if (!principalId) throw new Error("OAuth principal is required for MCP cancellation correlation");
    const key = keyOf(principalId, requestId);
    const existing = this.entries.get(key);
    if (existing) return { signal: existing.controller.signal, release: () => this.releaseEntry(key, existing) };

    const principalCount = this.countsByPrincipal.get(principalId) ?? 0;
    if (this.entries.size >= this.maxEntries || principalCount >= this.maxEntriesPerPrincipal) throw new McpCancellationCapacityError();

    const controller = new AbortController();
    const entry = {} as Entry;
    const timeout = setTimeout(() => {
      controller.abort(new Error("MCP cancellation correlation expired"));
      this.releaseEntry(key, entry);
    }, this.ttlMs);
    timeout.unref?.();
    Object.assign(entry, { principalId, requestId, controller, timeout });
    this.entries.set(key, entry);
    this.countsByPrincipal.set(principalId, principalCount + 1);
    return { signal: controller.signal, release: () => this.releaseEntry(key, entry) };
  }

  signalFor(principalId: string, requestId: McpRequestId): AbortSignal | undefined {
    return this.entries.get(keyOf(principalId, requestId))?.controller.signal;
  }

  cancel(principalId: string, requestId: McpRequestId, reason?: string): boolean {
    const entry = this.entries.get(keyOf(principalId, requestId));
    if (!entry) return false;
    if (!entry.controller.signal.aborted) entry.controller.abort(new Error(reason || "MCP request cancelled"));
    return true;
  }

  size(): number { return this.entries.size; }

  clear(): void {
    for (const [key, entry] of this.entries) this.releaseEntry(key, entry);
  }

  private releaseEntry(key: string, entry: Entry): void {
    if (this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    clearTimeout(entry.timeout);
    const next = (this.countsByPrincipal.get(entry.principalId) ?? 1) - 1;
    if (next <= 0) this.countsByPrincipal.delete(entry.principalId);
    else this.countsByPrincipal.set(entry.principalId, next);
  }
}

export function extractToolCallRequestIds(body: unknown): McpRequestId[] {
  const messages = Array.isArray(body) ? body : [body];
  const result: McpRequestId[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) continue;
    const candidate = message as Record<string, unknown>;
    const params = candidate.params;
    if (candidate.jsonrpc !== "2.0" || candidate.method !== "tools/call" || !validRequestId(candidate.id) || !params || typeof params !== "object" || Array.isArray(params)) continue;
    if (typeof (params as Record<string, unknown>).name !== "string") continue;
    result.push(candidate.id);
  }
  return result;
}

export function extractCancelledRequest(body: unknown): { requestId: McpRequestId; reason?: string } | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const message = body as Record<string, unknown>;
  if (message.jsonrpc !== "2.0" || message.method !== "notifications/cancelled" || message.id !== undefined) return undefined;
  const params = message.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const values = params as Record<string, unknown>;
  if (!validRequestId(values.requestId)) return undefined;
  if (values.reason !== undefined && typeof values.reason !== "string") return undefined;
  if (values._meta !== undefined && (!values._meta || typeof values._meta !== "object" || Array.isArray(values._meta))) return undefined;
  return { requestId: values.requestId, ...(typeof values.reason === "string" ? { reason: values.reason } : {}) };
}

export type BudgetDecision = { allowed: true; release(): void } | { allowed: false; reason: "rate" | "concurrency" };

export class ClientRequestBudget {
  private readonly windows = new Map<string, { startedAt: number; requests: number; active: number }>();
  constructor(private readonly requestLimit = 600, private readonly concurrencyLimit = 16, private readonly windowMs = 60_000) {}

  acquire(clientId: string, now = Date.now()): BudgetDecision {
    let window = this.windows.get(clientId);
    if (!window || now - window.startedAt >= this.windowMs) { window = { startedAt: now, requests: 0, active: 0 }; this.windows.set(clientId, window); }
    if (window.requests >= this.requestLimit) return { allowed: false, reason: "rate" };
    if (window.active >= this.concurrencyLimit) return { allowed: false, reason: "concurrency" };
    window.requests += 1; window.active += 1;
    let released = false;
    return { allowed: true, release: () => { if (!released) { released = true; window!.active = Math.max(0, window!.active - 1); } } };
  }
}

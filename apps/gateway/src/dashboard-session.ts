import { createHash, randomBytes } from "node:crypto";

const hash = (value: string) => createHash("sha256").update(value).digest("base64url");

export class DashboardSessionBroker {
  private readonly codes = new Map<string, number>();
  private readonly sessions = new Map<string, number>();

  constructor(
    private readonly codeTtlMs = 60_000,
    private readonly sessionTtlMs = 15 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  private prune(): void {
    const current = this.now();
    for (const [key, expiresAt] of this.codes) if (expiresAt <= current) this.codes.delete(key);
    for (const [key, expiresAt] of this.sessions) if (expiresAt <= current) this.sessions.delete(key);
  }

  createCode(): { code: string; expiresAt: string } {
    this.prune();
    const code = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + this.codeTtlMs;
    this.codes.set(hash(code), expiresAt);
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  exchange(code: string): { token: string; expiresAt: string } | null {
    this.prune();
    const key = hash(code);
    const expiresAt = this.codes.get(key);
    if (!expiresAt || expiresAt <= this.now()) return null;
    this.codes.delete(key);
    const token = randomBytes(32).toString("base64url");
    const sessionExpiresAt = this.now() + this.sessionTtlMs;
    this.sessions.set(hash(token), sessionExpiresAt);
    return { token, expiresAt: new Date(sessionExpiresAt).toISOString() };
  }

  authenticate(token: string): boolean {
    this.prune();
    if (!token) return false;
    const expiresAt = this.sessions.get(hash(token));
    return Boolean(expiresAt && expiresAt > this.now());
  }

  revoke(token: string): void {
    if (token) this.sessions.delete(hash(token));
  }
}

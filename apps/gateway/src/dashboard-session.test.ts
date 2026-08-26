import { describe, expect, it } from "vitest";
import { DashboardSessionBroker } from "./dashboard-session.js";

describe("DashboardSessionBroker", () => {
  it("exchanges each short-lived code once and expires the browser session", () => {
    let now = 1_000;
    const broker = new DashboardSessionBroker(1_000, 5_000, () => now);
    const created = broker.createCode();
    const session = broker.exchange(created.code);
    expect(session?.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(broker.exchange(created.code)).toBeNull();
    expect(broker.authenticate(session!.token)).toBe(true);
    now += 5_001;
    expect(broker.authenticate(session!.token)).toBe(false);
  });

  it("revokes an active session without exposing stored raw tokens", () => {
    const broker = new DashboardSessionBroker();
    const session = broker.exchange(broker.createCode().code)!;
    broker.revoke(session.token);
    expect(broker.authenticate(session.token)).toBe(false);
  });
});

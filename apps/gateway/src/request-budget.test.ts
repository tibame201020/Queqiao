import { describe, expect, it } from "vitest";
import { ClientRequestBudget } from "./request-budget.js";

describe("authenticated MCP client request budget", () => {
  it("enforces concurrency independently per client", () => {
    const budget = new ClientRequestBudget(10, 2, 1000);
    const first = budget.acquire("client-a", 0);
    const second = budget.acquire("client-a", 0);
    expect(first.allowed).toBe(true); expect(second.allowed).toBe(true);
    expect(budget.acquire("client-a", 0)).toEqual({ allowed: false, reason: "concurrency" });
    expect(budget.acquire("client-b", 0).allowed).toBe(true);
    if (first.allowed) first.release();
    expect(budget.acquire("client-a", 0).allowed).toBe(true);
  });

  it("enforces the rate window and resets after expiry", () => {
    const budget = new ClientRequestBudget(2, 2, 1000);
    const first = budget.acquire("client", 0); if (first.allowed) first.release();
    const second = budget.acquire("client", 0); if (second.allowed) second.release();
    expect(budget.acquire("client", 0)).toEqual({ allowed: false, reason: "rate" });
    expect(budget.acquire("client", 1000).allowed).toBe(true);
  });
});

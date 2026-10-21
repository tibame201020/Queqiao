import { describe, expect, it } from "vitest";
import { relativeResidentBudgetMiB } from "../../../scripts/resource-safety-budgets.mjs";

describe("Resource safety per supported Node major", () => {
  it("preserves the Node 22 96 MiB budget", () => {
    expect(relativeResidentBudgetMiB(22)).toBe(96);
  });
  it("calibrates Node 24 to a documented 100 MiB ceiling based on repeat release measurements", () => {
    expect(relativeResidentBudgetMiB(24)).toBe(100);
  });
  it("rejects unsupported major versions instead of silently relaxing bounds", () => {
    for (const major of [21, 25, Number.NaN]) expect(() => relativeResidentBudgetMiB(major)).toThrow();
  });
});

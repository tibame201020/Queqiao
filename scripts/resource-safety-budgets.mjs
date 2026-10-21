/**
 * Calibrated against identical packaged GitHub-hosted Ubuntu resource runs:
 * Node 22 retains the original 96 MiB ceiling; Node 24 samples measured
 * 97.53 and 97.29 MiB for Gateway overhead with the patched MCP SDK.
 * Node 24 receives a narrow 100 MiB ceiling. Absolute/core/residual limits
 * and all other safety budgets remain unchanged.
 */
export function relativeResidentBudgetMiB(nodeMajor) {
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22 || nodeMajor >= 25) {
    throw new Error("Unsupported Node major for Queqiao resource baseline");
  }
  return nodeMajor === 24 ? 100 : 96;
}

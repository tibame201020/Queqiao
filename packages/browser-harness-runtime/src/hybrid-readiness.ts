import type { SessionPageVerdict } from "./session-verdict.js";

export type HybridReadinessInput = {
  browser: SessionPageVerdict | "unreachable";
  managementStatus: number | null;
};

export type HybridReadinessReason =
  | "ready"
  | "browser_challenge"
  | "browser_logged_out"
  | "browser_pending"
  | "browser_unreachable"
  | "provider_missing"
  | "management_unauthorized"
  | "management_unreachable"
  | "management_unexpected";

export function classifyHybridReadiness(input: HybridReadinessInput): { ready: boolean; reason: HybridReadinessReason } {
  if (input.browser !== "authenticated") {
    const reasons: Record<Exclude<HybridReadinessInput["browser"], "authenticated">, HybridReadinessReason> = {
      browser_challenge: "browser_challenge",
      logged_out: "browser_logged_out",
      pending: "browser_pending",
      unreachable: "browser_unreachable",
    };
    return { ready: false, reason: reasons[input.browser] };
  }
  if (input.managementStatus === 200) return { ready: true, reason: "ready" };
  if (input.managementStatus === 404) return { ready: false, reason: "provider_missing" };
  if (input.managementStatus === 401 || input.managementStatus === 403) {
    return { ready: false, reason: "management_unauthorized" };
  }
  if (input.managementStatus === null) return { ready: false, reason: "management_unreachable" };
  return { ready: false, reason: "management_unexpected" };
}

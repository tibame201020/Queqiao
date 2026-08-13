import type { WorkspaceConfig } from "@queqiao/config";
import type { ApprovalMethod, ToolCapability } from "@queqiao/contracts";

export type AuthorizationRequest = {
  tool: string;
  workspace: WorkspaceConfig;
  requiredCapabilities?: readonly ToolCapability[];
  command?: string;
  hasMatchingApprovalGrant?: boolean;
};

export type AuthorizationDecision =
  | { allowed: true }
  | { allowed: false; reason: "step_up_required"; challenge: { methods: readonly ApprovalMethod[]; ttlSeconds: number; maxAttempts: number } }
  | { allowed: false; reason: "profile_denied" | "tool_not_allowed" | "tool_explicitly_denied" | "command_not_allowed" };

const legacyCapabilities = new Map<string, readonly ToolCapability[]>([
  ["write_file", ["workspace:write"]],
  ["edit_file", ["workspace:write"]],
  ["apply_patch", ["workspace:write"]],
  ["run", ["workspace:exec"]],
  ["shell", ["workspace:exec"]],
]);

function profileAllows(profile: WorkspaceConfig["profile"], capabilities: readonly ToolCapability[]): boolean {
  if (capabilities.includes("workspace:exec")) return profile === "coding";
  if (capabilities.includes("workspace:write")) return profile === "editor" || profile === "coding";
  return true;
}

export function authorize(request: AuthorizationRequest): AuthorizationDecision {
  const capabilities = request.requiredCapabilities ?? legacyCapabilities.get(request.tool) ?? ["workspace:read"];
  if (!profileAllows(request.workspace.profile, capabilities)) return { allowed: false, reason: "profile_denied" };
  if (request.workspace.tools.deny.some((tool) => tool === request.tool)) return { allowed: false, reason: "tool_explicitly_denied" };
  if (request.workspace.tools.allow.length > 0 && !request.workspace.tools.allow.some((tool) => tool === request.tool)) return { allowed: false, reason: "tool_not_allowed" };
  if (request.tool === "shell" && !request.workspace.tools.explicit.some((tool) => tool === "shell")) return { allowed: false, reason: "tool_not_allowed" };
  if (request.command && !request.workspace.commands.allow.some((allowed) => allowed.toLowerCase() === request.command!.toLowerCase())) return { allowed: false, reason: "command_not_allowed" };
  if (request.tool === "run" && !request.command) return { allowed: false, reason: "command_not_allowed" };
  const stepUpRule = request.workspace.stepUp.find((rule) => rule.tools.some((tool) => tool === request.tool));
  if (stepUpRule && !request.hasMatchingApprovalGrant) return { allowed: false, reason: "step_up_required", challenge: { methods: stepUpRule.methods, ttlSeconds: stepUpRule.ttlSeconds, maxAttempts: stepUpRule.maxAttempts } };
  return { allowed: true };
}

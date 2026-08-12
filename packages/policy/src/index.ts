import type { WorkspaceConfig } from "@queqiao/config";
import type {
  ApprovalMethod,
  PermissionProfile,
  PublicToolName,
} from "@queqiao/protocol";

export type AuthorizationRequest = {
  tool: PublicToolName;
  workspace: WorkspaceConfig;
  command?: string;
  hasMatchingApprovalGrant?: boolean;
};

export type AuthorizationDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "step_up_required";
      challenge: {
        methods: readonly ApprovalMethod[];
        ttlSeconds: number;
        maxAttempts: number;
      };
    }
  | {
      allowed: false;
      reason:
        | "profile_denied"
        | "tool_not_allowed"
        | "tool_explicitly_denied"
        | "command_not_allowed";
    };

const readTools = new Set<PublicToolName>([
  "list_environments",
  "list_workspaces",
  "open_workspace",
  "list_directory",
  "list_files",
  "read_file",
  "search_text",
]);

const writeTools = new Set<PublicToolName>(["write_file", "edit_file", "apply_patch"]);

function profileAllows(profile: PermissionProfile, tool: PublicToolName): boolean {
  if (readTools.has(tool)) return true;
  if (writeTools.has(tool)) return profile === "editor" || profile === "coding";
  return profile === "coding";
}

export function authorize(request: AuthorizationRequest): AuthorizationDecision {
  if (!profileAllows(request.workspace.profile, request.tool)) {
    return { allowed: false, reason: "profile_denied" };
  }

  if (request.workspace.tools.deny.includes(request.tool)) {
    return { allowed: false, reason: "tool_explicitly_denied" };
  }

  if (
    request.workspace.tools.allow.length > 0 &&
    !request.workspace.tools.allow.includes(request.tool)
  ) {
    return { allowed: false, reason: "tool_not_allowed" };
  }

  if (
    request.tool === "run" &&
    (!request.command || !request.workspace.commands.allow.includes(request.command))
  ) {
    return { allowed: false, reason: "command_not_allowed" };
  }

  const stepUpRule = request.workspace.stepUp.find((rule) => rule.tools.includes(request.tool));
  if (stepUpRule && !request.hasMatchingApprovalGrant) {
    return {
      allowed: false,
      reason: "step_up_required",
      challenge: {
        methods: stepUpRule.methods,
        ttlSeconds: stepUpRule.ttlSeconds,
        maxAttempts: stepUpRule.maxAttempts,
      },
    };
  }

  return { allowed: true };
}

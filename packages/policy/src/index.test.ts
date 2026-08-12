import { describe, expect, it } from "vitest";
import type { WorkspaceConfig } from "@queqiao/config";
import { authorize } from "./index.js";

const codingWorkspace: WorkspaceConfig = {
  id: "interview" as WorkspaceConfig["id"],
  displayName: "Interview",
  root: "C:\\Users\\hsu\\Downloads\\interview",
  profile: "coding",
  tools: { allow: [], deny: [] },
  commands: { allow: ["git"] },
  stepUp: [],
};

describe("authorize", () => {
  it("uses workspace profile rather than OAuth scopes for capabilities", () => {
    expect(authorize({ tool: "write_file", workspace: { ...codingWorkspace, profile: "read-only" } })).toEqual({
      allowed: false,
      reason: "profile_denied",
    });
  });

  it("applies explicit tool deny after the profile", () => {
    const workspace = {
      ...codingWorkspace,
      tools: { allow: [], deny: ["edit_file" as const] },
    };
    expect(authorize({ tool: "edit_file", workspace })).toEqual({
      allowed: false,
      reason: "tool_explicitly_denied",
    });
  });

  it("allows only configured executable names", () => {
    expect(authorize({ tool: "run", workspace: codingWorkspace, command: "git" })).toEqual({
      allowed: true,
    });
    expect(authorize({ tool: "run", workspace: codingWorkspace, command: "powershell" })).toEqual({
      allowed: false,
      reason: "command_not_allowed",
    });
  });

  it("requires configured step-up after ordinary authorization succeeds", () => {
    const workspace: WorkspaceConfig = {
      ...codingWorkspace,
      stepUp: [
        {
          tools: ["run"],
          methods: ["local", "one-time-code"],
          ttlSeconds: 45,
          maxAttempts: 3,
        },
      ],
    };

    expect(
      authorize({ tool: "run", workspace, command: "git" }),
    ).toEqual({
      allowed: false,
      reason: "step_up_required",
      challenge: {
        methods: ["local", "one-time-code"],
        ttlSeconds: 45,
        maxAttempts: 3,
      },
    });

    expect(
      authorize({
        tool: "run",
        workspace,
        command: "git",
        hasMatchingApprovalGrant: true,
      }),
    ).toEqual({ allowed: true });
  });

  it("does not use step-up to bypass a denied command", () => {
    expect(
      authorize({
        tool: "run",
        workspace: {
          ...codingWorkspace,
          stepUp: [
            {
              tools: ["run"],
              methods: ["local"],
              ttlSeconds: 60,
              maxAttempts: 3,
            },
          ],
        },
        command: "powershell",
        hasMatchingApprovalGrant: true,
      }),
    ).toEqual({ allowed: false, reason: "command_not_allowed" });
  });
});

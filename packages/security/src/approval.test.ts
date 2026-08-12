import { describe, expect, it } from "vitest";
import type { EnvironmentId, WorkspaceId } from "@queqiao/protocol";
import {
  grantMatchesAction,
  InvalidChallengeTransitionError,
  transitionChallenge,
  type ActionBinding,
  type ApprovalChallenge,
  type ApprovalGrant,
} from "./index.js";

const now = new Date("2026-08-12T01:00:00.000Z");
const binding: ActionBinding = {
  principalSubject: "owner",
  clientId: "chatgpt-client",
  environmentId: "wsl" as EnvironmentId,
  workspaceId: "backend" as WorkspaceId,
  tool: "run",
  requestDigest: "sha256:request-a",
};

function challenge(overrides: Partial<ApprovalChallenge> = {}): ApprovalChallenge {
  return {
    id: "challenge-1",
    binding,
    methods: ["local", "one-time-code"],
    status: "pending",
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    failedAttempts: 0,
    maxAttempts: 3,
    ...overrides,
  };
}

describe("approval challenge", () => {
  it("locks the challenge after the configured number of failures", () => {
    const first = transitionChallenge(challenge(), { type: "failed-attempt" }, now);
    const second = transitionChallenge(first, { type: "failed-attempt" }, now);
    const third = transitionChallenge(second, { type: "failed-attempt" }, now);

    expect(third).toMatchObject({ status: "denied", failedAttempts: 3 });
  });

  it("allows consumption only after approval", () => {
    expect(() => transitionChallenge(challenge(), { type: "consume" }, now)).toThrow(
      InvalidChallengeTransitionError,
    );

    const approved = transitionChallenge(challenge(), { type: "approve" }, now);
    expect(transitionChallenge(approved, { type: "consume" }, now).status).toBe("consumed");
  });

  it("rejects replay or a grant for different request parameters", () => {
    const grant: ApprovalGrant = {
      id: "grant-1",
      challengeId: "challenge-1",
      binding,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 30_000),
    };

    expect(grantMatchesAction(grant, binding, now)).toBe(true);
    expect(grantMatchesAction(grant, { ...binding, requestDigest: "sha256:request-b" }, now)).toBe(false);
    expect(grantMatchesAction({ ...grant, consumedAt: now }, binding, now)).toBe(false);
  });
});

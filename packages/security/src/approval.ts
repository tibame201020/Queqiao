import type {
  ApprovalMethod,
  EnvironmentId,
  PublicToolName,
  WorkspaceId,
} from "@queqiao/contracts";

export type { ApprovalMethod } from "@queqiao/contracts";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "consumed";

export type ActionBinding = {
  principalSubject: string;
  clientId: string;
  environmentId: EnvironmentId;
  workspaceId: WorkspaceId;
  tool: PublicToolName;
  requestDigest: string;
};

export type ApprovalChallenge = {
  id: string;
  binding: ActionBinding;
  methods: readonly ApprovalMethod[];
  status: ApprovalStatus;
  createdAt: Date;
  expiresAt: Date;
  failedAttempts: number;
  maxAttempts: number;
};

export type ApprovalGrant = {
  id: string;
  challengeId: string;
  binding: ActionBinding;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt?: Date;
};

export type ChallengeEvent =
  | { type: "approve" }
  | { type: "deny" }
  | { type: "failed-attempt" }
  | { type: "consume" }
  | { type: "expire" };

export class InvalidChallengeTransitionError extends Error {
  constructor(status: ApprovalStatus, event: ChallengeEvent["type"]) {
    super(`Cannot apply ${event} to an approval challenge in ${status} state`);
    this.name = "InvalidChallengeTransitionError";
  }
}

export function transitionChallenge(
  challenge: ApprovalChallenge,
  event: ChallengeEvent,
  now: Date,
): ApprovalChallenge {
  if (challenge.status === "consumed" || challenge.status === "denied" || challenge.status === "expired") {
    throw new InvalidChallengeTransitionError(challenge.status, event.type);
  }

  if (now >= challenge.expiresAt) {
    if (event.type === "expire") return { ...challenge, status: "expired" };
    throw new InvalidChallengeTransitionError("expired", event.type);
  }

  if (event.type === "expire") {
    throw new InvalidChallengeTransitionError(challenge.status, event.type);
  }

  if (event.type === "consume") {
    if (challenge.status !== "approved") {
      throw new InvalidChallengeTransitionError(challenge.status, event.type);
    }
    return { ...challenge, status: "consumed" };
  }

  if (challenge.status !== "pending") {
    throw new InvalidChallengeTransitionError(challenge.status, event.type);
  }

  if (event.type === "approve") return { ...challenge, status: "approved" };
  if (event.type === "deny") return { ...challenge, status: "denied" };

  const failedAttempts = challenge.failedAttempts + 1;
  return {
    ...challenge,
    failedAttempts,
    status: failedAttempts >= challenge.maxAttempts ? "denied" : "pending",
  };
}

export function grantMatchesAction(grant: ApprovalGrant, binding: ActionBinding, now: Date): boolean {
  if (grant.consumedAt || now >= grant.expiresAt) return false;

  return (
    grant.binding.principalSubject === binding.principalSubject &&
    grant.binding.clientId === binding.clientId &&
    grant.binding.environmentId === binding.environmentId &&
    grant.binding.workspaceId === binding.workspaceId &&
    grant.binding.tool === binding.tool &&
    grant.binding.requestDigest === binding.requestDigest
  );
}

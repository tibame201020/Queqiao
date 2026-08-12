import type { ApprovalChallenge, ApprovalGrant, ApprovalMethod, ActionBinding } from "./approval.js";

export type CreateChallengeRequest = {
  binding: ActionBinding;
  methods: readonly ApprovalMethod[];
  expiresAt: Date;
  maxAttempts: number;
};

export interface ApprovalChallengeRepository {
  create(request: CreateChallengeRequest): Promise<ApprovalChallenge>;
  findById(id: string): Promise<ApprovalChallenge | undefined>;
  save(challenge: ApprovalChallenge): Promise<void>;
}

export interface ApprovalGrantRepository {
  issue(challenge: ApprovalChallenge, expiresAt: Date): Promise<ApprovalGrant>;
  findUsable(binding: ActionBinding, now: Date): Promise<ApprovalGrant | undefined>;
  consume(id: string, consumedAt: Date): Promise<void>;
}

export interface LocalApprovalProvider {
  notify(challenge: ApprovalChallenge): Promise<void>;
}

export interface OneTimeCodeProvider {
  issue(challenge: ApprovalChallenge): Promise<{ displayCode: string }>;
  verify(challenge: ApprovalChallenge, submittedCode: string): Promise<boolean>;
}

export interface SecretStore {
  get(name: string): Promise<Uint8Array | undefined>;
  set(name: string, value: Uint8Array): Promise<void>;
  delete(name: string): Promise<void>;
}


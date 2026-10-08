import { randomUUID } from "node:crypto";
import { environmentIdSchema, workerIdSchema } from "@queqiao/contracts";
import {
  bindRuntimeWorker,
  createRuntimeLease,
  expireRuntimeLease,
  recordProviderRuntime,
  transitionRuntimeLease,
  type RuntimeDisposeRequest,
  type RuntimeLease,
  type RuntimeProvider,
  type RuntimeProviderMetadata,
  type RuntimeProvisionRequest,
  type RuntimeProvisionResult,
} from "@queqiao/runtime-control";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

const repoPartSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/);
const workflowIdSchema = z.string().min(1).max(255);
const refSchema = z.string().min(1).max(255);
const runIdSchema = z.number().int().positive();
const repositorySchema = z.string().min(3).max(201).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const oidcTokenSchema = z.string().min(32).max(16_384);
const timestampSchema = z.string().datetime({ offset: true });

export type GitHubWorkflowDispatchRequest = {
  owner: string;
  repo: string;
  workflowId: string;
  ref: string;
  inputs: Record<string, string>;
};

export type GitHubWorkflowDispatchResult = {
  runId: number;
  runUrl: string;
  htmlUrl: string;
};

export interface GitHubActionsApi {
  dispatch(request: GitHubWorkflowDispatchRequest): Promise<GitHubWorkflowDispatchResult>;
  cancel(request: { owner: string; repo: string; runId: number }): Promise<void>;
}

export type GitHubActionsOidcClaims = {
  repository: string;
  runId: number;
  workflowRef: string;
  ref: string;
  eventName: string;
  subject: string;
};

export interface GitHubActionsOidcVerifier {
  verify(token: string, audience: string): Promise<GitHubActionsOidcClaims>;
}

export type GitHubActionsExpectedRun = {
  leaseId: string;
  repository: string;
  workflowId: string;
  ref: string;
  runId: number;
  environmentId: string;
  expiresAtMs: number;
  claimedWorkerId?: string;
};

function normalizeWorkflowPath(workflowId: string): string {
  const value = workflowIdSchema.parse(workflowId);
  if (value.startsWith(".github/workflows/")) return value;
  if (value.includes("/")) throw new Error("GitHub Actions workflowId must be a workflow file name or .github/workflows path");
  return `.github/workflows/${value}`;
}

function refMatches(claimRef: string, configuredRef: string): boolean {
  return claimRef === configuredRef
    || claimRef === `refs/heads/${configuredRef}`
    || claimRef === `refs/tags/${configuredRef}`;
}

export class JoseGitHubActionsOidcVerifier implements GitHubActionsOidcVerifier {
  private readonly jwks = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));

  async verify(token: string, audience: string): Promise<GitHubActionsOidcClaims> {
    const verified = await jwtVerify(oidcTokenSchema.parse(token), this.jwks, {
      issuer: "https://token.actions.githubusercontent.com",
      audience,
    });
    const payload = verified.payload;
    return {
      repository: repositorySchema.parse(payload["repository"]),
      runId: runIdSchema.parse(Number(payload["run_id"])),
      workflowRef: z.string().min(1).max(1024).parse(payload["workflow_ref"]),
      ref: z.string().min(1).max(1024).parse(payload["ref"]),
      eventName: z.string().min(1).max(128).parse(payload["event_name"]),
      subject: z.string().min(1).max(2048).parse(payload.sub),
    };
  }
}

export class GitHubActionsRuntimeClaimRegistry {
  private readonly expected = new Map<string, GitHubActionsExpectedRun>();

  constructor(
    readonly audience: string,
    private readonly verifier: GitHubActionsOidcVerifier = new JoseGitHubActionsOidcVerifier(),
  ) {
    z.string().min(1).max(2048).parse(audience);
  }

  register(input: {
    leaseId: string;
    repository: string;
    workflowId: string;
    ref: string;
    runId: number;
    environmentId: string;
    issuedAtMs: number;
    ttlSeconds: number;
  }): GitHubActionsExpectedRun {
    const leaseId = z.string().uuid().parse(input.leaseId);
    const repository = repositorySchema.parse(input.repository);
    const workflowId = workflowIdSchema.parse(input.workflowId);
    const ref = refSchema.parse(input.ref);
    const runId = runIdSchema.parse(input.runId);
    const environmentId = environmentIdSchema.parse(input.environmentId);
    const ttlSeconds = z.number().int().min(10).max(604_800).parse(input.ttlSeconds);
    const issuedAtMs = z.number().int().nonnegative().parse(input.issuedAtMs);
    const next: GitHubActionsExpectedRun = {
      leaseId,
      repository,
      workflowId,
      ref,
      runId,
      environmentId,
      expiresAtMs: issuedAtMs + ttlSeconds * 1000,
    };

    const existing = this.expected.get(leaseId);
    if (existing) {
      const same = existing.repository === next.repository
        && existing.workflowId === next.workflowId
        && existing.ref === next.ref
        && existing.runId === next.runId
        && existing.environmentId === next.environmentId
        && existing.expiresAtMs === next.expiresAtMs;
      if (same) return existing;
      throw new Error("Runtime Lease already has a different GitHub Actions run correlation");
    }

    this.expected.set(leaseId, next);
    return next;
  }

  remove(leaseId: string): void {
    this.expected.delete(z.string().uuid().parse(leaseId));
  }

  get(leaseId: string): GitHubActionsExpectedRun | undefined {
    return this.expected.get(z.string().uuid().parse(leaseId));
  }

  async authorize(input: {
    leaseId: string;
    oidcToken: string;
    workerId: string;
    nowMs?: number;
  }): Promise<{ environmentId: string; expiresSeconds: number; runId: number }> {
    const leaseId = z.string().uuid().parse(input.leaseId);
    const workerId = workerIdSchema.parse(input.workerId);
    const expected = this.expected.get(leaseId);
    if (!expected) throw new Error("Runtime Lease has no pending GitHub Actions run");

    const nowMs = input.nowMs ?? Date.now();
    const remainingSeconds = Math.floor((expected.expiresAtMs - nowMs) / 1000);
    if (remainingSeconds < 30) throw new Error("Runtime Lease is expired or too close to expiry for enrollment");

    const claims = await this.verifier.verify(oidcTokenSchema.parse(input.oidcToken), this.audience);
    if (claims.repository !== expected.repository) throw new Error("GitHub OIDC repository claim does not match the Runtime Lease");
    if (claims.runId !== expected.runId) throw new Error("GitHub OIDC run_id claim does not match the Runtime Lease");
    if (claims.eventName !== "workflow_dispatch") throw new Error("GitHub OIDC event_name must be workflow_dispatch");
    if (!refMatches(claims.ref, expected.ref)) throw new Error("GitHub OIDC ref claim does not match the dispatched Runtime Lease ref");

    const workflowPath = normalizeWorkflowPath(expected.workflowId);
    const workflowPrefix = `${expected.repository}/${workflowPath}@`;
    if (!claims.workflowRef.startsWith(workflowPrefix)) {
      throw new Error("GitHub OIDC workflow_ref claim does not match the Runtime Lease workflow");
    }

    if (expected.claimedWorkerId && expected.claimedWorkerId !== workerId) {
      throw new Error("Runtime Lease GitHub Actions run is already claimed by another Worker");
    }
    expected.claimedWorkerId = workerId;

    return {
      environmentId: expected.environmentId,
      expiresSeconds: Math.min(300, remainingSeconds),
      runId: expected.runId,
    };
  }
}

export type GitHubActionsRuntimeProviderConfig = {
  owner: string;
  repo: string;
  workflowId: string;
  ref: string;
  gatewayUrl: string;
  api: GitHubActionsApi;
  claimRegistry?: GitHubActionsRuntimeClaimRegistry;
  clock?: () => number;
};

export function githubActionsRuntimeEnvironmentId(leaseId: string): string {
  const normalized = z.string().uuid().parse(leaseId).replaceAll("-", "");
  return environmentIdSchema.parse(`gha_${normalized.slice(0, 24)}`);
}

function parseProviderRunId(providerRef: string): number {
  const match = /^github-actions-run:(\d+)$/.exec(providerRef);
  if (!match) throw new Error("Invalid GitHub Actions provider reference");
  return runIdSchema.parse(Number(match[1]));
}

export class GitHubActionsRuntimeProvider implements RuntimeProvider {
  readonly id = "github-actions";
  private readonly owner: string;
  private readonly repo: string;
  private readonly workflowId: string;
  private readonly ref: string;
  private readonly gatewayUrl: string;
  private readonly api: GitHubActionsApi;
  private readonly claimRegistry: GitHubActionsRuntimeClaimRegistry | undefined;
  private readonly clock: () => number;

  constructor(config: GitHubActionsRuntimeProviderConfig) {
    this.owner = repoPartSchema.parse(config.owner);
    this.repo = repoPartSchema.parse(config.repo);
    this.workflowId = workflowIdSchema.parse(config.workflowId);
    this.ref = refSchema.parse(config.ref);
    this.gatewayUrl = new URL(config.gatewayUrl).href;
    this.api = config.api;
    this.claimRegistry = config.claimRegistry;
    this.clock = config.clock ?? Date.now;
  }

  async provision(request: RuntimeProvisionRequest): Promise<RuntimeProvisionResult> {
    const environmentId = githubActionsRuntimeEnvironmentId(request.leaseId);
    const result = await this.api.dispatch({
      owner: this.owner,
      repo: this.repo,
      workflowId: this.workflowId,
      ref: this.ref,
      inputs: {
        lease_id: request.leaseId,
        environment_id: environmentId,
        ttl_seconds: String(request.ttlSeconds),
        gateway_url: this.gatewayUrl,
      },
    });

    this.claimRegistry?.register({
      leaseId: request.leaseId,
      repository: `${this.owner}/${this.repo}`,
      workflowId: this.workflowId,
      ref: this.ref,
      runId: result.runId,
      environmentId,
      issuedAtMs: this.clock(),
      ttlSeconds: request.ttlSeconds,
    });

    return {
      providerRef: `github-actions-run:${runIdSchema.parse(result.runId)}`,
      metadata: {
        repository: `${this.owner}/${this.repo}`,
        workflow: this.workflowId,
        environmentId,
        runId: String(result.runId),
      },
    };
  }

  async dispose(request: RuntimeDisposeRequest): Promise<void> {
    await this.api.cancel({
      owner: this.owner,
      repo: this.repo,
      runId: parseProviderRunId(request.providerRef),
    });
    this.claimRegistry?.remove(request.leaseId);
  }
}

export type RuntimeWorkerObservation = {
  environmentId: string;
  workerId?: string;
  reachable: boolean;
};

function expectedEnvironmentId(lease: RuntimeLease): string {
  const fromProvider = lease.providerMetadata?.["environmentId"];
  if (fromProvider) return environmentIdSchema.parse(fromProvider);
  return githubActionsRuntimeEnvironmentId(lease.leaseId);
}

export class GitHubActionsRuntimeReconciler {
  reconcile(input: RuntimeLease, observation: RuntimeWorkerObservation, at: string): RuntimeLease {
    const expected = expectedEnvironmentId(input);
    if (observation.environmentId !== expected) {
      throw new Error(`Runtime Worker environment mismatch: expected ${expected}, got ${observation.environmentId}`);
    }

    let lease = input;
    if (observation.workerId && !lease.worker) {
      if (lease.state !== "provisioning") return lease;
      lease = bindRuntimeWorker(lease, {
        workerId: workerIdSchema.parse(observation.workerId),
        environmentId: environmentIdSchema.parse(observation.environmentId),
      }, at);
    }

    if (observation.reachable && lease.state === "registered") {
      lease = transitionRuntimeLease(lease, { type: "ready" }, at);
    }

    return lease;
  }
}

export class GitHubActionsRuntimeCoordinator {
  private readonly leases = new Map<string, RuntimeLease>();
  private readonly reconciler = new GitHubActionsRuntimeReconciler();

  constructor(
    readonly provider: GitHubActionsRuntimeProvider,
    readonly claims: GitHubActionsRuntimeClaimRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async provision(input: { ttlSeconds: number; metadata?: RuntimeProviderMetadata }): Promise<RuntimeLease> {
    const createdAt = this.now().toISOString();
    const leaseId = randomUUID();
    let lease = createRuntimeLease({
      leaseId,
      providerId: this.provider.id,
      ttlSeconds: input.ttlSeconds,
      now: createdAt,
      metadata: input.metadata ?? {},
    });
    lease = transitionRuntimeLease(lease, { type: "begin-provisioning" }, createdAt);
    try {
      lease = recordProviderRuntime(lease, await this.provider.provision({
        leaseId,
        ttlSeconds: input.ttlSeconds,
        metadata: input.metadata ?? {},
      }));
      this.leases.set(leaseId, lease);
      return lease;
    } catch (error) {
      lease = transitionRuntimeLease(lease, {
        type: "failed",
        detail: error instanceof Error ? error.message.slice(0, 512) : "Provider provisioning failed",
      }, this.now().toISOString());
      this.leases.set(leaseId, lease);
      throw error;
    }
  }

  get(leaseId: string): RuntimeLease | undefined {
    return this.leases.get(z.string().uuid().parse(leaseId));
  }

  list(): RuntimeLease[] {
    return [...this.leases.values()];
  }

  authorizeClaim(input: { leaseId: string; oidcToken: string; workerId: string }): Promise<{ environmentId: string; expiresSeconds: number; runId: number }> {
    return this.claims.authorize({ ...input, nowMs: this.now().getTime() });
  }

  workerJoined(input: { workerId: string; environmentId: string }, at = this.now().toISOString()): RuntimeLease | undefined {
    const environmentId = environmentIdSchema.parse(input.environmentId);
    const lease = [...this.leases.values()].find((candidate) => expectedEnvironmentId(candidate) === environmentId);
    if (!lease) return undefined;
    const reconciled = this.reconciler.reconcile(lease, {
      workerId: input.workerId,
      environmentId,
      reachable: true,
    }, at);
    this.leases.set(lease.leaseId, reconciled);
    return reconciled;
  }

  async complete(leaseId: string): Promise<RuntimeLease> {
    let lease = this.require(leaseId);
    const at = this.now().toISOString();
    if (lease.state === "ready") lease = transitionRuntimeLease(lease, { type: "running" }, at);
    if (lease.state === "running") lease = transitionRuntimeLease(lease, { type: "completed" }, at);
    if (lease.state !== "completed" && lease.state !== "disposed") {
      throw new Error(`Runtime Lease cannot complete from state ${lease.state}`);
    }
    if (lease.state === "disposed") return lease;
    await this.provider.dispose({
      leaseId: lease.leaseId,
      providerRef: this.providerRef(lease),
      reason: "completed",
    });
    lease = transitionRuntimeLease(lease, { type: "disposed" }, this.now().toISOString());
    this.leases.set(lease.leaseId, lease);
    return lease;
  }

  async fail(leaseId: string, detail = "Runtime disposed before completion"): Promise<RuntimeLease> {
    let lease = this.require(leaseId);
    if (lease.state === "disposed") return lease;
    if (!["completed", "failed", "expired"].includes(lease.state)) {
      lease = transitionRuntimeLease(lease, { type: "failed", detail }, this.now().toISOString());
    }
    if (lease.state === "completed") throw new Error("Completed Runtime Lease cannot be failed");
    const reason = lease.state === "expired" ? "expired" : "failed";
    await this.provider.dispose({
      leaseId: lease.leaseId,
      providerRef: this.providerRef(lease),
      reason,
    });
    lease = transitionRuntimeLease(lease, { type: "disposed" }, this.now().toISOString());
    this.leases.set(lease.leaseId, lease);
    return lease;
  }

  async expire(leaseId: string): Promise<RuntimeLease> {
    let lease = this.require(leaseId);
    lease = expireRuntimeLease(lease, this.now().toISOString());
    this.leases.set(lease.leaseId, lease);
    if (lease.state !== "expired") return lease;
    await this.provider.dispose({
      leaseId: lease.leaseId,
      providerRef: this.providerRef(lease),
      reason: "expired",
    });
    lease = transitionRuntimeLease(lease, { type: "disposed" }, this.now().toISOString());
    this.leases.set(lease.leaseId, lease);
    return lease;
  }

  async expireDue(): Promise<RuntimeLease[]> {
    const nowMs = this.now().getTime();
    const due = [...this.leases.values()].filter((lease) =>
      !["completed", "failed", "expired", "disposed"].includes(lease.state)
      && Date.parse(lease.expiresAt) <= nowMs);
    const disposed: RuntimeLease[] = [];
    for (const lease of due) disposed.push(await this.expire(lease.leaseId));
    return disposed;
  }

  private require(leaseId: string): RuntimeLease {
    const parsed = z.string().uuid().parse(leaseId);
    const lease = this.leases.get(parsed);
    if (!lease) throw new Error("Runtime Lease was not found");
    return lease;
  }

  private providerRef(lease: RuntimeLease): string {
    if (!lease.providerRef) throw new Error("Runtime Lease has no provider reference");
    return lease.providerRef;
  }
}

export type GitHubActionsFetchApiConfig = {
  token: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
};

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2026-03-10",
    "Content-Type": "application/json",
    "User-Agent": "queqiao-runtime-provider",
  };
}

export class GitHubActionsFetchApi implements GitHubActionsApi {
  private readonly token: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: GitHubActionsFetchApiConfig) {
    this.token = z.string().min(1).parse(config.token);
    this.apiBaseUrl = new URL(config.apiBaseUrl ?? "https://api.github.com/").href.replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async dispatch(request: GitHubWorkflowDispatchRequest): Promise<GitHubWorkflowDispatchResult> {
    const url = `${this.apiBaseUrl}/repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repo)}/actions/workflows/${encodeURIComponent(request.workflowId)}/dispatches`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: githubHeaders(this.token),
      body: JSON.stringify({
        ref: request.ref,
        inputs: request.inputs,
        return_run_details: true,
      }),
    });
    if (!response.ok) {
      throw new Error(`GitHub workflow dispatch failed with HTTP ${response.status}`);
    }
    const body = await response.json() as Record<string, unknown>;
    return {
      runId: runIdSchema.parse(body["workflow_run_id"]),
      runUrl: z.string().url().parse(body["run_url"]),
      htmlUrl: z.string().url().parse(body["html_url"]),
    };
  }

  async cancel(request: { owner: string; repo: string; runId: number }): Promise<void> {
    const url = `${this.apiBaseUrl}/repos/${encodeURIComponent(request.owner)}/${encodeURIComponent(request.repo)}/actions/runs/${runIdSchema.parse(request.runId)}/cancel`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: githubHeaders(this.token),
    });
    if (response.status === 409) return;
    if (!response.ok) throw new Error(`GitHub workflow cancel failed with HTTP ${response.status}`);
  }
}
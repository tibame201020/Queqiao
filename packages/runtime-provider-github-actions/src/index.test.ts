import { describe, expect, it, vi } from "vitest";
import {
  GitHubActionsFetchApi,
  GitHubActionsGhCliApi,
  GitHubActionsRuntimeClaimRegistry,
  GitHubActionsRuntimeCoordinator,
  GitHubActionsRuntimeProvider,
  GitHubActionsRuntimeReconciler,
  githubActionsRuntimeEnvironmentId,
  type GitHubActionsApi,
  type GitHubActionsOidcClaims,
  type GitHubActionsOidcVerifier,
  type RuntimeWorkerObservation,
} from "./index.js";
import {
  bindRuntimeWorker,
  createRuntimeLease,
  recordProviderRuntime,
  transitionRuntimeLease,
} from "@queqiao/runtime-control";

const now = "2026-10-08T01:00:00.000Z";
const nowMs = Date.parse(now);
const leaseId = "11111111-1111-4111-8111-111111111111";
const workerId = "22222222-2222-4222-8222-222222222222";

function lease() {
  return transitionRuntimeLease(createRuntimeLease({
    leaseId,
    providerId: "github-actions",
    ttlSeconds: 300,
    now,
    metadata: { runtimeKind: "ephemeral" },
  }), { type: "begin-provisioning" }, "2026-10-08T01:00:01.000Z");
}

function claims(overrides: Partial<GitHubActionsOidcClaims> = {}): GitHubActionsOidcClaims {
  return {
    repository: "example/runtime-host",
    runId: 12345,
    workflowRef: "example/runtime-host/.github/workflows/runtime.yml@refs/heads/main",
    ref: "refs/heads/main",
    eventName: "workflow_dispatch",
    subject: "repo:example/runtime-host:ref:refs/heads/main",
    ...overrides,
  };
}

function verifier(value = claims()): GitHubActionsOidcVerifier {
  return { verify: vi.fn(async () => value) };
}

describe("GitHub Actions Runtime Provider", () => {
  it("dispatches a workflow with only non-secret correlation inputs", async () => {
    const dispatch = vi.fn(async () => ({
      runId: 12345,
      runUrl: "https://api.github.test/runs/12345",
      htmlUrl: "https://github.test/runs/12345",
    }));
    const api: GitHubActionsApi = { dispatch, cancel: vi.fn(async () => undefined) };
    const provider = new GitHubActionsRuntimeProvider({
      owner: "example",
      repo: "runtime-host",
      workflowId: "runtime.yml",
      ref: "main",
      gatewayUrl: "https://gateway.example.test/",
      api,
    });

    const result = await provider.provision({
      leaseId,
      ttlSeconds: 300,
      metadata: { runtimeKind: "ephemeral" },
    });

    expect(dispatch).toHaveBeenCalledWith({
      owner: "example",
      repo: "runtime-host",
      workflowId: "runtime.yml",
      ref: "main",
      inputs: {
        lease_id: leaseId,
        environment_id: githubActionsRuntimeEnvironmentId(leaseId),
        ttl_seconds: "300",
        gateway_url: "https://gateway.example.test/",
      },
    });
    expect(JSON.stringify(dispatch.mock.calls[0])).not.toMatch(/token|secret|authorization/i);
    expect(result).toEqual({
      providerRef: "github-actions-run:12345",
      metadata: {
        repository: "example/runtime-host",
        workflow: "runtime.yml",
        environmentId: githubActionsRuntimeEnvironmentId(leaseId),
        runId: "12345",
      },
    });
  });

  it("propagates a validated trusted source SHA to the dispatched ephemeral Worker", async () => {
    const dispatch = vi.fn(async () => ({ runId: 12345, runUrl: "url", htmlUrl: "url" }));
    const provider = new GitHubActionsRuntimeProvider({
      owner: "example", repo: "runtime-host", workflowId: "runtime.yml", ref: "main",
      gatewayUrl: "https://gateway.example.test/", api: { dispatch, cancel: vi.fn() },
    });
    const sha = "a".repeat(40);
    await provider.provision({ leaseId, ttlSeconds: 180, metadata: { sourceRevision: sha } });
    expect(dispatch.mock.calls[0]?.[0].inputs).toMatchObject({ source_revision: sha });
    expect(JSON.stringify(dispatch.mock.calls[0])).not.toContain("authorization");
  });

  it("fails before dispatch for non-SHA source revisions", async () => {
    const dispatch = vi.fn();
    const provider = new GitHubActionsRuntimeProvider({
      owner: "example", repo: "runtime-host", workflowId: "runtime.yml", ref: "main",
      gatewayUrl: "https://gateway.example.test/", api: { dispatch, cancel: vi.fn() },
    });
    for (const bad of ["main", "../main", "b".repeat(39), "b".repeat(40) + "\n"]) {
      await expect(provider.provision({ leaseId, ttlSeconds: 180, metadata: { sourceRevision: bad } })).rejects.toThrow();
    }
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("registers the dispatched run for OIDC claim correlation", async () => {
    const registry = new GitHubActionsRuntimeClaimRegistry("urn:queqiao:runtime", verifier());
    const provider = new GitHubActionsRuntimeProvider({
      owner: "example",
      repo: "runtime-host",
      workflowId: "runtime.yml",
      ref: "main",
      gatewayUrl: "https://gateway.example.test/",
      api: {
        dispatch: vi.fn(async () => ({ runId: 12345, runUrl: "https://api.github.test/runs/12345", htmlUrl: "https://github.test/runs/12345" })),
        cancel: vi.fn(async () => undefined),
      },
      claimRegistry: registry,
      clock: () => nowMs,
    });

    await provider.provision({ leaseId, ttlSeconds: 300, metadata: {} });
    expect(registry.get(leaseId)).toMatchObject({
      leaseId,
      repository: "example/runtime-host",
      workflowId: "runtime.yml",
      ref: "main",
      runId: 12345,
      environmentId: githubActionsRuntimeEnvironmentId(leaseId),
      expiresAtMs: nowMs + 300_000,
    });
  });

  it("cancels the correlated workflow run during disposal", async () => {
    const cancel = vi.fn(async () => undefined);
    const api: GitHubActionsApi = {
      dispatch: vi.fn(async () => ({ runId: 44, runUrl: "u", htmlUrl: "h" })),
      cancel,
    };
    const provider = new GitHubActionsRuntimeProvider({
      owner: "example",
      repo: "runtime-host",
      workflowId: "runtime.yml",
      ref: "main",
      gatewayUrl: "https://gateway.example.test/",
      api,
    });

    await provider.dispose({
      leaseId,
      providerRef: "github-actions-run:44",
      reason: "expired",
    });
    expect(cancel).toHaveBeenCalledWith({ owner: "example", repo: "runtime-host", runId: 44 });
  });

  it("rejects a provider reference that is not a GitHub Actions run", async () => {
    const api: GitHubActionsApi = { dispatch: vi.fn(), cancel: vi.fn() };
    const provider = new GitHubActionsRuntimeProvider({
      owner: "example",
      repo: "runtime-host",
      workflowId: "runtime.yml",
      ref: "main",
      gatewayUrl: "https://gateway.example.test/",
      api,
    });
    await expect(provider.dispose({
      leaseId,
      providerRef: "workflow:44",
      reason: "failed",
    })).rejects.toThrow(/provider reference/i);
  });
});

describe("GitHub Actions OIDC run claims", () => {
  it("authorizes only the exact dispatched repository, run, workflow, ref, and one Worker", async () => {
    const verify = verifier();
    const registry = new GitHubActionsRuntimeClaimRegistry("urn:queqiao:runtime", verify);
    registry.register({
      leaseId,
      repository: "example/runtime-host",
      workflowId: "runtime.yml",
      ref: "main",
      runId: 12345,
      environmentId: githubActionsRuntimeEnvironmentId(leaseId),
      issuedAtMs: nowMs,
      ttlSeconds: 300,
    });

    await expect(registry.authorize({
      leaseId,
      oidcToken: "x".repeat(64),
      workerId,
      nowMs: nowMs + 1_000,
    })).resolves.toEqual({
      environmentId: githubActionsRuntimeEnvironmentId(leaseId),
      expiresSeconds: 299,
      runId: 12345,
    });

    expect(verify.verify).toHaveBeenCalledWith("x".repeat(64), "urn:queqiao:runtime");
    await expect(registry.authorize({
      leaseId,
      oidcToken: "x".repeat(64),
      workerId: "33333333-3333-4333-8333-333333333333",
      nowMs: nowMs + 2_000,
    })).rejects.toThrow(/another Worker/i);
  });

  it.each([
    ["repository", claims({ repository: "evil/runtime-host" })],
    ["run", claims({ runId: 99999 })],
    ["workflow", claims({ workflowRef: "example/runtime-host/.github/workflows/other.yml@refs/heads/main" })],
    ["ref", claims({ ref: "refs/heads/other" })],
    ["event", claims({ eventName: "push" })],
  ])("rejects a mismatched %s claim", async (_label, badClaims) => {
    const registry = new GitHubActionsRuntimeClaimRegistry("urn:queqiao:runtime", verifier(badClaims));
    registry.register({
      leaseId,
      repository: "example/runtime-host",
      workflowId: "runtime.yml",
      ref: "main",
      runId: 12345,
      environmentId: githubActionsRuntimeEnvironmentId(leaseId),
      issuedAtMs: nowMs,
      ttlSeconds: 300,
    });
    await expect(registry.authorize({
      leaseId,
      oidcToken: "x".repeat(64),
      workerId,
      nowMs: nowMs + 1_000,
    })).rejects.toThrow();
  });

  it("rejects enrollment when the lease has less than 30 seconds left", async () => {
    const registry = new GitHubActionsRuntimeClaimRegistry("urn:queqiao:runtime", verifier());
    registry.register({
      leaseId,
      repository: "example/runtime-host",
      workflowId: "runtime.yml",
      ref: "main",
      runId: 12345,
      environmentId: githubActionsRuntimeEnvironmentId(leaseId),
      issuedAtMs: nowMs,
      ttlSeconds: 60,
    });
    await expect(registry.authorize({
      leaseId,
      oidcToken: "x".repeat(64),
      workerId,
      nowMs: nowMs + 31_000,
    })).rejects.toThrow(/expiry/i);
  });
});

describe("GitHub Actions Runtime reconciliation", () => {
  it("binds the expected Worker and marks the lease ready only when reachable", () => {
    const initial = recordProviderRuntime(lease(), {
      providerRef: "github-actions-run:12345",
      metadata: {
        repository: "example/runtime-host",
        workflow: "runtime.yml",
        environmentId: githubActionsRuntimeEnvironmentId(leaseId),
        runId: "12345",
      },
    });
    const reconciler = new GitHubActionsRuntimeReconciler();
    const absent: RuntimeWorkerObservation = {
      environmentId: githubActionsRuntimeEnvironmentId(leaseId),
      reachable: false,
    };
    expect(reconciler.reconcile(initial, absent, "2026-10-08T01:00:02.000Z")).toEqual(initial);

    const registered = reconciler.reconcile(initial, {
      environmentId: githubActionsRuntimeEnvironmentId(leaseId),
      workerId,
      reachable: false,
    }, "2026-10-08T01:00:03.000Z");
    expect(registered.state).toBe("registered");

    const ready = reconciler.reconcile(registered, {
      environmentId: githubActionsRuntimeEnvironmentId(leaseId),
      workerId,
      reachable: true,
    }, "2026-10-08T01:00:04.000Z");
    expect(ready.state).toBe("ready");
  });

  it("rejects a Worker from another runtime environment", () => {
    const initial = lease();
    const reconciler = new GitHubActionsRuntimeReconciler();
    expect(() => reconciler.reconcile(initial, {
      environmentId: "gha_other",
      workerId,
      reachable: true,
    }, "2026-10-08T01:00:03.000Z")).toThrow(/environment/i);
  });

  it("keeps duplicate ready reconciliation idempotent", () => {
    let current = lease();
    current = bindRuntimeWorker(current, {
      workerId,
      environmentId: githubActionsRuntimeEnvironmentId(leaseId),
    }, "2026-10-08T01:00:02.000Z");
    current = transitionRuntimeLease(current, { type: "ready" }, "2026-10-08T01:00:03.000Z");

    const reconciler = new GitHubActionsRuntimeReconciler();
    expect(reconciler.reconcile(current, {
      environmentId: githubActionsRuntimeEnvironmentId(leaseId),
      workerId,
      reachable: true,
    }, "2026-10-08T01:00:04.000Z")).toEqual(current);
  });
});

describe("GitHub Actions Runtime Coordinator", () => {
  it("uses a trusted pre-reserved PostgreSQL task UUID as lease ID and denies local duplicate", async () => {
    const dispatch = vi.fn(async () => ({
      runId: 12345, runUrl: "https://api.github.test/runs/12345", htmlUrl: "https://github.test/runs/12345",
    }));
    const registry = new GitHubActionsRuntimeClaimRegistry("urn:queqiao:runtime", verifier());
    const provider = new GitHubActionsRuntimeProvider({
      owner: "example", repo: "runtime-host", workflowId: "runtime.yml", ref: "main",
      gatewayUrl: "https://gateway.example.test/",
      api: { dispatch, cancel: vi.fn(async () => undefined) },
      claimRegistry: registry,
    });
    const coordinator = new GitHubActionsRuntimeCoordinator(provider, registry);
    const chosen = "33333333-3333-4333-8333-333333333333";
    const result = await coordinator.provision({
      leaseId: chosen, ttlSeconds: 240, metadata: { sourceRevision: "a".repeat(40) },
    });
    expect(result.leaseId).toBe(chosen);
    expect(registry.get(chosen)).toMatchObject({ leaseId: chosen, runId: 12345 });
    expect(dispatch.mock.calls[0]?.[0].inputs).toMatchObject({
      lease_id: chosen, source_revision: "a".repeat(40),
    });
    await expect(coordinator.provision({ leaseId: chosen, ttlSeconds: 240 })).rejects.toThrow(/already present/i);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await expect(coordinator.provision({ leaseId: "not-a-uuid", ttlSeconds: 240 })).rejects.toThrow();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it("runs provision -> OIDC claim -> Worker ready -> completion -> disposal", async () => {
    let currentMs = nowMs;
    const cancel = vi.fn(async () => undefined);
    const registry = new GitHubActionsRuntimeClaimRegistry("urn:queqiao:runtime", verifier());
    const provider = new GitHubActionsRuntimeProvider({
      owner: "example",
      repo: "runtime-host",
      workflowId: "runtime.yml",
      ref: "main",
      gatewayUrl: "https://gateway.example.test/",
      api: {
        dispatch: vi.fn(async () => ({ runId: 12345, runUrl: "https://api.github.test/runs/12345", htmlUrl: "https://github.test/runs/12345" })),
        cancel,
      },
      claimRegistry: registry,
      clock: () => currentMs,
    });
    const coordinator = new GitHubActionsRuntimeCoordinator(provider, registry, () => new Date(currentMs));

    const provisioned = await coordinator.provision({ ttlSeconds: 300, metadata: { runtimeKind: "ephemeral" } });
    expect(provisioned.state).toBe("provisioning");
    const correlated = registry.get(provisioned.leaseId)!;

    await expect(coordinator.authorizeClaim({
      leaseId: provisioned.leaseId,
      oidcToken: "x".repeat(64),
      workerId,
    })).resolves.toMatchObject({
      environmentId: correlated.environmentId,
      runId: 12345,
    });

    currentMs += 2_000;
    const ready = coordinator.workerJoined({ workerId, environmentId: correlated.environmentId });
    expect(ready?.state).toBe("ready");

    currentMs += 1_000;
    const disposed = await coordinator.complete(provisioned.leaseId);
    expect(disposed).toMatchObject({
      state: "disposed",
      terminal: { outcome: "completed" },
    });
    expect(cancel).toHaveBeenCalledWith({ owner: "example", repo: "runtime-host", runId: 12345 });
    expect(registry.get(provisioned.leaseId)).toBeUndefined();
  });

  it("expires and disposes an unclaimed runtime after TTL", async () => {
    let currentMs = nowMs;
    const cancel = vi.fn(async () => undefined);
    const registry = new GitHubActionsRuntimeClaimRegistry("urn:queqiao:runtime", verifier());
    const provider = new GitHubActionsRuntimeProvider({
      owner: "example",
      repo: "runtime-host",
      workflowId: "runtime.yml",
      ref: "main",
      gatewayUrl: "https://gateway.example.test/",
      api: {
        dispatch: vi.fn(async () => ({ runId: 12345, runUrl: "https://api.github.test/runs/12345", htmlUrl: "https://github.test/runs/12345" })),
        cancel,
      },
      claimRegistry: registry,
      clock: () => currentMs,
    });
    const coordinator = new GitHubActionsRuntimeCoordinator(provider, registry, () => new Date(currentMs));
    const provisioned = await coordinator.provision({ ttlSeconds: 60 });

    currentMs += 61_000;
    const disposed = await coordinator.expire(provisioned.leaseId);
    expect(disposed).toMatchObject({
      state: "disposed",
      terminal: { outcome: "expired" },
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("GitHub Actions REST adapter", () => {
  it("uses the workflow_dispatch request shape without leaking the bearer token into the body", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ ref: "main", inputs: { lease_id: leaseId } });
      expect(JSON.stringify(body)).not.toContain("top-secret-token");
      return new Response(JSON.stringify({
        workflow_run_id: 77,
        run_url: "https://api.github.test/runs/77",
        html_url: "https://github.test/runs/77",
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const api = new GitHubActionsFetchApi({ token: "top-secret-token", apiBaseUrl: "https://api.github.test/", fetchImpl: fetchImpl as typeof fetch });
    await expect(api.dispatch({
      owner: "example",
      repo: "runtime-host",
      workflowId: "runtime.yml",
      ref: "main",
      inputs: { lease_id: leaseId },
    })).resolves.toMatchObject({ runId: 77 });
  });
});
describe("GitHub CLI cancellation with eventually consistent runs", () => {
  it("retries a transient early cancellation failure while the run is active", async () => {
    let attempts = 0;
    const wait = vi.fn(async () => undefined);
    const invoke = vi.fn(async (args: readonly string[]) => {
      if (args.some((a) => a.endsWith("/cancel"))) {
        attempts++;
        if (attempts === 1) throw new Error("unavailable while queued");
        return "";
      }
      return JSON.stringify({ status: "in_progress", conclusion: null });
    });
    const api = new GitHubActionsGhCliApi(invoke, wait);
    await api.cancel({ owner: "example", repo: "runtime", runId: 12345 });
    expect(attempts).toBe(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("treats a previously cancelled completed run as disposed without retrying", async () => {
    const wait = vi.fn(async () => undefined);
    const invoke = vi.fn(async (args: readonly string[]) => {
      if (args.some((a) => a.endsWith("/cancel"))) throw new Error("HTTP 409");
      return JSON.stringify({ id: 12345, status: "completed", conclusion: "cancelled" });
    });
    await new GitHubActionsGhCliApi(invoke, wait).cancel({ owner: "example", repo: "runtime", runId: 12345 });
    expect(wait).not.toHaveBeenCalled();
  });

  it("fails closed after bounded cancellation failures, without misreporting disposal", async () => {
    const wait = vi.fn(async () => undefined);
    const invoke = vi.fn(async (args: readonly string[]) => {
      if (args.some((a) => a.endsWith("/cancel"))) throw new Error("unavailable");
      return JSON.stringify({ status: "in_progress", conclusion: null });
    });
    await expect(new GitHubActionsGhCliApi(invoke, wait).cancel({
      owner: "example", repo: "runtime", runId: 12345,
    })).rejects.toThrow(/not verified/i);
    expect(wait).toHaveBeenCalledTimes(5);
  });
});
describe("GitHub Actions gh-cli adapter", () => {
  it("dispatches and cancels using bounded gh api arguments without token materialization", async () => {
    const invoke = vi.fn(async (args: readonly string[], input?: string) => {
      expect(args[0]).toBe("api");
      expect(args).not.toContain("--hostname");
      expect(args.join(" ")).not.toContain("Authorization");
      if (args.some((arg) => arg.endsWith("/dispatches"))) {
        expect(JSON.parse(input ?? "")).toEqual({ ref: "main", inputs: { lease_id: leaseId } });
        return JSON.stringify({ workflow_run_id: 77, run_url: "https://api.github.test/runs/77", html_url: "https://github.test/runs/77" });
      }
      expect(args.join(" ")).toContain("/actions/runs/77/cancel");
      return "";
    });
    const api = new GitHubActionsGhCliApi(invoke);
    await expect(api.dispatch({ owner: "example", repo: "runtime-host", workflowId: "runtime.yml", ref: "main", inputs: { lease_id: leaseId } })).resolves.toMatchObject({ runId: 77 });
    await api.cancel({ owner: "example", repo: "runtime-host", runId: 77 });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

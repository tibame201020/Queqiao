import {
  GitHubActionsFetchApi,
  GitHubActionsRuntimeClaimRegistry,
  GitHubActionsRuntimeCoordinator,
  GitHubActionsRuntimeProvider,
} from "@queqiao/runtime-provider-github-actions";
import type { GatewayRuntimeConfig } from "./config.js";

export function createConfiguredGitHubActionsRuntime(
  config: NonNullable<GatewayRuntimeConfig["githubActionsRuntime"]>,
  publicBaseUrl: URL,
): GitHubActionsRuntimeCoordinator {
  const claims = new GitHubActionsRuntimeClaimRegistry(config.audience);
  const api = new GitHubActionsFetchApi({ token: config.token });
  const provider = new GitHubActionsRuntimeProvider({
    owner: config.owner,
    repo: config.repo,
    workflowId: config.workflowId,
    ref: config.ref,
    gatewayUrl: publicBaseUrl.href,
    api,
    claimRegistry: claims,
  });
  return new GitHubActionsRuntimeCoordinator(provider, claims);
}

export function startGitHubActionsRuntimeExpiryMonitor(
  coordinator: GitHubActionsRuntimeCoordinator,
  intervalMs = 5_000,
): () => void {
  let active = false;
  const timer = setInterval(() => {
    if (active) return;
    active = true;
    void coordinator.expireDue()
      .catch((error) => console.error("GitHub Actions Runtime Lease expiry failed", error instanceof Error ? error.message : "unknown error"))
      .finally(() => { active = false; });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
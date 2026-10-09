import {
  GitHubActionsFetchApi,
  GitHubActionsGhCliApi,
  GitHubActionsRuntimeClaimRegistry,
  GitHubActionsRuntimeCoordinator,
  GitHubActionsRuntimeProvider,
} from "@queqiao/runtime-provider-github-actions";
import type { GatewayRuntimeConfig } from "./config.js";
import path from "node:path";
import { GitHubActionsRuntimeCheckpointStore } from "./github-actions-runtime-checkpoint.js";

export function createConfiguredGitHubActionsRuntime(
  config: NonNullable<GatewayRuntimeConfig["githubActionsRuntime"]>,
  publicBaseUrl: URL,
  stateDirectory?: string,
): GitHubActionsRuntimeCoordinator {
  const claims = new GitHubActionsRuntimeClaimRegistry(config.audience);
  const api = config.auth === "gh-cli" ? new GitHubActionsGhCliApi() : new GitHubActionsFetchApi({ token: config.token ?? "" });
  const provider = new GitHubActionsRuntimeProvider({
    owner: config.owner,
    repo: config.repo,
    workflowId: config.workflowId,
    ref: config.ref,
    gatewayUrl: publicBaseUrl.href,
    api,
    claimRegistry: claims,
  });
  return new GitHubActionsRuntimeCoordinator(provider, claims, undefined,
    stateDirectory && config.mcpPocEnabled ? new GitHubActionsRuntimeCheckpointStore(path.join(stateDirectory, "github-actions-runtime-checkpoint.json")) : undefined);
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
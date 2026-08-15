import type { RuntimeConfig } from "@queqiao/config";

export type GatewayDoctorResult = {
  ok: boolean;
  gateway: { reachable: boolean; status?: number; error?: string };
  environments: Array<{ environmentId: string; reachable: boolean; checkedAt?: string; lastSuccessAt?: string }>;
  workerDiagnostics: { supported: false; reason: string };
};

export async function doctorGateway(config: RuntimeConfig, fetchImpl: typeof fetch = fetch): Promise<GatewayDoctorResult> {
  const unsupported = { supported: false as const, reason: "No Worker-native doctor capability is advertised" };
  if (!config.gateway) return { ok: false, gateway: { reachable: false, error: "Gateway is not configured" }, environments: [], workerDiagnostics: unsupported };
  try {
    const response = await fetchImpl(`http://127.0.0.1:${config.gateway.listen.port}/health`, { signal: AbortSignal.timeout(3000) });
    const health = await response.json() as { ok?: boolean; environments?: Array<{ environmentId: string; reachable: boolean; checkedAt?: string; lastSuccessAt?: string }> };
    const environments = Array.isArray(health.environments) ? health.environments : [];
    return { ok: response.ok && health.ok === true, gateway: { reachable: response.ok, status: response.status }, environments, workerDiagnostics: unsupported };
  } catch (error) {
    return { ok: false, gateway: { reachable: false, error: error instanceof Error ? error.message : "Unknown error" }, environments: [], workerDiagnostics: unsupported };
  }
}

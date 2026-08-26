export type GatewayDoctorResult = {
  ok: boolean;
  gateway: { reachable: boolean; status?: number; error?: string };
  environments: Array<{ environmentId: string; reachable: boolean; checkedAt?: string; lastSuccessAt?: string }>;
  workerDiagnostics: { supported: false; reason: string };
};

export type GatewayDoctorConfig =
  | { gateway?: { listen: { port: number } } | undefined }
  | { port: number };

function gatewayPort(config: GatewayDoctorConfig): number | undefined {
  return "port" in config ? config.port : config.gateway?.listen.port;
}

export async function doctorGateway(config: GatewayDoctorConfig, fetchImpl: typeof fetch = fetch): Promise<GatewayDoctorResult> {
  const unsupported = { supported: false as const, reason: "No Worker-native doctor capability is advertised" };
  const port = gatewayPort(config);
  if (!port) return { ok: false, gateway: { reachable: false, error: "Gateway is not configured" }, environments: [], workerDiagnostics: unsupported };
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    const health = await response.json() as { ok?: boolean; environments?: Array<{ environmentId: string; reachable: boolean; checkedAt?: string; lastSuccessAt?: string }> };
    const environments = Array.isArray(health.environments) ? health.environments : [];
    return { ok: response.ok && health.ok === true, gateway: { reachable: response.ok, status: response.status }, environments, workerDiagnostics: unsupported };
  } catch (error) {
    return { ok: false, gateway: { reachable: false, error: error instanceof Error ? error.message : "Unknown error" }, environments: [], workerDiagnostics: unsupported };
  }
}

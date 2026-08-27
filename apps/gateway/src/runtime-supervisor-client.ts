import { readFile } from "node:fs/promises";
import { QUEQIAO_RUNTIME_SUPERVISOR_SECRET_HEADER, type RuntimeLifecyclePublicProjection, type RuntimeLifecycleRole } from "@queqiao/operations";

export class RuntimeSupervisorClient {
  constructor(private readonly options: { port: number; secretFile: string; fetchImpl?: typeof fetch }) {}

  async status(role: RuntimeLifecycleRole, name: string): Promise<RuntimeLifecyclePublicProjection> {
    const secret = (await readFile(this.options.secretFile, "utf8")).trim();
    if (Buffer.byteLength(secret) < 32) throw new Error("Runtime supervisor secret is unavailable");
    const response = await (this.options.fetchImpl ?? fetch)(`http://127.0.0.1:${this.options.port}/v1/runtime-lifecycle/${encodeURIComponent(role)}/${encodeURIComponent(name)}`, {
      headers: { [QUEQIAO_RUNTIME_SUPERVISOR_SECRET_HEADER]: secret },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`Runtime supervisor returned HTTP ${response.status}`);
    const value = await response.json() as RuntimeLifecyclePublicProjection;
    if (value.apiVersion !== 1 || value.role !== role || value.name !== name || !value.readiness || !value.health || !value.ownership || !value.actions) throw new Error("Runtime supervisor returned an invalid lifecycle projection");
    return value;
  }
}

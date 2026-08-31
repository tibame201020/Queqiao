import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerProtocolService } from "./worker-protocol-service.js";

let temporary: string | undefined;
afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});

describe("transport-neutral Worker Protocol service", () => {
  it("serves protocol operations without depending on HTTP", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-worker-protocol-"));
    await writeFile(path.join(temporary, "fixture.txt"), "hello\n", "utf8");
    const workerId = "11111111-1111-4111-8111-111111111111";
    const service = await createWorkerProtocolService({
      workerId,
      environmentId: "linux",
      workspaces: [{ id: "one", displayName: "One", root: temporary }],
    });

    await expect(service.execute({ operation: "health" })).resolves.toEqual({ ok: true, service: "queqiao-worker", environmentId: "linux" });
    await expect(service.execute({ operation: "hello" })).resolves.toMatchObject({ protocolVersion: "3.0", workerId, environmentId: "linux", capabilities: [] });
    await expect(service.execute({ operation: "list-workspaces" })).resolves.toMatchObject({
      environmentId: "linux",
      workspaces: [{ workspaceId: "one", displayName: "One", root: temporary }],
    });
    await expect(service.execute({ operation: "workspace-info", workspaceId: "one", tool: "open_workspace" })).resolves.toMatchObject({ workspaceId: "one", root: temporary });
    await expect(service.execute({
      operation: "invoke-tool",
      toolName: "read_file",
      input: { workspaceId: "one", path: "fixture.txt", offset: 0, limit: 10 },
    })).resolves.toMatchObject({ result: { text: "hello\n" } });
  });

  it("keeps Workspace policy authoritative outside the HTTP adapter", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-worker-policy-"));
    await writeFile(path.join(temporary, "fixture.txt"), "secret\n", "utf8");
    const service = await createWorkerProtocolService({
      environmentId: "linux",
      workspaces: [{
        id: "denied",
        displayName: "Denied",
        root: temporary,
        profile: "read-only",
        tools: { allow: [], deny: ["read_file"], explicit: [] },
        commands: { allow: [] },
      }],
    });

    await expect(service.execute({
      operation: "invoke-tool",
      toolName: "read_file",
      input: { workspaceId: "denied", path: "fixture.txt", offset: 0, limit: 10 },
    })).rejects.toMatchObject({ status: 403, code: "tool_denied" });
  });
});

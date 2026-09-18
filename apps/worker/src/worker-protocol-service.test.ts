import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessRunner } from "@queqiao/process-runtime";
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
    await expect(service.execute({ operation: "hello" })).resolves.toMatchObject({ protocolVersion: "3.0", workerId, environmentId: "linux", capabilities: ["process-control-v1"] });
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

  it("audits successful and denied tool outcomes without persisting tool input", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-worker-audit-"));
    await writeFile(path.join(temporary, "fixture.txt"), "secret-value\n", "utf8");
    const events: unknown[] = [];
    const service = await createWorkerProtocolService({
      environmentId: "linux",
      workspaces: [{
        id: "one",
        displayName: "One",
        root: temporary,
        profile: "read-only",
        tools: { allow: [], deny: ["write_file"], explicit: [] },
        commands: { allow: [] },
      }],
      audit: { append: async (event) => { events.push(event); } },
    });

    await service.execute({ operation: "invoke-tool", toolName: "read_file", input: { workspaceId: "one", path: "fixture.txt", offset: 0, limit: 10 } });
    await expect(service.execute({ operation: "invoke-tool", toolName: "write_file", input: { workspaceId: "one", path: "fixture.txt", content: "must-not-be-audited" } })).rejects.toMatchObject({ code: "tool_denied" });

    expect(events).toMatchObject([
      { component: "worker", category: "tool", action: "tool.execute", outcome: "success", subject: { workspaceId: "one", tool: "read_file" } },
      { component: "worker", category: "tool", action: "tool.execute", outcome: "denied", subject: { workspaceId: "one", tool: "write_file" }, detail: { errorCode: "tool_denied" } },
    ]);
    expect(JSON.stringify(events)).not.toContain("must-not-be-audited");
    expect(JSON.stringify(events)).not.toContain("secret-value");
  });

it("audits Extension call identity without persisting capability arguments", async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-extension-call-audit-"));
  const events: unknown[] = [];
  const service = await createWorkerProtocolService({
    environmentId: "linux",
    workspaces: [{
      id: "one",
      displayName: "One",
      root: temporary,
      profile: "coding",
      tools: { allow: ["extension"], deny: [], explicit: [] },
      commands: { allow: [] },
    }],
    audit: { append: async (event) => { events.push(event); } },
  });

  await expect(service.execute({
    operation: "invoke-tool",
    toolName: "extension",
    input: {
      workspaceId: "one",
      operation: "call",
      extensionId: "dev.example.audit",
      capability: "do_work",
      arguments: { secretPayload: "must-not-be-audited" },
    },
  })).rejects.toBeTruthy();

  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({
      component: "worker",
      category: "extension",
      action: "extension.call",
      outcome: "failed",
      subject: { workspaceId: "one", extensionId: "dev.example.audit", capability: "do_work" },
    }),
  ]));
  expect(JSON.stringify(events)).not.toContain("must-not-be-audited");
});


it("keeps process diagnostics and recovery available while both process pools are saturated", async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-worker-process-control-"));
  const processes = new ProcessRunner(1);
  const service = await createWorkerProtocolService({
    workerId: "11111111-1111-4111-8111-111111111111",
    environmentId: "linux",
    workspaces: [{ id: "one", displayName: "One", root: temporary }],
    processes,
  });
  await processes.start({ executable: path.basename(process.execPath), args: ["-e", "setInterval(()=>{},1000)"], cwd: temporary, workspaceId: "one", timeoutMs: 2000 });
  await processes.openStdio({ executable: path.basename(process.execPath), args: ["-e", "setInterval(()=>{},1000)"], cwd: temporary, workspaceId: "one", timeoutMs: null });

  await expect(service.execute({ operation: "process-capacity" })).resolves.toEqual({
    foreground: { active: 1, limit: 1 },
    background: { active: 1, limit: 1 },
    asyncChildren: 1,
    stdioSessions: 1,
  });
  const listed = await service.execute<{ resources: Array<{ handle: string; kind: "async" | "stdio" }> }>({ operation: "process-list" });
  expect(listed.resources).toHaveLength(2);

  for (const resource of listed.resources) {
    await expect(service.execute({ operation: "process-stop", handle: resource.handle })).resolves.toEqual({ handle: resource.handle, stopped: true });
  }
  const deadline = Date.now() + 2000;
  while (processes.activeCount() !== 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  expect(processes.activeCount()).toBe(0);
  await expect(service.execute({ operation: "process-stop", handle: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ status: 404, code: "process_handle_not_found" });
});

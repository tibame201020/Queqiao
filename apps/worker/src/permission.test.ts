import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerApp } from "./app.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

describe("Worker authoritative permission enforcement", () => {
  it("exposes an authenticated, protocol-versioned Gateway handshake", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-handshake-"));
    const app = await createWorkerApp({ environmentId: "linux", defaultWorkspaceId: "one", workerToken: "worker-secret", workspaces: [{ id: "one", displayName: "One", root: temporary }] });
    await request(app).get("/v1/hello").expect(401);
    const response = await request(app).get("/v1/hello").set("x-queqiao-worker-token", "worker-secret").expect(200);
    expect(response.body).toMatchObject({ protocolVersion: "1.0", environmentId: "linux", capabilities: expect.arrayContaining(["workspace-routing", "tool-invocation"]) });
    expect(response.body.instanceId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("denies read_file even when called directly with a valid Worker credential", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-permission-"));
    await writeFile(path.join(temporary, "fixture.txt"), "secret\n");
    const app = await createWorkerApp({ environmentId: "windows", defaultWorkspaceId: "denied", workerToken: "worker-secret", workspaces: [{ id: "denied", displayName: "Denied", root: temporary, profile: "read-only", tools: { allow: [], deny: ["read_file"] }, commands: { allow: [] } }] });
    const response = await request(app).post("/v1/read-file").set("x-queqiao-worker-token", "worker-secret").send({ workspaceId: "denied", path: "fixture.txt", offset: 0, limit: 1 }).expect(403);
    expect(response.body).toMatchObject({ error: "tool_denied" });
    const generic = await request(app).post("/v1/tools/read_file").set("x-queqiao-worker-token", "worker-secret").send({ workspaceId: "denied", path: "fixture.txt", offset: 0, limit: 1 }).expect(403);
    expect(generic.body).toMatchObject({ error: "tool_denied" });
  });

  it("allows editor writes but rejects them for a read-only profile", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-permission-"));
    const app = await createWorkerApp({ environmentId: "windows", defaultWorkspaceId: "readonly", workerToken: "worker-secret", workspaces: [{ id: "readonly", displayName: "Read only", root: temporary }, { id: "editor", displayName: "Editor", root: temporary, profile: "editor" }] });
    const denied = await request(app).post("/v1/tools/write_file").set("x-queqiao-worker-token", "worker-secret").send({ workspaceId: "readonly", path: "denied.txt", content: "no" }).expect(403);
    expect(denied.body).toMatchObject({ error: "tool_denied" });
    await request(app).post("/v1/tools/write_file").set("x-queqiao-worker-token", "worker-secret").send({ workspaceId: "editor", path: "allowed.txt", content: "before" }).expect(200);
    await request(app).post("/v1/tools/edit_file").set("x-queqiao-worker-token", "worker-secret").send({ workspaceId: "editor", path: "allowed.txt", oldText: "before", newText: "after" }).expect(200);
  });

  it("runs only allowlisted executables in coding workspaces without exposing a shell", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-permission-"));
    const executable = path.basename(process.execPath).toLowerCase();
    const app = await createWorkerApp({ environmentId: "windows", defaultWorkspaceId: "coding", workerToken: "worker-secret", workspaces: [
      { id: "coding", displayName: "Coding", root: temporary, profile: "coding", commands: { allow: [executable] } },
      { id: "editor", displayName: "Editor", root: temporary, profile: "editor", commands: { allow: [executable] } },
    ] });
    const allowed = await request(app).post("/v1/tools/run").set("x-queqiao-worker-token", "worker-secret").send({ workspaceId: "coding", executable, args: ["-e", "process.stdout.write('native-ok')"], cwd: "." }).expect(200);
    expect(allowed.body.result).toMatchObject({ exitCode: 0, stdout: "native-ok", timedOut: false });
    await request(app).post("/v1/tools/run").set("x-queqiao-worker-token", "worker-secret").send({ workspaceId: "editor", executable, args: ["--version"] }).expect(403);
    await request(app).post("/v1/tools/run").set("x-queqiao-worker-token", "worker-secret").send({ workspaceId: "coding", executable: "git", args: ["--version"] }).expect(403);
    await request(app).post("/v1/tools/run").set("x-queqiao-worker-token", "worker-secret").send({ workspaceId: "coding", executable, args: ["--version"], cwd: ".." }).expect(400);
  });

  it("requires explicit shell permission and uses the host-native shell", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-shell-"));
    const invocations: Array<{ executable: string; args: readonly string[] }> = [];
    const windowsExecutor = { async run(input: { executable: string; args: readonly string[] }) { invocations.push(input); return { exitCode: 0, signal: null, stdout: "native-shell-ok\r\n", stderr: "", durationMs: 1, timedOut: false, aborted: false, outputLimitExceeded: false }; } };
    const app = await createWorkerApp({ environmentId: process.platform === "win32" ? "windows" : "linux", defaultWorkspaceId: "allowed", workerToken: "worker-secret", ...(process.platform === "win32" ? { processes: windowsExecutor } : {}), workspaces: [
      { id: "allowed", displayName: "Allowed", root: temporary, profile: "coding", tools: { allow: [], deny: [], explicit: ["shell"] } },
      { id: "implicit", displayName: "Implicit", root: temporary, profile: "coding" },
      { id: "editor", displayName: "Editor", root: temporary, profile: "editor", tools: { allow: [], deny: [], explicit: ["shell"] } },
    ] });
    const command = process.platform === "win32" ? "Write-Output native-shell-ok" : "printf native-shell-ok";
    const allowed = await request(app).post("/v1/tools/shell").set("x-queqiao-worker-token", "worker-secret").send({ workspaceId: "allowed", shell: "default", command, cwd: "." }).expect(200);
    expect(allowed.body.result).toMatchObject({ shell: process.platform === "win32" ? "powershell" : "bash", exitCode: 0, timedOut: false });
    expect(allowed.body.result.stdout.trim()).toBe("native-shell-ok");
    if (process.platform === "win32") expect(invocations[0]).toMatchObject({ executable: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command] });
    await request(app).post("/v1/tools/shell").set("x-queqiao-worker-token", "worker-secret").send({ workspaceId: "implicit", command }).expect(403);
    await request(app).post("/v1/tools/shell").set("x-queqiao-worker-token", "worker-secret").send({ workspaceId: "editor", command }).expect(403);
    await request(app).post("/v1/tools/shell").set("x-queqiao-worker-token", "worker-secret").send({ workspaceId: "allowed", command, cwd: ".." }).expect(400);
  });
});

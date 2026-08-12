import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerApp } from "./app.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

describe("Worker authoritative permission enforcement", () => {
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
});

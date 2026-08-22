import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { readRuntimeConfig, runtimeConfigSchema, serializeRuntimeConfig } from "@queqiao/config";
import { createWorkerApp } from "./app.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

describe("Worker workspace admin capability", () => {
  it("mutates the Worker-authoritative runtime config and hot-reloads the catalog", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-admin-"));
    const mainRoot = path.join(temporary, "main");
    const secondaryRoot = path.join(temporary, "secondary");
    await Promise.all([mkdir(mainRoot), mkdir(secondaryRoot)]);
    const configFile = path.join(temporary, "runtime.yaml");
    const workerId = "11111111-1111-4111-8111-111111111111";
    const runtime = runtimeConfigSchema.parse({
      version: 1,
      worker: {
        workerId,
        environmentId: "windows",
        listen: { host: "127.0.0.1", port: 7576 },
        tokenFile: path.join(temporary, "worker.secret"),
        defaultWorkspaceId: "main",
      },
      workspaces: [{ id: "main", displayName: "Main", root: mainRoot, profile: "read-only" }],
    });
    await writeFile(configFile, serializeRuntimeConfig(runtime), "utf8");
    const app = await createWorkerApp({
      workerId,
      environmentId: "windows",
      defaultWorkspaceId: "main",
      workerToken: "worker-secret",
      workspacesFile: configFile,
      runtimeConfigFile: configFile,
    });

    const hello = await request(app).get("/v1/hello").set("x-queqiao-worker-token", "worker-secret").expect(200);
    expect(hello.body.capabilities).toContain("workspace-admin-v1");
    await request(app).post("/v1/admin/workspace-mutations").send({ kind: "profile.set", workspaceId: "main", profile: "coding" }).expect(401);
    await request(app).post("/v1/admin/workspace-mutations").set("x-queqiao-worker-token", "worker-secret").send({ kind: "profile.set", workspaceId: "main", profile: "coding" }).expect(200);
    await request(app).post("/v1/admin/workspace-mutations").set("x-queqiao-worker-token", "worker-secret").send({ kind: "command.decide", workspaceId: "main", command: "NPM", decision: "allow" }).expect(200);
    await request(app).post("/v1/admin/workspace-mutations").set("x-queqiao-worker-token", "worker-secret").send({
      kind: "workspace.add",
      workspace: { id: "secondary", displayName: "Secondary", root: secondaryRoot, profile: "editor" },
    }).expect(200);

    const catalog = await request(app).get("/v1/workspaces").set("x-queqiao-worker-token", "worker-secret").expect(200);
    expect(catalog.body.defaultWorkspaceId).toBe("main");
    expect(catalog.body.workspaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ workspaceId: "main", profile: "coding", commands: { allow: ["npm"] } }),
      expect.objectContaining({ workspaceId: "secondary", profile: "editor" }),
    ]));
    const persisted = await readRuntimeConfig(configFile);
    expect(persisted.workspaces.map((workspace) => workspace.id)).toEqual(["main", "secondary"]);
    expect(persisted.workspaces[0]!.commands.allow).toEqual(["npm"]);

    const rejected = await request(app).post("/v1/admin/workspace-mutations").set("x-queqiao-worker-token", "worker-secret").send({ kind: "workspace.remove", workspaceId: "main" }).expect(409);
    expect(rejected.body).toMatchObject({ error: "default_workspace_remove_forbidden" });
  });
});

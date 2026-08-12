import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRuntimeLayout } from "@queqiao/platform-paths";
import { migrateFromRepository, migrateRuntimeLayoutV1 } from "./runtime-migration.js";
import { parse } from "yaml";
let temporary: string | undefined; afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });
describe("repo runtime migration", () => {
  it("separates config, secrets, state, and repository-local workspace data", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-migrate-")); const repo = path.join(temporary, "repo"); const root = path.join(temporary, "user"); const localWorkspace = path.join(repo, ".queqiao", "local-workspace");
    await mkdir(path.join(repo, ".queqiao", "gateway"), { recursive: true }); await mkdir(localWorkspace); await writeFile(path.join(localWorkspace, "file.txt"), "ok");
    await writeFile(path.join(repo, ".env"), "PUBLIC_BASE_URL=https://example.test\nOAUTH_APPROVAL_SECRET=approval-secret\nJWT_SIGNING_SECRET=jwt-secret-at-least-thirty-two-bytes\nQUEQIAO_WORKER_TOKEN=worker-token-at-least-thirty-two-bytes\n");
    await writeFile(path.join(repo, ".queqiao", "workspaces.json"), JSON.stringify([{ id: "one", displayName: "One", root: localWorkspace }])); await writeFile(path.join(repo, ".queqiao", "workers.json"), '[{"environmentId":"linux","url":"http://127.0.0.1:7576","token":"worker-token-at-least-thirty-two-bytes"}]');
    const layout = resolveRuntimeLayout({ HOME: root, XDG_CONFIG_HOME: path.join(root, "cfg"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), XDG_RUNTIME_DIR: path.join(root, "run") }, "linux"); await migrateFromRepository(repo, layout, true);
    const yaml = await readFile(layout.configFile, "utf8"); const config = parse(yaml); expect(yaml).not.toContain("approval-secret\n"); expect(config.gateway.approvalSecretFile).toContain("oauth-approval-secret.secret"); expect(config.environments[0]).toHaveProperty("tokenFile"); expect(config.workspaces[0].root).toBe(path.join(layout.dataDir, "workspaces", "one"));
  });
  it("upgrades external runtime v1 files into one YAML document", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-v1-")); const layout = resolveRuntimeLayout({ HOME: temporary, XDG_CONFIG_HOME: path.join(temporary, "cfg"), XDG_DATA_HOME: path.join(temporary, "data"), XDG_STATE_HOME: path.join(temporary, "state") }, "linux");
    await mkdir(layout.configDir, { recursive: true }); await writeFile(path.join(layout.configDir, "runtime.env"), `QUEQIAO_WORKER_TOKEN_FILE=${path.join(layout.secretsDir, "token.secret")}\nQUEQIAO_ENVIRONMENT_ID=linux\nQUEQIAO_WORKSPACE_ID=one\n`); await writeFile(path.join(layout.configDir, "workspaces.json"), JSON.stringify([{ id: "one", displayName: "One", root: temporary, profile: "read-only" }]));
    await migrateRuntimeLayoutV1(layout, true); const config = parse(await readFile(layout.configFile, "utf8")); expect(config.worker.environmentId).toBe("linux"); expect(config.workspaces[0].id).toBe("one"); expect(config.gateway).toBeUndefined();
  });
});

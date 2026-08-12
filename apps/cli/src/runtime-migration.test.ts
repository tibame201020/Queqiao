import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRuntimeLayout } from "@queqiao/platform-paths";
import { migrateFromRepository } from "./runtime-migration.js";
let temporary: string | undefined; afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });
describe("repo runtime migration", () => {
  it("separates config, secrets, state, and repository-local workspace data", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-migrate-")); const repo = path.join(temporary, "repo"); const root = path.join(temporary, "user"); const localWorkspace = path.join(repo, ".queqiao", "local-workspace");
    await mkdir(path.join(repo, ".queqiao", "gateway"), { recursive: true }); await mkdir(localWorkspace); await writeFile(path.join(localWorkspace, "file.txt"), "ok");
    await writeFile(path.join(repo, ".env"), "PUBLIC_BASE_URL=https://example.test\nOAUTH_APPROVAL_SECRET=approval-secret\nJWT_SIGNING_SECRET=jwt-secret-at-least-thirty-two-bytes\nQUEQIAO_WORKER_TOKEN=worker-token-at-least-thirty-two-bytes\n");
    await writeFile(path.join(repo, ".queqiao", "workspaces.json"), JSON.stringify([{ id: "one", displayName: "One", root: localWorkspace }])); await writeFile(path.join(repo, ".queqiao", "workers.json"), '[{"environmentId":"linux","url":"http://127.0.0.1:7576","token":"worker-token-at-least-thirty-two-bytes"}]');
    const layout = resolveRuntimeLayout({ HOME: root, XDG_CONFIG_HOME: path.join(root, "cfg"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), XDG_RUNTIME_DIR: path.join(root, "run") }, "linux"); await migrateFromRepository(repo, layout, true);
    const env = await readFile(layout.environmentFile, "utf8"); expect(env).not.toContain("approval-secret\n"); expect(env).toContain("OAUTH_APPROVAL_SECRET_FILE="); expect(JSON.parse(await readFile(layout.workersFile, "utf8"))[0]).toHaveProperty("tokenFile"); expect(JSON.parse(await readFile(layout.workspacesFile, "utf8"))[0].root).toBe(path.join(layout.dataDir, "workspaces", "one"));
  });
});

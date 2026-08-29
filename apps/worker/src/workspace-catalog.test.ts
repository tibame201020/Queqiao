import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceCatalog } from "./workspace-catalog.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

describe("WorkspaceCatalog hot reload", () => {
  it("atomically adopts a valid version and keeps the last good version after rejection", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-catalog-"));
    const firstRoot = path.join(temporary, "first");
    const secondRoot = path.join(temporary, "second");
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)]);
    const file = path.join(temporary, "config.yaml");
    await writeFile(file, `workspaces:\n  - id: first\n    displayName: First\n    root: ${JSON.stringify(firstRoot)}\n`);
    const catalog = new WorkspaceCatalog({ file });
    await catalog.initialize();
    expect(catalog.list().map((entry) => entry.config.id)).toEqual(["first"]);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(file, `workspaces:\n  - id: first\n    displayName: First\n    root: ${JSON.stringify(firstRoot)}\n  - id: second\n    displayName: Second\n    root: ${JSON.stringify(secondRoot)}\n`);
    await catalog.refresh();
    expect(catalog.list().map((entry) => entry.config.id)).toEqual(["first", "second"]);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(file, `workspaces:\n  - id: first\n    displayName: Broken\n    root: ${JSON.stringify(path.join(temporary, "missing"))}\n`);
    await expect(catalog.refresh()).rejects.toThrow();
    expect(catalog.list().map((entry) => entry.config.id)).toEqual(["first", "second"]);
  });

  it("hot reloads Workspace membership without restart", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-catalog-membership-"));
    const firstRoot = path.join(temporary, "first");
    const secondRoot = path.join(temporary, "second");
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot)]);
    const file = path.join(temporary, "config.yaml");
    await writeFile(file, `workspaces:\n  - id: first\n    displayName: First\n    root: ${JSON.stringify(firstRoot)}\n  - id: second\n    displayName: Second\n    root: ${JSON.stringify(secondRoot)}\n`);
    const catalog = new WorkspaceCatalog({ file });
    await catalog.initialize();
    expect(catalog.list().map((entry) => entry.config.id)).toEqual(["first", "second"]);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(file, `workspaces:\n  - id: second\n    displayName: Second\n    root: ${JSON.stringify(secondRoot)}\n`);
    await catalog.refresh();
    expect(catalog.list().map((entry) => entry.config.id)).toEqual(["second"]);
  });
});

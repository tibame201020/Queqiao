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
    const file = path.join(temporary, "workspaces.json");
    await writeFile(file, JSON.stringify([{ id: "first", displayName: "First", root: firstRoot }]));
    const catalog = new WorkspaceCatalog("first", { file });
    await catalog.initialize();
    expect(catalog.list().map((entry) => entry.config.id)).toEqual(["first"]);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(file, JSON.stringify([{ id: "first", displayName: "First", root: firstRoot }, { id: "second", displayName: "Second", root: secondRoot }]));
    await catalog.refresh();
    expect(catalog.list().map((entry) => entry.config.id)).toEqual(["first", "second"]);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(file, JSON.stringify([{ id: "first", displayName: "Broken", root: path.join(temporary, "missing") }]));
    await expect(catalog.refresh()).rejects.toThrow();
    expect(catalog.list().map((entry) => entry.config.id)).toEqual(["first", "second"]);
  });
});

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SafeWorkspace } from "./index.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

describe("SafeWorkspace mutations", () => {
  it("atomically creates, overwrites, and uniquely edits text files", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-"));
    const workspace = new SafeWorkspace(temporary); await workspace.initialize();
    await workspace.write("new.txt", "one\ntwo\n");
    await workspace.write("new.txt", "one\nthree\n");
    await workspace.edit("new.txt", "three", "two");
    expect(await readFile(path.join(temporary, "new.txt"), "utf8")).toBe("one\ntwo\n");
  });

  it("rejects traversal, symlink targets, and ambiguous edits", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "queqiao-outside-"));
    try {
      await writeFile(path.join(temporary, "repeat.txt"), "same same");
      await mkdir(path.join(temporary, "inside"));
      await symlink(outside, path.join(temporary, "linked-dir"), process.platform === "win32" ? "junction" : "dir");
      const workspace = new SafeWorkspace(temporary); await workspace.initialize();
      await expect(workspace.write("../escaped.txt", "no")).rejects.toThrow(/escapes/);
      await expect(workspace.write("linked-dir/escaped.txt", "no")).rejects.toThrow(/Parent directory escapes/);
      await expect(workspace.resolveDirectory("linked-dir")).rejects.toThrow(/escapes/);
      await expect(workspace.edit("repeat.txt", "same", "changed")).rejects.toThrow(/exactly once/);
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});

describe("SafeWorkspace discovery", () => {
  it("lists deterministically with bounded depth, pagination, and hidden-file control", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-"));
    await mkdir(path.join(temporary, "src"));
    await writeFile(path.join(temporary, "z.txt"), "z");
    await writeFile(path.join(temporary, "a.txt"), "a");
    await writeFile(path.join(temporary, ".secret"), "hidden");
    await writeFile(path.join(temporary, "src", "index.ts"), "export {};");
    const workspace = new SafeWorkspace(temporary); await workspace.initialize();

    const first = await workspace.listDirectory(".", 2, 2);
    expect(first.entries.map((entry) => entry.path)).toEqual(["a.txt", "src"]);
    expect(first.truncated).toBe(true);
    const second = await workspace.listDirectory(".", 2, 2, first.nextCursor!);
    expect(second.entries.map((entry) => entry.path)).toEqual(["src/index.ts", "z.txt"]);
    expect(second.nextCursor).toBeNull();
    expect((await workspace.listDirectory(".", 1, 20, undefined, true)).entries.some((entry) => entry.path === ".secret")).toBe(true);
  });

  it("searches literal text with globs and skips symlinks", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "queqiao-outside-"));
    try {
      await mkdir(path.join(temporary, "src"));
      await writeFile(path.join(temporary, "root.ts"), "Needle at root\n");
      await writeFile(path.join(temporary, "src", "nested.ts"), "needle nested\n");
      await writeFile(path.join(temporary, "src", "ignored.txt"), "needle ignored by glob\n");
      await writeFile(path.join(outside, "outside.ts"), "needle outside\n");
      await symlink(outside, path.join(temporary, "linked"), process.platform === "win32" ? "junction" : "dir");
      const workspace = new SafeWorkspace(temporary); await workspace.initialize();
      const result = await workspace.searchText({ query: "needle", globs: ["**/*.ts"] });
      expect(result.matches.map((match) => match.path)).toEqual(["root.ts", "src/nested.ts"]);
      expect(result.matches[0]).toMatchObject({ line: 1, column: 1 });
      expect(result.timedOut).toBe(false);
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});

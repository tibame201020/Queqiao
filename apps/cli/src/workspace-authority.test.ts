import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkspaceAuthorityRoot } from "./workspace-authority.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

describe("Workspace authority root", () => {
  it("authorizes an explicitly selected non-Git directory", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-authority-"));
    const directory = path.join(temporary, "plain-directory");
    await mkdir(directory);
    await expect(resolveWorkspaceAuthorityRoot(directory)).resolves.toBe(await realpathForTest(directory));
  });

  it("rejects files and missing roots without repository semantics", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-authority-"));
    const file = path.join(temporary, "not-a-directory.txt");
    await writeFile(file, "x");
    await expect(resolveWorkspaceAuthorityRoot(file)).rejects.toThrow("not a directory");
    await expect(resolveWorkspaceAuthorityRoot(path.join(temporary, "missing"))).rejects.toThrow();
  });
});

async function realpathForTest(value: string): Promise<string> {
  return import("node:fs/promises").then(({ realpath }) => realpath(value));
}

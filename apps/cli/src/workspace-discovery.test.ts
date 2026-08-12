import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverWorkspaces, resolveDiscoveryRoot } from "./workspace-discovery.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

describe("workspace discovery", () => {
  it("finds repositories without authorizing their parent or traversing excluded directories", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-discovery-"));
    const repo = path.join(temporary, "codes", "project");
    const excluded = path.join(temporary, ".ssh", "hidden-repo");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await mkdir(path.join(excluded, ".git"), { recursive: true });
    const candidates = await discoverWorkspaces([temporary], 4, [".ssh"]);
    expect(candidates).toEqual([{ root: await import("node:fs/promises").then(({ realpath }) => realpath(repo)), name: "project" }]);
    await expect(resolveDiscoveryRoot(repo, [temporary])).resolves.toBe(candidates[0]!.root);
    await expect(resolveDiscoveryRoot(temporary, [temporary])).rejects.toThrow(".git marker");
  });

  it("rejects approval outside configured roots", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-discovery-"));
    const allowed = path.join(temporary, "allowed");
    const outside = path.join(temporary, "outside");
    await mkdir(allowed);
    await mkdir(path.join(outside, ".git"), { recursive: true });
    await expect(resolveDiscoveryRoot(outside, [allowed])).rejects.toThrow("inside a configured discovery root");
  });
});

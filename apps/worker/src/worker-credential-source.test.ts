import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkerCredentialSource } from "./worker-credential-source.js";

describe("WorkerCredentialSource", () => {
  it("observes a securely replaced credential without Worker restart", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "queqiao-worker-credential-"));
    const file = path.join(directory, "worker.secret");
    const first = "a".repeat(32);
    const second = "b".repeat(32);
    await writeFile(file, `${first}\n`, { mode: 0o600 });
    const source = new WorkerCredentialSource(file, 0);
    expect(await source.current()).toBe(first);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(file, `${second}\n`, { mode: 0o600 });
    expect(await source.current()).toBe(second);
  });
});

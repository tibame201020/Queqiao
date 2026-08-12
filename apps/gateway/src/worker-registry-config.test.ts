import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReloadableWorkerRegistry } from "./worker-registry-config.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

describe("ReloadableWorkerRegistry", () => {
  it("adopts valid endpoint changes and retains the last good registry after invalid JSON", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-registry-"));
    const file = path.join(temporary, "workers.json");
    const first = [{ environmentId: "windows", url: "http://127.0.0.1:7576", token: "a".repeat(32) }];
    await writeFile(file, JSON.stringify(first));
    const source = new ReloadableWorkerRegistry({ file });
    await source.initialize();
    expect((await source.current()).configuredEnvironmentIds()).toEqual(["windows"]);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(file, JSON.stringify([...first, { environmentId: "wsl", url: "http://127.0.0.1:7577", token: "b".repeat(32) }]));
    expect((await source.current()).configuredEnvironmentIds()).toEqual(["windows", "wsl"]);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(file, "not-json");
    expect((await source.current()).configuredEnvironmentIds()).toEqual(["windows", "wsl"]);
  });
});

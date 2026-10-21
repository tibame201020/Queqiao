import { describe, expect, it } from "vitest";
import { runtimeConfigSchema } from "@queqiao/config";
import { createConfiguredProcessRunner } from "./process-runner-config.js";

const worker = { environmentId: "windows", tokenFile: "worker.secret", listen: { port: 7576 } };
const parse = (process?: Record<string, number>) => runtimeConfigSchema.parse({
  version: 1,
  worker: { ...worker, ...(process ? { process } : {}) },
  workspaces: [{ id: "alpha", displayName: "Alpha", root: "C:/workspace", profile: "coding" }],
}).worker!;

describe("Worker process configuration wiring", () => {
  it("uses the upgraded defaults for a legacy Worker config", () => {
    const runner = createConfiguredProcessRunner(parse());
    expect(runner.capacity()).toMatchObject({
      foreground: { active: 0, limit: 8 }, background: { active: 0, limit: 8 },
      sessions: { active: 0, limit: 8 }, jobs: { queued: 0, queueLimit: 32, retained: 0 },
    });
  });

  it("wires all independently configured pools and queue capacity into one Worker runner", () => {
    const runner = createConfiguredProcessRunner(parse({
      foregroundConcurrency: 2, backgroundConcurrency: 4, sessionConcurrency: 3,
      jobQueueLimit: 64, jobRetentionMs: 120_000,
    }));
    expect(runner.capacity()).toMatchObject({
      foreground: { active: 0, limit: 2 }, background: { active: 0, limit: 4 },
      sessions: { active: 0, limit: 3 }, jobs: { queued: 0, queueLimit: 64, retained: 0 },
    });
  });
});

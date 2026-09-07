import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export default async function setupVitestTempRoot() {
  const original = {
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  };
  const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-vitest-"));

  process.env.TMPDIR = root;
  process.env.TEMP = root;
  process.env.TMP = root;

  return async () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  };
}
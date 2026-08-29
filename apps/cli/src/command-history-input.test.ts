import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  readAllowedExecutableHistory,
  recordAllowedExecutableHistory,
  resolveCommandHistoryFile,
} from "./command-history-input.js";

describe("command history input", () => {
  it("stores newest distinct command text first", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-command-history-"));
    const file = path.join(root, "history.json");
    await recordAllowedExecutableHistory(file, "git, npm");
    await recordAllowedExecutableHistory(file, "node");
    await recordAllowedExecutableHistory(file, "git, npm");
    expect(await readAllowedExecutableHistory(file)).toEqual(["git, npm", "node"]);
  });

  it("keeps command history outside named Worker directories", () => {
    const root = path.join(os.tmpdir(), "queqiao-command-history-layout");
    const env = process.platform === "win32"
      ? { ...process.env, LOCALAPPDATA: root, USERPROFILE: root }
      : { ...process.env, HOME: root, XDG_CONFIG_HOME: path.join(root, "config") };
    const file = resolveCommandHistoryFile(env, process.platform);
    expect(path.basename(file)).toBe("setup-history.json");
    expect(file).not.toMatch(/[\\/]workers[\\/][^\\/]+[\\/]/);
  });
});

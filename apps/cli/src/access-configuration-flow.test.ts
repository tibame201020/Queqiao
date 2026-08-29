import { describe, expect, it, vi } from "vitest";
import type { CorePublicToolName } from "@queqiao/core-manifest";
import { collectAccessConfiguration, type AccessConfigurationPrompts } from "./access-configuration-flow.js";

function prompts(choices: string[], tools: CorePublicToolName[] = ["read_file"], commandText = ""): AccessConfigurationPrompts {
  return {
    choose: vi.fn(async () => choices.shift() ?? ""),
    multi: vi.fn(async () => tools),
    commandText: vi.fn(async () => commandText),
    text: vi.fn(async () => "saved-profile"),
  };
}

function store(entries: Array<{ name: string; tools: CorePublicToolName[]; allowedExecutables: string[] }> = []) {
  return {
    list: vi.fn(async () => entries),
    save: vi.fn(async () => undefined),
  };
}

describe("shared access configuration flow", () => {
  it("applies built-in Reader without opening custom tools", async () => {
    const ui = prompts(["builtin:reader"]);
    const profileStore = store();
    const result = await collectAccessConfiguration(ui, profileStore as never);

    expect(result.tools).toContain("read_file");
    expect(result.tools).not.toContain("write_file");
    expect(ui.multi).not.toHaveBeenCalled();
  });

  it("reuses a saved profile by index", async () => {
    const ui = prompts(["profile:0"]);
    const profileStore = store([{ name: "frontend", tools: ["read_file", "run"], allowedExecutables: ["git", "npm"] }]);
    await expect(collectAccessConfiguration(ui, profileStore as never)).resolves.toEqual({
      tools: ["read_file", "run"],
      allowedExecutables: ["git", "npm"],
    });
    expect(ui.multi).not.toHaveBeenCalled();
  });

  it("collects Custom commands only when run is selected and may save the result", async () => {
    const ui = prompts(["__custom_access__", "yes"], ["read_file", "run"], " git, npm, GIT ");
    const profileStore = store();
    const result = await collectAccessConfiguration(ui, profileStore as never);

    expect(result).toEqual({ tools: ["read_file", "run"], allowedExecutables: ["git", "npm"] });
    expect(ui.commandText).toHaveBeenCalledWith("Allowed executables");
    expect(profileStore.save).toHaveBeenCalledWith({
      name: "saved-profile",
      tools: ["read_file", "run"],
      allowedExecutables: ["git", "npm"],
    });
  });
});

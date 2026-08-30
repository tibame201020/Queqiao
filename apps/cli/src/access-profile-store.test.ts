import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AccessProfileStore, resolveAccessProfileFile } from "./access-profile-store.js";

describe("access profile store", () => {
  it("saves reusable tools and commands outside named Worker config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-profile-store-"));
    const file = path.join(root, "access-profiles.json");
    const store = new AccessProfileStore(file);
    await store.save({ name: "frontend", tools: ["read_file", "edit_file", "run"], allowedExecutables: ["git", "npm"] });
    expect(await store.list()).toEqual([{ name: "frontend", tools: ["read_file", "edit_file", "run"], allowedExecutables: ["git", "npm"] }]);
  });

  it("replaces a profile by case-insensitive name instead of duplicating it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-profile-store-replace-"));
    const store = new AccessProfileStore(path.join(root, "profiles.json"));
    await store.save({ name: "Frontend", tools: ["read_file"], allowedExecutables: [] });
    await store.save({ name: "frontend", tools: ["read_file", "run"], allowedExecutables: ["git"] });
    expect(await store.list()).toHaveLength(1);
    expect((await store.list())[0]).toMatchObject({ name: "frontend", allowedExecutables: ["git"] });
  });

  it("fails closed when the reusable profile file is malformed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-profile-store-invalid-"));
    const file = path.join(root, "profiles.json");
    await writeFile(file, "{not-json", "utf8");
    await expect(new AccessProfileStore(file).list()).rejects.toThrow();
  });

  it("resolves the reusable profile file above named Worker directories", () => {
    const root = path.join(os.tmpdir(), "queqiao-profile-layout");
    const env = process.platform === "win32"
      ? { ...process.env, LOCALAPPDATA: root, USERPROFILE: root }
      : { ...process.env, HOME: root, XDG_CONFIG_HOME: path.join(root, "config") };
    const file = resolveAccessProfileFile(env, process.platform);
    expect(path.basename(file)).toBe("access-profiles.json");
    expect(file).not.toMatch(/[\\/]workers[\\/][^\\/]+[\\/]/);
  });
  it("renames a custom profile atomically without duplicating it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-profile-store-rename-"));
    const store = new AccessProfileStore(path.join(root, "profiles.json"));
    await store.save({ name: "frontend", tools: ["read_file", "run"], allowedExecutables: ["git"] });
    const renamed = await store.rename("frontend", "frontend-safe");
    expect(renamed.name).toBe("frontend-safe");
    expect(await store.list()).toEqual([{ name: "frontend-safe", tools: ["read_file", "run"], allowedExecutables: ["git"] }]);
  });

  it("deletes only the requested custom profile", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-profile-store-delete-"));
    const store = new AccessProfileStore(path.join(root, "profiles.json"));
    await store.save({ name: "one", tools: ["read_file"], allowedExecutables: [] });
    await store.save({ name: "two", tools: ["read_file", "edit_file"], allowedExecutables: [] });
    const deleted = await store.delete("one");
    expect(deleted.name).toBe("one");
    expect((await store.list()).map((profile) => profile.name)).toEqual(["two"]);
  });
});

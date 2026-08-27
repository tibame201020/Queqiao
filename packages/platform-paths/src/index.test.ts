import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveNamedRoleConfigRoot, resolveRuntimeLayout, resolveRuntimeLayoutForInstance, resolveRuntimeLayoutForNamedRole } from "./index.js";
describe("Runtime Layout v1", () => {
  it("uses LOCALAPPDATA on Windows independently of the test host", () => { const layout = resolveRuntimeLayout({ LOCALAPPDATA: "C:\\Users\\owner\\AppData\\Local", TEMP: "C:\\Temp" }, "win32"); expect(layout.configDir).toBe("C:\\Users\\owner\\AppData\\Local\\Queqiao\\config"); expect(layout.configFile).toBe("C:\\Users\\owner\\AppData\\Local\\Queqiao\\config\\config.yaml"); expect(layout.secretsDir).toBe("C:\\Users\\owner\\AppData\\Local\\Queqiao\\data\\secrets"); });
  it("uses XDG directories on Linux independently of the test host", () => { const layout = resolveRuntimeLayout({ HOME: "/home/owner", XDG_CONFIG_HOME: "/cfg", XDG_DATA_HOME: "/data", XDG_STATE_HOME: "/state", XDG_RUNTIME_DIR: "/run/user/1000" }, "linux"); expect(layout).toMatchObject({ configDir: "/cfg/queqiao", dataDir: "/data/queqiao", stateDir: "/state/queqiao", configFile: "/cfg/queqiao/config.yaml" }); expect(path.posix.dirname(layout.runtimeDir)).toBe("/run/user/1000"); });
  it("uses the native home variable when both Windows and POSIX variables exist", () => { expect(resolveRuntimeLayout({ HOME: "/linux-home", USERPROFILE: "C:\\WindowsHome" }, "linux").configFile).toBe("/linux-home/.config/queqiao/config.yaml"); expect(resolveRuntimeLayout({ HOME: "/linux-home", USERPROFILE: "C:\\WindowsHome" }, "win32").configFile).toBe("C:\\WindowsHome\\AppData\\Local\\Queqiao\\config\\config.yaml"); });

  it("isolates named instances automatically on Windows", () => {
    const layout = resolveRuntimeLayoutForInstance("shadow", { LOCALAPPDATA: "C:\\Users\\owner\\AppData\\Local", TEMP: "C:\\Temp" }, "win32");
    expect(layout).toMatchObject({
      configDir: "C:\\Users\\owner\\AppData\\Local\\Queqiao\\instances\\shadow\\config",
      dataDir: "C:\\Users\\owner\\AppData\\Local\\Queqiao\\instances\\shadow\\data",
      stateDir: "C:\\Users\\owner\\AppData\\Local\\Queqiao\\instances\\shadow\\state",
      runtimeDir: "C:\\Temp\\Queqiao\\instances\\shadow",
    });
  });
  it("isolates named instances automatically on Linux", () => {
    const layout = resolveRuntimeLayoutForInstance("shadow", { HOME: "/home/owner", XDG_CONFIG_HOME: "/cfg", XDG_DATA_HOME: "/data", XDG_STATE_HOME: "/state", XDG_RUNTIME_DIR: "/run/user/1000" }, "linux");
    expect(layout).toMatchObject({ configDir: "/cfg/queqiao/instances/shadow", dataDir: "/data/queqiao/instances/shadow", stateDir: "/state/queqiao/instances/shadow" }); expect(layout.runtimeDir).toMatch(/^\/run\/user\/1000\/queqiao-(?:user|\d+)\/instances\/shadow$/);
  });
  it("keeps named Gateway and Worker layouts physically independent", () => {
    const env = { LOCALAPPDATA: "C:\\Users\\owner\\AppData\\Local", TEMP: "C:\\Temp" };
    const gateway = resolveRuntimeLayoutForNamedRole("gateway", "shadow", env, "win32");
    const worker = resolveRuntimeLayoutForNamedRole("worker", "windows", env, "win32");
    expect(gateway.configDir).toBe("C:\\Users\\owner\\AppData\\Local\\Queqiao\\gateways\\shadow\\config");
    expect(worker.configDir).toBe("C:\\Users\\owner\\AppData\\Local\\Queqiao\\workers\\windows\\config");
    expect(gateway.configDir).not.toBe(worker.configDir);
  });
  it("uses role-scoped named layouts on Linux", () => {
    const env = { HOME: "/home/owner", XDG_CONFIG_HOME: "/cfg", XDG_DATA_HOME: "/data", XDG_STATE_HOME: "/state", XDG_RUNTIME_DIR: "/run/user/1000" };
    expect(resolveRuntimeLayoutForNamedRole("gateway", "shadow", env, "linux").configDir).toBe("/cfg/queqiao/gateways/shadow");
    expect(resolveRuntimeLayoutForNamedRole("worker", "windows", env, "linux").configDir).toBe("/cfg/queqiao/workers/windows");
  });
  it("resolves named-role discovery roots and fails closed under explicit layout overrides", () => {
    expect(resolveNamedRoleConfigRoot("worker", { LOCALAPPDATA: "C:\\Users\\owner\\AppData\\Local" }, "win32")).toBe("C:\\Users\\owner\\AppData\\Local\\Queqiao\\workers");
    expect(resolveNamedRoleConfigRoot("gateway", { HOME: "/home/owner", XDG_CONFIG_HOME: "/cfg" }, "linux")).toBe("/cfg/queqiao/gateways");
    expect(() => resolveNamedRoleConfigRoot("worker", { QUEQIAO_CONFIG_DIR: "C:\\external\\config" }, "win32")).toThrow(/discovery is unavailable/);
  });
  it("preserves explicit runtime layout overrides for managed production lanes", () => {
    const layout = resolveRuntimeLayoutForInstance("stable", { QUEQIAO_CONFIG_DIR: "C:\\external\\config", QUEQIAO_DATA_DIR: "C:\\external\\data", QUEQIAO_STATE_HOME: "C:\\external\\state", QUEQIAO_RUNTIME_DIR: "C:\\external\\runtime" }, "win32");
    expect(layout.configDir).toBe("C:\\external\\config");
    expect(layout.stateDir).toBe("C:\\external\\state");
  });
});

import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRuntimeLayout } from "./index.js";
describe("Runtime Layout v1", () => {
  it("uses LOCALAPPDATA on Windows", () => { const layout = resolveRuntimeLayout({ LOCALAPPDATA: "C:\\Users\\owner\\AppData\\Local", TEMP: "C:\\Temp" }, "win32"); expect(layout.configDir).toBe(path.resolve("C:\\Users\\owner\\AppData\\Local\\Queqiao\\config")); expect(layout.configFile).toBe(path.join(layout.configDir, "config.yaml")); expect(layout.secretsDir).toContain(path.join("Queqiao", "data", "secrets")); });
  it("uses XDG directories on Linux", () => { const layout = resolveRuntimeLayout({ HOME: "/home/owner", XDG_CONFIG_HOME: "/cfg", XDG_DATA_HOME: "/data", XDG_STATE_HOME: "/state", XDG_RUNTIME_DIR: "/run/user/1000" }, "linux"); expect(layout).toMatchObject({ configDir: path.resolve("/cfg/queqiao"), dataDir: path.resolve("/data/queqiao"), stateDir: path.resolve("/state/queqiao") }); expect(path.dirname(layout.runtimeDir)).toBe(path.resolve("/run/user/1000")); });
});

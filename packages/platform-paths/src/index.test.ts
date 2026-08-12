import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRuntimeLayout } from "./index.js";
describe("Runtime Layout v1", () => {
  it("uses LOCALAPPDATA on Windows independently of the test host", () => { const layout = resolveRuntimeLayout({ LOCALAPPDATA: "C:\\Users\\owner\\AppData\\Local", TEMP: "C:\\Temp" }, "win32"); expect(layout.configDir).toBe("C:\\Users\\owner\\AppData\\Local\\Queqiao\\config"); expect(layout.configFile).toBe("C:\\Users\\owner\\AppData\\Local\\Queqiao\\config\\config.yaml"); expect(layout.secretsDir).toBe("C:\\Users\\owner\\AppData\\Local\\Queqiao\\data\\secrets"); });
  it("uses XDG directories on Linux independently of the test host", () => { const layout = resolveRuntimeLayout({ HOME: "/home/owner", XDG_CONFIG_HOME: "/cfg", XDG_DATA_HOME: "/data", XDG_STATE_HOME: "/state", XDG_RUNTIME_DIR: "/run/user/1000" }, "linux"); expect(layout).toMatchObject({ configDir: "/cfg/queqiao", dataDir: "/data/queqiao", stateDir: "/state/queqiao", configFile: "/cfg/queqiao/config.yaml" }); expect(path.posix.dirname(layout.runtimeDir)).toBe("/run/user/1000"); });
  it("uses the native home variable when both Windows and POSIX variables exist", () => { expect(resolveRuntimeLayout({ HOME: "/linux-home", USERPROFILE: "C:\\WindowsHome" }, "linux").configFile).toBe("/linux-home/.config/queqiao/config.yaml"); expect(resolveRuntimeLayout({ HOME: "/linux-home", USERPROFILE: "C:\\WindowsHome" }, "win32").configFile).toBe("C:\\WindowsHome\\AppData\\Local\\Queqiao\\config\\config.yaml"); });
});

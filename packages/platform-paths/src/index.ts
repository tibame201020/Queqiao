import os from "node:os";
import path from "node:path";

export type RuntimeLayout = { configDir: string; dataDir: string; stateDir: string; logDir: string; runtimeDir: string; secretsDir: string; configFile: string; gatewayStateDir: string };
export function resolveRuntimeLayout(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): RuntimeLayout {
  const home = env.USERPROFILE || env.HOME || os.homedir(); const windows = platform === "win32"; const localAppData = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const configDir = path.resolve(env.QUEQIAO_CONFIG_DIR || (windows ? path.join(localAppData, "Queqiao", "config") : path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "queqiao")));
  const dataDir = path.resolve(env.QUEQIAO_DATA_DIR || (windows ? path.join(localAppData, "Queqiao", "data") : path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "queqiao")));
  const stateDir = path.resolve(env.QUEQIAO_STATE_HOME || (windows ? path.join(localAppData, "Queqiao", "state") : path.join(env.XDG_STATE_HOME || path.join(home, ".local", "state"), "queqiao")));
  const runtimeDir = path.resolve(env.QUEQIAO_RUNTIME_DIR || (windows ? path.join(env.TEMP || os.tmpdir(), "Queqiao") : path.join(env.XDG_RUNTIME_DIR || os.tmpdir(), `queqiao-${typeof process.getuid === "function" ? process.getuid() : "user"}`)));
  return { configDir, dataDir, stateDir, runtimeDir, logDir: path.join(stateDir, "logs"), secretsDir: path.join(dataDir, "secrets"), configFile: path.join(configDir, "config.yaml"), gatewayStateDir: path.join(dataDir, "gateway") };
}

import os from "node:os";
import path from "node:path";

export type RuntimeLayout = { configDir: string; dataDir: string; stateDir: string; logDir: string; runtimeDir: string; secretsDir: string; configFile: string; gatewayStateDir: string };
export function resolveRuntimeLayout(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): RuntimeLayout {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const home = env.USERPROFILE || env.HOME || os.homedir(); const windows = platform === "win32"; const localAppData = env.LOCALAPPDATA || paths.join(home, "AppData", "Local");
  const configDir = paths.resolve(env.QUEQIAO_CONFIG_DIR || (windows ? paths.join(localAppData, "Queqiao", "config") : paths.join(env.XDG_CONFIG_HOME || paths.join(home, ".config"), "queqiao")));
  const dataDir = paths.resolve(env.QUEQIAO_DATA_DIR || (windows ? paths.join(localAppData, "Queqiao", "data") : paths.join(env.XDG_DATA_HOME || paths.join(home, ".local", "share"), "queqiao")));
  const stateDir = paths.resolve(env.QUEQIAO_STATE_HOME || (windows ? paths.join(localAppData, "Queqiao", "state") : paths.join(env.XDG_STATE_HOME || paths.join(home, ".local", "state"), "queqiao")));
  const runtimeDir = paths.resolve(env.QUEQIAO_RUNTIME_DIR || (windows ? paths.join(env.TEMP || os.tmpdir(), "Queqiao") : paths.join(env.XDG_RUNTIME_DIR || os.tmpdir(), `queqiao-${typeof process.getuid === "function" ? process.getuid() : "user"}`)));
  return { configDir, dataDir, stateDir, runtimeDir, logDir: paths.join(stateDir, "logs"), secretsDir: paths.join(dataDir, "secrets"), configFile: paths.join(configDir, "config.yaml"), gatewayStateDir: paths.join(dataDir, "gateway") };
}

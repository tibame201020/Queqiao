import path from "node:path";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { resolveRuntimeLayout } from "@queqiao/platform-paths";
import {
  DEFAULT_WORKSTATION_PALETTE,
  isLegacyWorkstationPaletteId,
  isWorkstationColorValue,
  resolveLegacyWorkstationPalette,
  type WorkstationPalette,
  type WorkstationSemanticRole,
} from "./workstation-theme.js";

export type WorkstationSettings = {
  version: 1;
  appearance: {
    colors: WorkstationPalette;
  };
};

export const defaultWorkstationSettings: WorkstationSettings = {
  version: 1,
  appearance: { colors: { ...DEFAULT_WORKSTATION_PALETTE } },
};

const roles: readonly WorkstationSemanticRole[] = ["accent", "modal", "success", "warning", "danger", "muted"];

function validateColors(value: unknown): WorkstationPalette {
  if (!value || typeof value !== "object") throw new Error("Workstation appearance colors are invalid");
  const candidate = value as Record<string, unknown>;
  const colors = {} as WorkstationPalette;
  for (const role of roles) {
    if (!isWorkstationColorValue(candidate[role])) throw new Error(`Workstation appearance color is invalid: ${role}`);
    colors[role] = candidate[role];
  }
  return colors;
}

function validateWorkstationSettings(value: unknown): WorkstationSettings {
  if (!value || typeof value !== "object") throw new Error("Workstation settings must be an object");
  const candidate = value as { version?: unknown; appearance?: { colors?: unknown; palette?: unknown } };
  if (candidate.version !== 1) throw new Error("Unsupported Workstation settings version");
  if (!candidate.appearance) throw new Error("Workstation appearance is invalid");
  if (candidate.appearance.colors) return { version: 1, appearance: { colors: validateColors(candidate.appearance.colors) } };
  if (isLegacyWorkstationPaletteId(candidate.appearance.palette)) {
    return { version: 1, appearance: { colors: resolveLegacyWorkstationPalette(candidate.appearance.palette) } };
  }
  throw new Error("Workstation appearance colors are invalid");
}

export function resolveWorkstationSettingsFile(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const layout = resolveRuntimeLayout(env, platform);
  const paths = platform === "win32" ? path.win32 : path.posix;
  return paths.join(layout.configDir, "workstation.yaml");
}

export async function loadWorkstationSettings(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<WorkstationSettings> {
  const file = resolveWorkstationSettingsFile(env, platform);
  try {
    return validateWorkstationSettings(parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(defaultWorkstationSettings);
    throw error;
  }
}

export async function saveWorkstationSettings(settings: WorkstationSettings, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<WorkstationSettings> {
  const file = resolveWorkstationSettingsFile(env, platform);
  const validated = validateWorkstationSettings(settings);
  await mkdir(path.dirname(file), { recursive: true });
  const lockFile = `${file}.lock`;
  let lock;
  try {
    lock = await open(lockFile, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Workstation settings are being changed by another Queqiao process");
    throw error;
  }
  try {
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, stringify(validated, { lineWidth: 0 }), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  } finally {
    await lock.close();
    await rm(lockFile, { force: true });
  }
  return validated;
}

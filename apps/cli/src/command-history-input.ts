import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { resolveExtensionHubRoot, secureRuntimeDirectory, secureRuntimeFile } from "@queqiao/platform-paths";
import { normalizeCommandHistory } from "./access-configuration.js";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const HISTORY_LIMIT = 20;

type HistoryFile = { allowedExecutables: string[] };

export function resolveCommandHistoryFile(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  return path.join(path.dirname(resolveExtensionHubRoot(env, platform)), "setup-history.json");
}

export async function readAllowedExecutableHistory(file: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<HistoryFile>;
    return normalizeCommandHistory(Array.isArray(parsed.allowedExecutables) ? parsed.allowedExecutables : [], HISTORY_LIMIT);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return [];
    throw error;
  }
}

export async function recordAllowedExecutableHistory(file: string, value: string): Promise<string[]> {
  const current = await readAllowedExecutableHistory(file);
  const next = normalizeCommandHistory([value, ...current], HISTORY_LIMIT);
  await mkdir(path.dirname(file), { recursive: true });
  await secureRuntimeDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ allowedExecutables: next }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await secureRuntimeFile(temporary);
  await rename(temporary, file);
  await secureRuntimeFile(file);
  return next;
}

export async function historyAwareTextInput(
  message: string,
  history: readonly string[],
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): Promise<string> {
  const normalizedHistory = normalizeCommandHistory(history, HISTORY_LIMIT);
  const fallback = normalizedHistory[0] || "";
  const readline = createInterface({
    input,
    output,
    terminal: true,
    history: [...normalizedHistory],
    historySize: HISTORY_LIMIT,
    removeHistoryDuplicates: true,
  });
  try {
    const ghost = fallback ? ` ${DIM}${fallback}${RESET}` : "";
    const answer = await readline.question(`${message}${ghost}\n> `);
    return answer.trim() || fallback;
  } finally {
    readline.close();
  }
}

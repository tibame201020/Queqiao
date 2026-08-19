import { existsSync, lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { styleText } from "node:util";
import type { Key } from "node:readline";
import { AutocompletePrompt, settings } from "@clack/core";
import { S_BAR, S_BAR_END, symbol } from "@clack/prompts";

type PathOption = { value: string };

function directoryOptions(input: string): PathOption[] {
  const value = input || process.cwd();
  const normalized = path.resolve(value);
  let directory = normalized;
  let fragment = "";
  try {
    if (!(existsSync(normalized) && lstatSync(normalized).isDirectory()) || !/[\\/]$/.test(value)) {
      directory = path.dirname(normalized);
      fragment = path.basename(normalized);
    }
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(fragment.toLowerCase()))
      .map((entry) => ({ value: path.join(directory, entry.name) }));
  } catch {
    return [];
  }
}

function commonPrefix(values: string[]): string {
  if (!values.length) return "";
  let prefix = values[0]!;
  for (const value of values.slice(1)) {
    while (prefix && !value.toLowerCase().startsWith(prefix.toLowerCase())) prefix = prefix.slice(0, -1);
    if (!prefix) break;
  }
  return prefix;
}

export function completeDirectoryInput(input: string): string {
  const options = directoryOptions(input).map((entry) => entry.value);
  if (!options.length) return input;
  if (options.length === 1) return `${options[0]}${path.sep}`;
  const prefix = commonPrefix(options);
  return prefix.length > input.length ? prefix : input;
}

class WorkspacePathPrompt extends AutocompletePrompt<PathOption> {
  constructor(initialValue: string) {
    super({
      initialUserInput: initialValue,
      options() { return directoryOptions(this.userInput); },
      filter: () => true,
      render() {
        const guide = settings.withGuide;
        const bar = guide ? styleText("gray", S_BAR) : "";
        const head = `${symbol(this.state)}  Workspace path`;
        const input = this.userInputWithCursor || styleText("dim", initialValue);
        if (this.state === "submit") {
          return `${guide ? `${bar}\n` : ""}${head}\n${guide ? styleText("gray", S_BAR_END) + "  " : ""}${styleText("dim", this.value ? String(this.value) : this.userInput)}`;
        }
        if (this.state === "cancel") {
          return `${guide ? `${bar}\n` : ""}${head}\n${guide ? styleText("gray", S_BAR_END) + "  " : ""}${styleText("dim", "Cancelled")}`;
        }
        const choices = this.filteredOptions.slice(0, 5)
          .map((entry) => styleText("dim", `  ${entry.value}`))
          .join("\n");
        return `${guide ? `${bar}\n` : ""}${head}\n${guide ? `${bar}  ` : ""}${input}${choices ? `\n${choices}` : ""}`;
      },
    });
    this.on("key", (_char, key) => {
      if (key.name === "return") {
        this._setValue(this.userInput);
        return;
      }
      if (key.name !== "tab") return;
      const completed = completeDirectoryInput(this.userInput);
      if (completed === this.userInput) return;
      this._clearUserInput();
      this._setUserInput(completed, true);
    });
  }

  protected override _isActionKey(char: string | undefined, key: Key): boolean {
    return super._isActionKey(char, key);
  }
}

export async function workspacePath(initialValue = process.cwd()): Promise<string | symbol | undefined> {
  return new WorkspacePathPrompt(initialValue).prompt() as Promise<string | symbol | undefined>;
}

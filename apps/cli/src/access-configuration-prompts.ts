import { cancel, isCancel, select, text } from "@clack/prompts";
import { accessToolMultiselect } from "./access-tool-prompt.js";
import type { AccessConfigurationPrompts } from "./access-configuration-flow.js";
import {
  historyAwareTextInput,
  readAllowedExecutableHistory,
  recordAllowedExecutableHistory,
  resolveCommandHistoryFile,
} from "./command-history-input.js";

export function createAccessConfigurationPrompts(options: {
  cancelMessage: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): AccessConfigurationPrompts {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const commandHistoryFile = resolveCommandHistoryFile(env, platform);
  const abort = (): never => {
    cancel(options.cancelMessage);
    throw new Error(options.cancelMessage);
  };

  return {
    choose: async (message, choices) => {
      const value = await select({ message, options: choices });
      if (isCancel(value)) abort();
      return String(value);
    },
    multi: async (_message, choices, initialValues) => {
      const value = await accessToolMultiselect(choices, initialValues);
      if (isCancel(value)) return abort();
      return value.map(String);
    },
    commandText: async (message) => {
      const history = await readAllowedExecutableHistory(commandHistoryFile);
      const value = await historyAwareTextInput(message, history);
      if (value) await recordAllowedExecutableHistory(commandHistoryFile, value);
      return value;
    },
    text: async (message, initialValue, validate) => {
      const value = await text({
        message,
        ...(initialValue ? { placeholder: initialValue, defaultValue: initialValue } : {}),
        ...(validate ? { validate: (candidate: string | undefined) => validate(candidate || initialValue || "") } : {}),
      });
      if (isCancel(value)) abort();
      return String(value || initialValue || "").trim();
    },
  };
}

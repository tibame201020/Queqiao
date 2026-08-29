import { CORE_PUBLIC_TOOL_CONTRACTS, CORE_PUBLIC_TOOL_ORDER, type CorePublicToolName } from "@queqiao/core-manifest";
import type { WorkspaceConfig } from "@queqiao/config";

export type AccessConfiguration = {
  tools: readonly CorePublicToolName[];
  allowedExecutables: readonly string[];
};

export type AccessToolOption = {
  value: CorePublicToolName;
  label: string;
  description: string;
};

export const ACCESS_TOOL_OPTIONS: AccessToolOption[] = CORE_PUBLIC_TOOL_ORDER.map((name) => {
  const contract = CORE_PUBLIC_TOOL_CONTRACTS[name];
  return {
    value: name,
    label: name,
    description: name === "shell"
      ? `${contract.title} — high risk; unrestricted native shell`
      : `${contract.title} — ${contract.description}`,
  };
});

export const DEFAULT_ACCESS_TOOLS: readonly CorePublicToolName[] = CORE_PUBLIC_TOOL_ORDER.filter((name) =>
  CORE_PUBLIC_TOOL_CONTRACTS[name].risk === "read"
  && CORE_PUBLIC_TOOL_CONTRACTS[name].requiredCapabilities.every((capability) => capability === "workspace:read")
);

const EDITOR_ACCESS_TOOLS: readonly CorePublicToolName[] = [
  ...DEFAULT_ACCESS_TOOLS,
  "write_file",
  "edit_file",
];

export type BuiltinAccessProfile = {
  id: "reader" | "editor";
  name: "Reader" | "Editor";
  configuration: AccessConfiguration;
};

export const BUILTIN_ACCESS_PROFILES: ReadonlyArray<BuiltinAccessProfile> = [
  { id: "reader", name: "Reader", configuration: { tools: DEFAULT_ACCESS_TOOLS, allowedExecutables: [] } },
  { id: "editor", name: "Editor", configuration: { tools: EDITOR_ACCESS_TOOLS, allowedExecutables: [] } },
];

export function describeAccessConfiguration(configuration: AccessConfiguration): string {
  const lines = [`Tools: ${configuration.tools.join(", ")}`];
  if (configuration.allowedExecutables.length) {
    lines.push(`Commands: ${configuration.allowedExecutables.join(", ")}`);
  }
  return lines.join("\n");
}

const EXECUTABLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

export function normalizeAllowedExecutables(value: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value.split(",")) {
    const executable = raw.trim().toLowerCase();
    if (!executable || seen.has(executable)) continue;
    if (!EXECUTABLE_PATTERN.test(executable)) {
      throw new Error(`Invalid executable name: ${raw.trim()}`);
    }
    seen.add(executable);
    result.push(executable);
  }
  return result;
}

export function normalizeCommandHistory(values: readonly string[], limit = 20): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

export function accessConfigurationToWorkspacePolicy(configuration: AccessConfiguration): Pick<WorkspaceConfig, "profile" | "tools" | "commands"> {
  const tools = [...new Set(configuration.tools)];
  const runSelected = tools.includes("run");
  return {
    // Legacy schema compatibility only. New setup authority is the explicit tools/commands matrix below.
    profile: "coding",
    tools: {
      allow: tools,
      deny: [],
      explicit: tools.includes("shell") ? ["shell"] : [],
    },
    commands: {
      allow: runSelected ? [...new Set(configuration.allowedExecutables.map((value) => value.toLowerCase()))] : [],
    },
  };
}

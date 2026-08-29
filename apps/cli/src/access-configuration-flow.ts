import type { CorePublicToolName } from "@queqiao/core-manifest";
import {
  ACCESS_TOOL_OPTIONS,
  BUILTIN_ACCESS_PROFILES,
  DEFAULT_ACCESS_TOOLS,
  describeAccessConfiguration,
  normalizeAllowedExecutables,
  type AccessConfiguration,
  type AccessToolOption,
} from "./access-configuration.js";
import type { AccessProfileStore } from "./access-profile-store.js";

export const CUSTOM_ACCESS = "__custom_access__";

export type AccessConfigurationPrompts = {
  choose: (message: string, options: Array<{ value: string; label: string; description?: string }>) => Promise<string>;
  multi: (message: string, options: AccessToolOption[], initialValues: CorePublicToolName[]) => Promise<string[]>;
  commandText: (message: string) => Promise<string>;
  text: (
    message: string,
    initialValue?: string,
    validate?: (value: string) => string | undefined,
  ) => Promise<string>;
};

export async function collectAccessConfiguration(
  prompts: AccessConfigurationPrompts,
  profileStore: Pick<AccessProfileStore, "list" | "save">,
): Promise<AccessConfiguration> {
  const profiles = await profileStore.list();
  const selectedProfile = await prompts.choose("Access profile", [
    ...BUILTIN_ACCESS_PROFILES.map((profile) => ({
      value: `builtin:${profile.id}`,
      label: profile.name,
      description: describeAccessConfiguration(profile.configuration),
    })),
    ...profiles.map((profile, index) => ({
      value: `profile:${index}`,
      label: profile.name,
      description: describeAccessConfiguration({ tools: profile.tools, allowedExecutables: profile.allowedExecutables }),
    })),
    { value: CUSTOM_ACCESS, label: "Custom", description: "Choose tools and command allowlists" },
  ]);

  const builtin = BUILTIN_ACCESS_PROFILES.find((profile) => selectedProfile === `builtin:${profile.id}`);
  if (builtin) {
    return {
      tools: [...builtin.configuration.tools],
      allowedExecutables: [...builtin.configuration.allowedExecutables],
    };
  }

  const profileIndex = selectedProfile.startsWith("profile:")
    ? Number(selectedProfile.slice("profile:".length))
    : -1;
  const profile = Number.isInteger(profileIndex) ? profiles[profileIndex] : undefined;
  if (profile) {
    return { tools: [...profile.tools], allowedExecutables: [...profile.allowedExecutables] };
  }

  const configuration = await collectCustomAccessConfiguration(prompts);
  await maybeSaveAccessProfile(prompts, profileStore, configuration);
  return configuration;
}

async function collectCustomAccessConfiguration(prompts: AccessConfigurationPrompts): Promise<AccessConfiguration> {
  const selectedTools = await prompts.multi(
    "Tools",
    ACCESS_TOOL_OPTIONS.map((option) => ({ ...option })),
    [...DEFAULT_ACCESS_TOOLS],
  );
  const allowedExecutables = selectedTools.includes("run")
    ? normalizeAllowedExecutables(await prompts.commandText("Allowed executables"))
    : [];
  return {
    tools: selectedTools as AccessConfiguration["tools"],
    allowedExecutables,
  };
}

async function maybeSaveAccessProfile(
  prompts: AccessConfigurationPrompts,
  profileStore: Pick<AccessProfileStore, "save">,
  configuration: AccessConfiguration,
): Promise<void> {
  const save = await prompts.choose("Save this access configuration as a profile?", [
    { value: "no", label: "No" },
    { value: "yes", label: "Yes" },
  ]);
  if (save !== "yes") return;
  const name = await prompts.text("Profile name");
  await profileStore.save({
    name,
    tools: [...configuration.tools],
    allowedExecutables: [...configuration.allowedExecutables],
  });
}

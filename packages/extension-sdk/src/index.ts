import type { ExtensionManifestConfig } from "@queqiao/config";
import type { QueqiaoExtension } from "@queqiao/tool-runtime";

export const QUEQIAO_EXTENSION_API_VERSION = 1 as const;

export function defineExtension<TContext>(extension: QueqiaoExtension<TContext>): QueqiaoExtension<TContext> {
  return extension;
}

export function defineExtensionManifest(manifest: ExtensionManifestConfig): ExtensionManifestConfig {
  return manifest;
}

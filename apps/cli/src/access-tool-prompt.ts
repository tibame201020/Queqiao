import type { CorePublicToolName } from "@queqiao/core-manifest";
import type { AccessToolOption } from "./access-configuration.js";
import { queqiaoMultiselect } from "./tui-multiselect.js";

export async function accessToolMultiselect(options: AccessToolOption[], initialValues: CorePublicToolName[]): Promise<CorePublicToolName[] | symbol> {
  return queqiaoMultiselect({
    message: "Tools",
    choices: options,
    initialValues,
    required: true,
    validate(value) {
      if (!value?.length) return "Please select at least one tool.";
    },
    summary: (selected) => `${selected.length} selected`,
  });
}

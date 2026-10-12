import { z } from "zod";
const schema=z.object({runId:z.string().regex(/^[0-9]+$/)}).strict();
export function resolvePublicBrowserCIContext(
  env:{GITHUB_RUN_ID?:string|undefined},rawMetadata:string|undefined,
):{runId:string}{
  if(env.GITHUB_RUN_ID)return schema.parse({runId:env.GITHUB_RUN_ID});
  if(!rawMetadata)throw new Error("Missing CI Worker run metadata");
  return schema.parse(JSON.parse(rawMetadata));
}

import { z } from "zod";

/** Synthetic CI receipt: no browser sessions, tokens or profile data. */
const PublicReceiptSchema = z.object({
  runId: z.string().regex(/^[0-9]+$/),
  origin: z.literal("https://example.com"),
  pageTitle: z.literal("Example Domain"),
  interactiveMarker: z.literal("QUEQIAO_CI_BROWSER_HARNESS_OK"),
  clicks: z.literal(1),
  inputEcho: z.literal("CI-only-synthetic-input"),
  headless: z.literal(true),
}).strict();

export type PublicBrowserReceipt = z.infer<typeof PublicReceiptSchema>;

export function validatePublicBrowserReceipt(input: unknown): PublicBrowserReceipt {
  return PublicReceiptSchema.parse(input);
}

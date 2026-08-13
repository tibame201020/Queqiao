import { describe, expect, it } from "vitest";
import {
  QUEQIAO_PROTOCOL_VERSION,
  QUEQIAO_WORKER_PROTOCOL_VERSION,
  environmentIdSchema,
} from "./index.js";

describe("legacy protocol compatibility facade", () => {
  it("keeps the legacy version alias bound to the Worker protocol version", () => {
    expect(QUEQIAO_PROTOCOL_VERSION).toBe(QUEQIAO_WORKER_PROTOCOL_VERSION);
  });

  it("continues to re-export transport-neutral domain contracts", () => {
    expect(environmentIdSchema.parse("windows")).toBe("windows");
  });
});

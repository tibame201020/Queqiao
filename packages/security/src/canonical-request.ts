import { createHash } from "node:crypto";

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function assertFiniteNumber(value: number): void {
  if (!Number.isFinite(value)) {
    throw new TypeError("Canonical request values cannot contain non-finite numbers");
  }
}

export function canonicalize(value: CanonicalValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    assertFiniteNumber(value);
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  const record = value as Readonly<Record<string, CanonicalValue>>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key]!)}`);
  return `{${entries.join(",")}}`;
}

export function digestCanonicalRequest(value: CanonicalValue): string {
  const digest = createHash("sha256").update(canonicalize(value), "utf8").digest("base64url");
  return `sha256:${digest}`;
}


import { NextResponse } from "next/server";
import { ConfigError } from "./env";
import { ExtractionError } from "./extract";

/**
 * One place that decides which failures are the operator's fault (503, fix your
 * .env or apply the schema), which are the user's (400, upload something else),
 * and which are ours (500).
 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ConfigError) {
    return NextResponse.json(
      { error: err.message, kind: "config", missing: err.missing },
      { status: 503 },
    );
  }
  if (err instanceof ExtractionError) {
    return NextResponse.json({ error: err.message, kind: "extraction" }, { status: 400 });
  }
  if (err instanceof BadRequest) {
    return NextResponse.json({ error: err.message, kind: "request" }, { status: 400 });
  }

  const message = err instanceof Error ? err.message : "Unexpected server error.";
  console.error("[popo]", err);
  return NextResponse.json({ error: message, kind: "server" }, { status: 500 });
}

export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequest";
  }
}

/** Clamps a client-supplied number into range, falling back when absent or NaN. */
export function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

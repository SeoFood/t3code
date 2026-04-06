import { Schema } from "effect";
import { IsoDateTime, ThreadId } from "./baseSchemas";

// ── Inputs ──────────────────────────────────────────────────────

export const SpotlightEnableInput = Schema.Struct({
  threadId: ThreadId,
});
export type SpotlightEnableInput = typeof SpotlightEnableInput.Type;

export const SpotlightDisableInput = Schema.Struct({
  threadId: ThreadId,
});
export type SpotlightDisableInput = typeof SpotlightDisableInput.Type;

export const SpotlightGetStatusInput = Schema.Struct({
  threadId: ThreadId,
});
export type SpotlightGetStatusInput = typeof SpotlightGetStatusInput.Type;

// ── Outputs ─────────────────────────────────────────────────────

export const SpotlightStatusResult = Schema.Struct({
  threadId: ThreadId,
  active: Schema.Boolean,
  lastSyncedAt: Schema.NullOr(IsoDateTime),
  error: Schema.NullOr(Schema.String),
});
export type SpotlightStatusResult = typeof SpotlightStatusResult.Type;

// ── Events ──────────────────────────────────────────────────────

export const SpotlightEventType = Schema.Literals(["enabled", "disabled", "synced", "error"]);
export type SpotlightEventType = typeof SpotlightEventType.Type;

export const SpotlightEvent = Schema.Struct({
  threadId: ThreadId,
  type: SpotlightEventType,
  detail: Schema.optional(Schema.String),
  timestamp: IsoDateTime,
});
export type SpotlightEvent = typeof SpotlightEvent.Type;

// ── Errors ──────────────────────────────────────────────────────

export class SpotlightError extends Schema.TaggedErrorClass<SpotlightError>()("SpotlightError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return `Spotlight error during ${this.operation}: ${this.detail}`;
  }
}

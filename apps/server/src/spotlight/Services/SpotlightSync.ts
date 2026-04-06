/**
 * SpotlightSync - Service interface for one-way file sync from worktrees to repo root.
 *
 * Watches a thread's worktree for file changes and syncs them back to the
 * repository root directory via checkpoint commits, enabling hot-reloading
 * in external tools (Xcode, dev servers, etc.).
 *
 * @module SpotlightSync
 */
import type {
  SpotlightError,
  SpotlightEvent,
  SpotlightStatusResult,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, ServiceMap } from "effect";

export interface SpotlightSyncShape {
  /**
   * Enable spotlight sync for a thread.
   *
   * Resolves the thread's worktree path and project cwd from the projection,
   * starts watching the worktree for changes, and syncs them to the repo root.
   * If another spotlight session targets the same repo root, it is disabled first.
   */
  readonly enable: (threadId: ThreadId) => Effect.Effect<void, SpotlightError>;

  /**
   * Disable spotlight sync for a thread and restore the repo root.
   */
  readonly disable: (threadId: ThreadId) => Effect.Effect<void, SpotlightError>;

  /**
   * Get the current spotlight status for a thread.
   */
  readonly getStatus: (threadId: ThreadId) => Effect.Effect<SpotlightStatusResult>;

  /**
   * Disable all active spotlight sessions and restore repo roots.
   * Called during server shutdown.
   */
  readonly disableAll: Effect.Effect<void>;

  /**
   * Subscribe to spotlight events with a direct callback.
   * Returns an unsubscribe function.
   */
  readonly subscribe: (
    listener: (event: SpotlightEvent) => Effect.Effect<void>,
  ) => Effect.Effect<() => void>;
}

export class SpotlightSync extends ServiceMap.Service<SpotlightSync, SpotlightSyncShape>()(
  "t3/spotlight/Services/SpotlightSync",
) {}

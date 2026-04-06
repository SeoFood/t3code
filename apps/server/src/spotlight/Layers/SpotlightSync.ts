import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

import {
  SpotlightError,
  type SpotlightEvent,
  type SpotlightStatusResult,
  type ThreadId,
} from "@t3tools/contracts";
import { Effect, Layer, Option } from "effect";

import { GitCore } from "../../git/Services/GitCore";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { ServerSettingsService } from "../../serverSettings";
import { SpotlightSync, type SpotlightSyncShape } from "../Services/SpotlightSync";

interface SpotlightSession {
  threadId: ThreadId;
  worktreePath: string;
  repoRootCwd: string;
  originalRef: string;
  watcher: FSWatcher | null;
  lastSyncedAt: string | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

const DEBOUNCE_MS = 500;

const nowIso = () => new Date().toISOString();

const makeSpotlightSync = Effect.gen(function* () {
  const gitCore = yield* GitCore;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const settingsService = yield* ServerSettingsService;

  const sessions = new Map<string, SpotlightSession>();
  const repoRootToThread = new Map<string, string>();
  const eventListeners = new Set<(event: SpotlightEvent) => Effect.Effect<void>>();

  // Get a forking function to run effects from native callbacks
  const services = yield* Effect.services();
  const runFork = Effect.runForkWith(services);

  const publishEvent = (event: SpotlightEvent): Effect.Effect<void> =>
    Effect.gen(function* () {
      for (const listener of eventListeners) {
        yield* listener(event).pipe(Effect.ignoreCause({ log: true }));
      }
    });

  const runRsync = (src: string, dest: string): Effect.Effect<void, SpotlightError> =>
    Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          const srcPath = src.endsWith("/") ? src : `${src}/`;
          execFile("rsync", ["-a", "--delete", "--exclude=.git", srcPath, dest], (error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
      catch: (error) =>
        new SpotlightError({
          operation: "sync",
          detail: error instanceof Error ? error.message : String(error),
        }),
    });

  const syncWorktreeToRoot = (session: SpotlightSession): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* runRsync(session.worktreePath, session.repoRootCwd);

      session.lastSyncedAt = nowIso();

      yield* publishEvent({
        threadId: session.threadId,
        type: "synced",
        timestamp: session.lastSyncedAt,
      });
    }).pipe(
      Effect.catch(() =>
        publishEvent({
          threadId: session.threadId,
          type: "error",
          detail: "Sync failed",
          timestamp: nowIso(),
        }),
      ),
    );

  const startWatcher = (session: SpotlightSession) => {
    try {
      const watcher = watch(session.worktreePath, { recursive: true }, (_eventType, filename) => {
        // Ignore .git directory changes
        if (filename && filename.startsWith(".git")) return;

        // Debounce: reset timer on each change
        if (session.debounceTimer) clearTimeout(session.debounceTimer);
        session.debounceTimer = setTimeout(() => {
          runFork(syncWorktreeToRoot(session));
        }, DEBOUNCE_MS);
      });

      session.watcher = watcher;
    } catch {
      // Watcher creation can fail on some platforms
    }
  };

  const disableSession = (threadId: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const session = sessions.get(threadId);
      if (!session) return;

      // Stop watcher
      if (session.debounceTimer) clearTimeout(session.debounceTimer);
      if (session.watcher) {
        session.watcher.close();
        session.watcher = null;
      }

      // Restore repo root to its own branch state
      yield* gitCore
        .execute({
          operation: "spotlight-restore",
          cwd: session.repoRootCwd,
          args: ["checkout", "."],
        })
        .pipe(
          Effect.catch(() =>
            Effect.logWarning("Failed to restore repo root after spotlight disable"),
          ),
        );
      // Clean untracked files that were synced from the worktree
      yield* gitCore
        .execute({
          operation: "spotlight-clean",
          cwd: session.repoRootCwd,
          args: ["clean", "-fd", "--exclude=.git"],
        })
        .pipe(
          Effect.catch(() =>
            Effect.logWarning("Failed to clean untracked files after spotlight disable"),
          ),
        );

      repoRootToThread.delete(session.repoRootCwd);
      sessions.delete(threadId);

      yield* publishEvent({
        threadId: session.threadId,
        type: "disabled",
        timestamp: nowIso(),
      });
    });

  const enable: SpotlightSyncShape["enable"] = (threadId) =>
    Effect.gen(function* () {
      const settings = yield* settingsService.getSettings.pipe(
        Effect.mapError(
          (e) =>
            new SpotlightError({
              operation: "enable",
              detail: `Failed to read settings: ${String(e)}`,
            }),
        ),
      );
      if (!settings.enableSpotlight) {
        return yield* new SpotlightError({
          operation: "enable",
          detail: "Spotlight is not enabled in server settings",
        });
      }

      // Resolve thread context from projection
      const threadContext = yield* snapshotQuery.getThreadCheckpointContext(threadId).pipe(
        Effect.mapError(
          (e) =>
            new SpotlightError({
              operation: "enable",
              detail: `Failed to resolve thread context: ${String(e)}`,
            }),
        ),
      );

      if (Option.isNone(threadContext)) {
        return yield* new SpotlightError({
          operation: "enable",
          detail: `Thread ${threadId} not found`,
        });
      }

      const { workspaceRoot, worktreePath } = threadContext.value;

      if (!worktreePath) {
        return yield* new SpotlightError({
          operation: "enable",
          detail: "Thread does not have a worktree. Spotlight requires a worktree-based thread.",
        });
      }

      // If another session uses the same repo root, disable it first
      const existingThreadId = repoRootToThread.get(workspaceRoot);
      if (existingThreadId && existingThreadId !== threadId) {
        yield* disableSession(existingThreadId);
      }

      // If this thread already has spotlight, disable it first for a clean restart
      if (sessions.has(threadId)) {
        yield* disableSession(threadId);
      }

      // Record original HEAD ref of the repo root
      const headResult = yield* gitCore
        .execute({
          operation: "spotlight-head",
          cwd: workspaceRoot,
          args: ["rev-parse", "--abbrev-ref", "HEAD"],
        })
        .pipe(
          Effect.mapError(
            (e) =>
              new SpotlightError({
                operation: "enable",
                detail: `Failed to read repo root HEAD: ${String(e)}`,
              }),
          ),
        );

      const originalRef = headResult.stdout.trim() || "HEAD";

      const session: SpotlightSession = {
        threadId,
        worktreePath,
        repoRootCwd: workspaceRoot,
        originalRef,
        watcher: null,
        lastSyncedAt: null,
        debounceTimer: null,
      };

      sessions.set(threadId, session);
      repoRootToThread.set(workspaceRoot, threadId);

      // Start file watcher
      startWatcher(session);

      yield* publishEvent({
        threadId,
        type: "enabled",
        timestamp: nowIso(),
      });

      // Do an initial sync
      yield* syncWorktreeToRoot(session);
    });

  const disable: SpotlightSyncShape["disable"] = (threadId) =>
    Effect.gen(function* () {
      if (!sessions.has(threadId)) {
        return yield* new SpotlightError({
          operation: "disable",
          detail: `No active spotlight session for thread ${threadId}`,
        });
      }
      yield* disableSession(threadId);
    });

  const service: SpotlightSyncShape = {
    enable,
    disable,

    getStatus: (threadId) =>
      Effect.sync(() => {
        const session = sessions.get(threadId);
        return {
          threadId,
          active: !!session,
          lastSyncedAt: session?.lastSyncedAt ?? null,
          error: null,
        } satisfies SpotlightStatusResult;
      }),

    disableAll: Effect.forEach([...sessions.keys()], (threadId) =>
      disableSession(threadId).pipe(Effect.ignoreCause({ log: true })),
    ).pipe(Effect.asVoid),

    subscribe: (listener) =>
      Effect.sync(() => {
        eventListeners.add(listener);
        return () => {
          eventListeners.delete(listener);
        };
      }),
  };

  return service;
});

export const SpotlightSyncLive = Layer.effect(SpotlightSync, makeSpotlightSync);

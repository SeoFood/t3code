import { useAtomValue } from "@effect/atom-react";
import type { SpotlightEvent, SpotlightStatusResult, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { WsRpcClient } from "../wsRpcClient";
import { appAtomRegistry } from "./atomRegistry";

function makeStateAtom<A>(label: string, initialValue: A) {
  return Atom.make(initialValue).pipe(Atom.keepAlive, Atom.withLabel(label));
}

// Map of threadId -> spotlight status
const spotlightStatusByThreadAtom = makeStateAtom<ReadonlyMap<string, SpotlightStatusResult>>(
  "spotlight-status-by-thread",
  new Map(),
);

export function applySpotlightEvent(event: SpotlightEvent): void {
  const current = appAtomRegistry.get(spotlightStatusByThreadAtom);
  const next = new Map(current);

  switch (event.type) {
    case "enabled":
      next.set(event.threadId, {
        threadId: event.threadId,
        active: true,
        lastSyncedAt: null,
        error: null,
      });
      break;
    case "disabled":
      next.delete(event.threadId);
      break;
    case "synced":
      {
        const existing = next.get(event.threadId);
        if (existing) {
          next.set(event.threadId, {
            ...existing,
            lastSyncedAt: event.timestamp,
            error: null,
          });
        }
      }
      break;
    case "error":
      {
        const existing = next.get(event.threadId);
        if (existing) {
          next.set(event.threadId, {
            ...existing,
            error: event.detail ?? "Unknown error",
          });
        }
      }
      break;
  }

  appAtomRegistry.set(spotlightStatusByThreadAtom, next);
}

export function useSpotlightActive(threadId: ThreadId | null): boolean {
  const statusMap = useAtomValue(spotlightStatusByThreadAtom);
  if (!threadId) return false;
  return statusMap.get(threadId)?.active ?? false;
}

export function useSpotlightStatus(threadId: ThreadId | null): SpotlightStatusResult | null {
  const statusMap = useAtomValue(spotlightStatusByThreadAtom);
  if (!threadId) return null;
  return statusMap.get(threadId) ?? null;
}

type SpotlightClient = Pick<WsRpcClient["spotlight"], "onEvent">;

export function startSpotlightSync(client: SpotlightClient): () => void {
  const unsub = client.onEvent((event) => {
    applySpotlightEvent(event);
  });

  return unsub;
}

import type { ServerId } from "@t3tools/contracts";
import { LOCAL_SERVER_ID } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";

import { appAtomRegistry } from "./atomRegistry";

export type WsConnectionUiState = "connected" | "connecting" | "error" | "offline" | "reconnecting";
export type WsReconnectPhase = "attempting" | "exhausted" | "idle" | "waiting";

export const WS_RECONNECT_INITIAL_DELAY_MS = 1_000;
export const WS_RECONNECT_BACKOFF_FACTOR = 2;
export const WS_RECONNECT_MAX_DELAY_MS = 64_000;
export const WS_RECONNECT_MAX_RETRIES = 7;
export const WS_RECONNECT_MAX_ATTEMPTS = WS_RECONNECT_MAX_RETRIES + 1;

export interface WsConnectionStatus {
  readonly attemptCount: number;
  readonly closeCode: number | null;
  readonly closeReason: string | null;
  readonly connectedAt: string | null;
  readonly disconnectedAt: string | null;
  readonly hasConnected: boolean;
  readonly lastError: string | null;
  readonly lastErrorAt: string | null;
  readonly nextRetryAt: string | null;
  readonly online: boolean;
  readonly phase: "idle" | "connecting" | "connected" | "disconnected";
  readonly reconnectAttemptCount: number;
  readonly reconnectMaxAttempts: number;
  readonly reconnectPhase: WsReconnectPhase;
  readonly socketUrl: string | null;
}

const INITIAL_WS_CONNECTION_STATUS = Object.freeze<WsConnectionStatus>({
  attemptCount: 0,
  closeCode: null,
  closeReason: null,
  connectedAt: null,
  disconnectedAt: null,
  hasConnected: false,
  lastError: null,
  lastErrorAt: null,
  nextRetryAt: null,
  online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
  phase: "idle",
  reconnectAttemptCount: 0,
  reconnectMaxAttempts: WS_RECONNECT_MAX_ATTEMPTS,
  reconnectPhase: "idle",
  socketUrl: null,
});

export const wsConnectionStatusAtom = Atom.make(INITIAL_WS_CONNECTION_STATUS).pipe(
  Atom.keepAlive,
  Atom.withLabel("ws-connection-status"),
);

// ---------------------------------------------------------------------------
// Per-server connection status atoms
// ---------------------------------------------------------------------------

const serverConnectionStatusAtoms = new Map<string, typeof wsConnectionStatusAtom>();

export function getOrCreateServerConnectionStatusAtom(serverId: ServerId) {
  const key = String(serverId);
  let atom = serverConnectionStatusAtoms.get(key);
  if (!atom) {
    atom = Atom.make(INITIAL_WS_CONNECTION_STATUS).pipe(
      Atom.keepAlive,
      Atom.withLabel(`ws-connection-status-${key}`),
    );
    serverConnectionStatusAtoms.set(key, atom);
  }
  return atom;
}

function resolveAtom(serverId?: ServerId) {
  if (serverId === undefined || serverId === LOCAL_SERVER_ID) {
    return wsConnectionStatusAtom;
  }
  return getOrCreateServerConnectionStatusAtom(serverId);
}

function isoNow() {
  return new Date().toISOString();
}

function updateWsConnectionStatus(
  updater: (current: WsConnectionStatus) => WsConnectionStatus,
  serverId?: ServerId,
): WsConnectionStatus {
  const atom = resolveAtom(serverId);
  const nextStatus = updater(appAtomRegistry.get(atom));
  appAtomRegistry.set(atom, nextStatus);
  return nextStatus;
}

export function getWsConnectionStatus(serverId?: ServerId): WsConnectionStatus {
  return appAtomRegistry.get(resolveAtom(serverId));
}

export function getWsConnectionUiState(status: WsConnectionStatus): WsConnectionUiState {
  if (status.phase === "connected") {
    return "connected";
  }

  if (!status.online && (status.disconnectedAt !== null || status.phase === "disconnected")) {
    return "offline";
  }

  if (!status.hasConnected) {
    return status.phase === "disconnected" ? "error" : "connecting";
  }

  return "reconnecting";
}

export function recordWsConnectionAttempt(
  socketUrl: string,
  serverId?: ServerId,
): WsConnectionStatus {
  return updateWsConnectionStatus(
    (current) => ({
      ...current,
      attemptCount: current.attemptCount + 1,
      nextRetryAt: null,
      phase: "connecting",
      reconnectAttemptCount: current.phase === "connected" ? 1 : current.reconnectAttemptCount + 1,
      reconnectPhase: "attempting",
      socketUrl,
    }),
    serverId,
  );
}

export function recordWsConnectionOpened(serverId?: ServerId): WsConnectionStatus {
  return updateWsConnectionStatus(
    (current) => ({
      ...current,
      closeCode: null,
      closeReason: null,
      connectedAt: isoNow(),
      disconnectedAt: null,
      hasConnected: true,
      nextRetryAt: null,
      phase: "connected",
      reconnectAttemptCount: 0,
      reconnectPhase: "idle",
    }),
    serverId,
  );
}

export function recordWsConnectionErrored(
  message?: string | null,
  serverId?: ServerId,
): WsConnectionStatus {
  return updateWsConnectionStatus(
    (current) =>
      applyDisconnectState(current, {
        lastError: message?.trim() ? message : current.lastError,
        lastErrorAt: isoNow(),
      }),
    serverId,
  );
}

export function recordWsConnectionClosed(
  details?: {
    readonly code?: number;
    readonly reason?: string;
  },
  serverId?: ServerId,
): WsConnectionStatus {
  return updateWsConnectionStatus(
    (current) =>
      applyDisconnectState(current, {
        closeCode: details?.code ?? current.closeCode,
        closeReason: details?.reason?.trim() ? details.reason : current.closeReason,
      }),
    serverId,
  );
}

export function setBrowserOnlineStatus(online: boolean, serverId?: ServerId): WsConnectionStatus {
  return updateWsConnectionStatus(
    (current) => ({
      ...current,
      online,
    }),
    serverId,
  );
}

export function resetWsReconnectBackoff(serverId?: ServerId): WsConnectionStatus {
  return updateWsConnectionStatus(
    (current) => ({
      ...current,
      nextRetryAt: null,
      reconnectAttemptCount: 0,
      reconnectPhase: "idle",
    }),
    serverId,
  );
}

export function exhaustWsReconnectIfStillWaiting(
  expectedNextRetryAt: string,
  serverId?: ServerId,
): WsConnectionStatus {
  return updateWsConnectionStatus((current) => {
    if (
      current.reconnectPhase !== "waiting" ||
      current.nextRetryAt !== expectedNextRetryAt ||
      !current.online ||
      !current.hasConnected
    ) {
      return current;
    }

    return {
      ...current,
      nextRetryAt: null,
      reconnectAttemptCount: current.reconnectMaxAttempts,
      reconnectPhase: "exhausted",
    };
  }, serverId);
}

export function resetWsConnectionStateForTests(): void {
  appAtomRegistry.set(wsConnectionStatusAtom, INITIAL_WS_CONNECTION_STATUS);
}

export function useWsConnectionStatus(): WsConnectionStatus {
  return useAtomValue(wsConnectionStatusAtom);
}

export function getWsReconnectDelayMsForRetry(retryIndex: number): number | null {
  if (!Number.isInteger(retryIndex) || retryIndex < 0 || retryIndex >= WS_RECONNECT_MAX_RETRIES) {
    return null;
  }

  return Math.min(
    Math.round(WS_RECONNECT_INITIAL_DELAY_MS * WS_RECONNECT_BACKOFF_FACTOR ** retryIndex),
    WS_RECONNECT_MAX_DELAY_MS,
  );
}

function applyDisconnectState(
  current: WsConnectionStatus,
  updates: Partial<
    Pick<WsConnectionStatus, "closeCode" | "closeReason" | "lastError" | "lastErrorAt">
  >,
): WsConnectionStatus {
  const disconnectedAt = current.disconnectedAt ?? isoNow();
  const nextRetryDelayMs =
    current.nextRetryAt !== null || current.reconnectPhase === "exhausted"
      ? null
      : getWsReconnectDelayMsForRetry(Math.max(0, current.reconnectAttemptCount - 1));

  return {
    ...current,
    ...updates,
    disconnectedAt,
    nextRetryAt:
      nextRetryDelayMs === null
        ? current.nextRetryAt
        : new Date(Date.now() + nextRetryDelayMs).toISOString(),
    phase: "disconnected",
    reconnectPhase:
      current.reconnectPhase === "waiting" || current.reconnectPhase === "exhausted"
        ? current.reconnectPhase
        : nextRetryDelayMs === null
          ? "exhausted"
          : "waiting",
  };
}

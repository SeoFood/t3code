import type { NativeApi, ServerId } from "@t3tools/contracts";
import { LOCAL_SERVER_ID } from "@t3tools/contracts";

import { serverConnectionRegistry } from "./rpc/serverConnectionRegistry";
import { __resetWsNativeApiForTests, createWsNativeApi } from "./wsNativeApi";

let cachedApi: NativeApi | undefined;

export function readNativeApi(): NativeApi | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedApi) return cachedApi;

  if (window.nativeApi) {
    cachedApi = window.nativeApi;
    return cachedApi;
  }

  cachedApi = createWsNativeApi();
  return cachedApi;
}

export function ensureNativeApi(): NativeApi {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Native API not found");
  }
  return api;
}

/**
 * Dispatch an orchestration command to the correct server based on serverId.
 * For local server, uses the NativeApi. For remote servers, uses the registry client.
 */
export async function dispatchCommandToServer(
  command: Parameters<NativeApi["orchestration"]["dispatchCommand"]>[0],
  serverId: ServerId = LOCAL_SERVER_ID,
): Promise<void> {
  if (serverId === LOCAL_SERVER_ID) {
    await ensureNativeApi().orchestration.dispatchCommand(command);
  } else {
    const client = serverConnectionRegistry.getClient(serverId);
    if (!client) {
      throw new Error(`No connection to server ${String(serverId)}`);
    }
    await client.orchestration.dispatchCommand(command);
  }
}

export async function __resetNativeApiForTests() {
  cachedApi = undefined;
  await __resetWsNativeApiForTests();
}

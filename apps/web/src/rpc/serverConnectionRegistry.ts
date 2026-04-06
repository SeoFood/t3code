import type { RemoteServer, ServerId } from "@t3tools/contracts";
import { LOCAL_SERVER_ID } from "@t3tools/contracts";

import { resolveServerUrl } from "../lib/utils";
import { createWsRpcClient, type WsRpcClient } from "../wsRpcClient";
import { WsTransport } from "../wsTransport";
import { appAtomRegistry } from "./atomRegistry";
import {
  getOrCreateServerConnectionStatusAtom,
  type WsConnectionStatus,
} from "./wsConnectionState";

interface ServerConnection {
  readonly serverId: ServerId;
  readonly client: WsRpcClient;
  readonly transport: WsTransport;
  readonly label: string;
}

class ServerConnectionRegistryImpl {
  private connections = new Map<string, ServerConnection>();

  connectLocal(): WsRpcClient {
    const key = String(LOCAL_SERVER_ID);
    if (this.connections.has(key)) {
      return this.connections.get(key)!.client;
    }
    const transport = new WsTransport();
    const client = createWsRpcClient(transport);
    this.connections.set(key, {
      serverId: LOCAL_SERVER_ID,
      client,
      transport,
      label: "Local",
    });
    return client;
  }

  connectRemote(server: RemoteServer): WsRpcClient {
    const key = String(server.id);
    if (this.connections.has(key)) {
      return this.connections.get(key)!.client;
    }
    const wsProtocol = server.url.startsWith("https") ? "wss" : "ws";
    const transport = new WsTransport(
      resolveServerUrl({ url: server.url, protocol: wsProtocol, pathname: "/ws" }),
    );
    const client = createWsRpcClient(transport);
    this.connections.set(key, {
      serverId: server.id,
      client,
      transport,
      label: server.name,
    });
    return client;
  }

  async disconnect(serverId: ServerId): Promise<void> {
    const key = String(serverId);
    const connection = this.connections.get(key);
    if (!connection) return;
    this.connections.delete(key);
    await connection.client.dispose();
  }

  getClient(serverId: ServerId): WsRpcClient | undefined {
    return this.connections.get(String(serverId))?.client;
  }

  getConnectionStatus(serverId: ServerId): WsConnectionStatus {
    const atom = getOrCreateServerConnectionStatusAtom(serverId);
    return appAtomRegistry.get(atom);
  }

  isConnected(serverId: ServerId): boolean {
    return this.connections.has(String(serverId));
  }

  getAllServerIds(): ServerId[] {
    return [...this.connections.values()].map((c) => c.serverId);
  }

  async disposeAll(): Promise<void> {
    const ids = this.getAllServerIds();
    await Promise.all(ids.map((id) => this.disconnect(id)));
  }
}

export const serverConnectionRegistry = new ServerConnectionRegistryImpl();

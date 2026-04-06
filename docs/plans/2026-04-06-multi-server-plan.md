# Multi-Server Support - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow connecting to multiple T3 Code servers from a single app instance, showing local and remote projects side by side in a flat list with server badges.

**Architecture:** Introduce a `ServerConnectionRegistry` that manages multiple `WsTransport` + `WsRpcClient` instances (one per server). Extend the store with `serverId` on Projects/Threads. Add a "Servers" settings tab and server badges in the sidebar.

**Tech Stack:** Effect Schema (contracts), WsTransport/WsRpcClient (web RPC), Zustand (store), React + Tailwind (UI)

---

### Task 1: RemoteServer Schema in Contracts

**Files:**

- Create: `packages/contracts/src/remoteServer.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/settings.ts`

**Step 1: Create the RemoteServer schema**

Create `packages/contracts/src/remoteServer.ts`:

```typescript
import * as Schema from "effect/Schema";

export const RemoteServerId = Schema.String.pipe(Schema.brand("RemoteServerId"));
export type RemoteServerId = typeof RemoteServerId.Type;

export const ServerId = Schema.Union(Schema.Literal("local"), RemoteServerId);
export type ServerId = typeof ServerId.Type;

export const LOCAL_SERVER_ID: ServerId = "local";

export const RemoteServer = Schema.Struct({
  id: RemoteServerId,
  name: Schema.NonEmptyTrimmedString,
  url: Schema.NonEmptyTrimmedString,
  authToken: Schema.String,
  sortOrder: Schema.Number,
});
export type RemoteServer = typeof RemoteServer.Type;
```

**Step 2: Export from contracts index**

Add to `packages/contracts/src/index.ts`:

```typescript
export * from "./remoteServer";
```

**Step 3: Add remoteServers to ServerSettings**

In `packages/contracts/src/settings.ts`, add to the `ServerSettings` struct:

```typescript
remoteServers: Schema.Array(RemoteServer).pipe(Schema.withDecodingDefault(() => [])),
```

Import `RemoteServer` from `./remoteServer` at the top of the file.

Also add to `ServerSettingsPatch`:

```typescript
remoteServers: Schema.optionalKey(Schema.Array(RemoteServer)),
```

**Step 4: Verify**

Run: `bun typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/contracts/src/remoteServer.ts packages/contracts/src/index.ts packages/contracts/src/settings.ts
git commit -m "feat: add RemoteServer schema and ServerId type to contracts"
```

---

### Task 2: Add serverId to Store Types

**Files:**

- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/store.ts`

**Step 1: Add serverId to Project, Thread, and SidebarThreadSummary types**

In `apps/web/src/types.ts`, import `ServerId` and `LOCAL_SERVER_ID`:

```typescript
import type { ..., ServerId } from "@t3tools/contracts";
```

Add `serverId: ServerId` to the `Project` interface (after `id`), `Thread` interface (after `projectId`), and `SidebarThreadSummary` interface (after `projectId`).

Re-export `LOCAL_SERVER_ID` for convenience:

```typescript
export { LOCAL_SERVER_ID } from "@t3tools/contracts";
```

**Step 2: Update mapProject and mapThread in store.ts**

In `store.ts`, update `mapProject` to accept an optional `serverId` parameter (default `"local"`):

```typescript
function mapProject(
  project: OrchestrationReadModel["projects"][number],
  serverId: ServerId = LOCAL_SERVER_ID,
): Project {
  return {
    id: project.id,
    serverId,
    name: project.title,
    // ... rest unchanged
  };
}
```

Apply the same pattern to `mapThread` and `buildSidebarThreadSummary` - pass through `serverId`.

**Step 3: Update syncServerReadModel to accept serverId**

Change `syncServerReadModel` to merge rather than replace when a serverId is given:

```typescript
export function syncServerReadModel(
  state: AppState,
  readModel: OrchestrationReadModel,
  serverId: ServerId = LOCAL_SERVER_ID,
): AppState {
  const newProjects = readModel.projects
    .filter((project) => project.deletedAt === null)
    .map((p) => mapProject(p, serverId));
  const newThreads = readModel.threads
    .filter((thread) => thread.deletedAt === null)
    .map((t) => mapThread(t, serverId));

  // Remove old data for this server, then merge new
  const otherProjects = state.projects.filter((p) => p.serverId !== serverId);
  const otherThreads = state.threads.filter((t) => t.serverId !== serverId);

  const projects = [...otherProjects, ...newProjects];
  const threads = [...otherThreads, ...newThreads];
  const sidebarThreadsById = buildSidebarThreadsById(threads);
  const threadIdsByProjectId = buildThreadIdsByProjectId(threads);

  return {
    ...state,
    projects,
    threads,
    sidebarThreadsById,
    threadIdsByProjectId,
    bootstrapComplete: true,
  };
}
```

**Step 4: Update applyOrchestrationEvent to tag with serverId**

Add `serverId` parameter to `applyOrchestrationEvent`. In the `project.created` case, set `serverId` on the new project. In `thread.created`, set `serverId` on the new thread. For other events that don't create entities, no change needed since the serverId is already on the existing entity.

Update the Zustand store interface and `useStore` accordingly:

```typescript
syncServerReadModel: (readModel: OrchestrationReadModel, serverId?: ServerId) => void;
applyOrchestrationEvent: (event: OrchestrationEvent, serverId?: ServerId) => void;
applyOrchestrationEvents: (events: ReadonlyArray<OrchestrationEvent>, serverId?: ServerId) => void;
```

**Step 5: Verify**

Run: `bun typecheck`
Expected: PASS (some call sites may need updating - fix any remaining type errors)

**Step 6: Commit**

```bash
git add apps/web/src/types.ts apps/web/src/store.ts
git commit -m "feat: add serverId to Project, Thread, and store functions"
```

---

### Task 3: ServerConnectionRegistry

**Files:**

- Create: `apps/web/src/rpc/serverConnectionRegistry.ts`
- Modify: `apps/web/src/rpc/wsConnectionState.ts`

**Step 1: Create per-server connection state**

In `apps/web/src/rpc/wsConnectionState.ts`, make the connection state per-server. Add a new `serverConnectionStatusAtoms` map and factory function:

```typescript
import type { ServerId } from "@t3tools/contracts";

const serverConnectionStatusAtoms = new Map<ServerId, typeof wsConnectionStatusAtom>();

export function getOrCreateServerConnectionStatusAtom(serverId: ServerId) {
  let atom = serverConnectionStatusAtoms.get(serverId);
  if (!atom) {
    atom = Atom.make(INITIAL_WS_CONNECTION_STATUS).pipe(
      Atom.keepAlive,
      Atom.withLabel(`ws-connection-status-${serverId}`),
    );
    serverConnectionStatusAtoms.set(serverId, atom);
  }
  return atom;
}
```

Add server-scoped variants of the record functions that take a `serverId` parameter and operate on the correct atom. Keep the existing global functions working for backwards compatibility (they delegate to `"local"`).

**Step 2: Create the ServerConnectionRegistry**

Create `apps/web/src/rpc/serverConnectionRegistry.ts`:

```typescript
import type { RemoteServer, ServerId } from "@t3tools/contracts";
import { LOCAL_SERVER_ID } from "@t3tools/contracts";
import { WsTransport } from "../wsTransport";
import { createWsRpcClient, type WsRpcClient } from "../wsRpcClient";
import { resolveServerUrl } from "../lib/utils";
import {
  getOrCreateServerConnectionStatusAtom,
  type WsConnectionStatus,
} from "./wsConnectionState";
import { appAtomRegistry } from "./atomRegistry";

interface ServerConnection {
  readonly serverId: ServerId;
  readonly client: WsRpcClient;
  readonly transport: WsTransport;
  readonly label: string;
}

class ServerConnectionRegistryImpl {
  private connections = new Map<ServerId, ServerConnection>();

  connectLocal(): WsRpcClient {
    if (this.connections.has(LOCAL_SERVER_ID)) {
      return this.connections.get(LOCAL_SERVER_ID)!.client;
    }
    const transport = new WsTransport();
    const client = createWsRpcClient(transport);
    this.connections.set(LOCAL_SERVER_ID, {
      serverId: LOCAL_SERVER_ID,
      client,
      transport,
      label: "Local",
    });
    return client;
  }

  connectRemote(server: RemoteServer): WsRpcClient {
    if (this.connections.has(server.id)) {
      return this.connections.get(server.id)!.client;
    }
    const url = resolveServerUrl({
      url: server.url,
      protocol: server.url.startsWith("https") ? "wss" : "ws",
      pathname: "/ws",
    });
    const transport = new WsTransport(url);
    const client = createWsRpcClient(transport);
    this.connections.set(server.id, {
      serverId: server.id,
      client,
      transport,
      label: server.name,
    });
    return client;
  }

  async disconnect(serverId: ServerId): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) return;
    this.connections.delete(serverId);
    await connection.client.dispose();
  }

  getClient(serverId: ServerId): WsRpcClient | undefined {
    return this.connections.get(serverId)?.client;
  }

  getConnectionStatus(serverId: ServerId): WsConnectionStatus {
    const atom = getOrCreateServerConnectionStatusAtom(serverId);
    return appAtomRegistry.get(atom);
  }

  isConnected(serverId: ServerId): boolean {
    return this.connections.has(serverId);
  }

  getAllServerIds(): ServerId[] {
    return [...this.connections.keys()];
  }

  async disposeAll(): Promise<void> {
    const ids = [...this.connections.keys()];
    await Promise.all(ids.map((id) => this.disconnect(id)));
  }
}

export const serverConnectionRegistry = new ServerConnectionRegistryImpl();
```

**Step 3: Verify**

Run: `bun typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/src/rpc/serverConnectionRegistry.ts apps/web/src/rpc/wsConnectionState.ts
git commit -m "feat: add ServerConnectionRegistry for multi-server connections"
```

---

### Task 4: Wire Registry into App Bootstrap

**Files:**

- Modify: `apps/web/src/wsNativeApi.ts`
- Modify: `apps/web/src/nativeApi.ts`
- Modify: `apps/web/src/routes/__root.tsx`

**Step 1: Make NativeApi server-aware**

Update `createWsNativeApi()` in `wsNativeApi.ts` to use the registry's local client instead of the global singleton:

```typescript
import { serverConnectionRegistry } from "./rpc/serverConnectionRegistry";

export function createWsNativeApi(): NativeApi {
  if (instance) return instance.api;

  const rpcClient = serverConnectionRegistry.connectLocal();
  // ... rest stays the same, using rpcClient
}
```

Keep the existing `getWsRpcClient()` function working but have it delegate to the registry internally for backwards compatibility during migration.

**Step 2: Add multi-server bootstrap to \_\_root.tsx**

In the root route's bootstrap logic, after the local server connects and bootstraps, read `remoteServers` from the server config and connect each one:

```typescript
// After local bootstrap completes:
const serverConfig = getServerConfig();
if (serverConfig?.settings.remoteServers) {
  for (const remoteServer of serverConfig.settings.remoteServers) {
    bootstrapRemoteServer(remoteServer);
  }
}
```

Create a `bootstrapRemoteServer` function that:

1. Connects via `serverConnectionRegistry.connectRemote(server)`
2. Calls `getSnapshot()` on the remote client
3. Calls `store.syncServerReadModel(readModel, server.id)`
4. Subscribes to `onDomainEvent` with the remote client, tagging events with `server.id`

**Step 3: Verify**

Run: `bun typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/src/wsNativeApi.ts apps/web/src/nativeApi.ts apps/web/src/routes/__root.tsx
git commit -m "feat: wire ServerConnectionRegistry into app bootstrap"
```

---

### Task 5: Server Badge in Sidebar

**Files:**

- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/store.ts` (if needed for server name lookup)

**Step 1: Add server name lookup**

Add a helper to the store or a new hook that resolves `serverId` to a display name. For `"local"` return nothing (no badge), for remote servers look up the name from server config's `remoteServers` array.

```typescript
export function useServerDisplayName(serverId: ServerId): string | null {
  const serverConfig = useServerConfig();
  if (serverId === LOCAL_SERVER_ID) return null;
  const remote = serverConfig?.settings.remoteServers?.find((s) => s.id === serverId);
  return remote?.name ?? "Remote";
}
```

**Step 2: Add badge to sidebar project items**

In `Sidebar.tsx`, find the project name rendering in the sidebar project item. After the project name, conditionally render a small badge:

```tsx
{
  serverDisplayName && (
    <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
      {serverDisplayName}
    </span>
  );
}
```

**Step 3: Add offline dimming**

Use the connection status for the project's `serverId` to conditionally apply opacity:

```tsx
const isServerOnline = useIsServerConnected(project.serverId);
// ...
<div className={cn("...", !isServerOnline && "pointer-events-none opacity-40")}>
```

**Step 4: Verify visually**

Start the dev server and verify that local projects show no badge and the sidebar renders correctly.

**Step 5: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx
git commit -m "feat: add server badges and offline dimming to sidebar"
```

---

### Task 6: Servers Settings Tab

**Files:**

- Modify: `apps/web/src/components/settings/SettingsPanels.tsx`

**Step 1: Add "Servers" tab to the settings panel**

Add a new tab option to the settings tabs list (after the existing tabs). Create a `ServersSettingsPanel` component within the file:

```tsx
function ServersSettingsPanel() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const remoteServers = settings.remoteServers ?? [];
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const addServer = (server: { name: string; url: string; authToken: string }) => {
    const newServer = {
      id: crypto.randomUUID(),
      name: server.name,
      url: server.url,
      authToken: server.authToken,
      sortOrder: remoteServers.length,
    };
    updateSettings({
      remoteServers: [...remoteServers, newServer],
    });
    setIsAdding(false);
  };

  const removeServer = (id: string) => {
    updateSettings({
      remoteServers: remoteServers.filter((s) => s.id !== id),
    });
    // Also disconnect
    serverConnectionRegistry.disconnect(id);
  };

  // Render: list of servers with status dots, add form, edit/delete actions
}
```

**Step 2: Add server form component**

Create an inline form with Name, URL, and Auth Token fields. Use the existing Input and Button components from the UI library.

**Step 3: Add connection status dot**

For each server entry, show a small colored dot indicating connection status:

- Green: connected
- Red: disconnected/error
- Yellow: connecting/reconnecting

Use `useIsServerConnected` or read the connection status atom.

**Step 4: Verify visually**

Open settings in the dev app and verify the new Servers tab renders with an empty list and working "Add Server" form.

**Step 5: Commit**

```bash
git add apps/web/src/components/settings/SettingsPanels.tsx
git commit -m "feat: add Servers settings tab for managing remote servers"
```

---

### Task 7: Server Dropdown in New Project Dialog

**Files:**

- Modify: `apps/web/src/components/Sidebar.tsx`

**Step 1: Add server picker to project creation flow**

In the sidebar's project creation area (where the folder path input is), add a Select dropdown above it that lists available servers:

- "Local" (default)
- Each configured remote server by name

**Step 2: Route project creation to correct server**

When a server other than local is selected, dispatch the `project.create` command through that server's RPC client instead of the local one:

```typescript
const client =
  serverId === LOCAL_SERVER_ID ? ensureNativeApi() : serverConnectionRegistry.getClient(serverId);

// Dispatch project.create through the appropriate client
```

Disable the folder picker button when a remote server is selected (manual path entry only).

**Step 3: Verify**

Open sidebar, try creating a project with local selected (should work as before).

**Step 4: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx
git commit -m "feat: add server picker to new project dialog"
```

---

### Task 8: Connection Status Header Extension

**Files:**

- Modify: `apps/web/src/components/chat/ChatHeader.tsx` (or wherever the connection indicator lives)

**Step 1: Find the existing connection indicator**

Locate the component that shows the current connection status in the header.

**Step 2: Extend for multi-server awareness**

Show a warning icon when any remote server is offline. On hover, show a tooltip listing each server and its status:

```
Local: Connected
Production: Connected
Staging: Offline - reconnecting...
```

**Step 3: Verify visually**

Check that the header shows correct status for local-only setup (no change from current behavior).

**Step 4: Commit**

```bash
git add apps/web/src/components/chat/ChatHeader.tsx
git commit -m "feat: extend connection status header for multi-server"
```

---

### Task 9: React to Server Config Changes

**Files:**

- Modify: `apps/web/src/routes/__root.tsx`

**Step 1: Watch for remoteServers config changes**

Subscribe to server config changes. When `remoteServers` changes:

- Connect to newly added servers
- Disconnect from removed servers
- Update connection for servers whose URL/token changed

**Step 2: Clean up on unmount**

Ensure all remote server connections are disposed when the app unmounts.

**Step 3: Verify**

Add a remote server via settings, verify it connects and projects appear. Remove it, verify it disconnects and projects disappear.

**Step 4: Commit**

```bash
git add apps/web/src/routes/__root.tsx
git commit -m "feat: react to remote server config changes dynamically"
```

---

### Task 10: Final Verification

**Step 1: Run all checks**

```bash
bun fmt
bun lint
bun typecheck
bun run test
```

**Step 2: Fix any issues found**

**Step 3: Manual testing**

1. Start dev server
2. Verify local projects work as before (no badge)
3. Open Settings > Servers, add a server (can be a second local instance on a different port)
4. Verify remote projects appear with badge
5. Stop the remote server, verify projects grey out
6. Restart the remote server, verify reconnection
7. Create a project on the remote server via the dropdown
8. Remove the remote server from settings, verify cleanup

**Step 4: Final commit**

```bash
git commit -m "feat: multi-server support complete"
```

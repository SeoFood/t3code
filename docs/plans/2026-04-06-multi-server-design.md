# Multi-Server Support

Connect to multiple T3 Code servers from a single app instance - local and remote projects side by side.

## Data Model

### RemoteServer Schema (contracts)

New schema in `packages/contracts/src/remoteServer.ts`:

```typescript
RemoteServer {
  id: RemoteServerId    // UUID
  name: string          // e.g. "Production", "Staging"
  url: string           // WebSocket URL
  authToken: string     // Auth token
  sortOrder: number     // Position in list
}
```

### ServerId Convention

- Local server: `serverId = "local"` (implicit, always present)
- Remote servers: `serverId = <UUID>` from RemoteServer config

### Storage

Remote server configurations stored in `ServerSettings` (`settings.json` on local server) as a new field `remoteServers: RemoteServer[]`.

### Store Extensions

All Projects, Threads, and SidebarThreadSummary gain a `serverId: ServerId` field. Existing indices (`threadIdsByProjectId`, `sidebarThreadsById`) remain unchanged since UUIDs don't collide across servers.

## Connection Layer

### ServerConnectionRegistry

New module `apps/web/src/rpc/serverConnectionRegistry.ts` replaces the global `getWsRpcClient()` singleton:

```
ServerConnectionRegistry
  +-- "local"  -> WsTransport + RpcClient
  +-- "uuid-1" -> WsTransport + RpcClient (Production)
  +-- "uuid-2" -> WsTransport + RpcClient (Staging)
```

API:

- `connect(server)` - create transport + client for a server
- `disconnect(serverId)` - tear down connection and clean up
- `getClient(serverId)` - return RpcClient for a server
- `getConnectionStatus(serverId)` - Atom per server for status tracking

### Event Streams

Each server gets its own:

- Domain event subscription (`onDomainEvent`)
- `OrchestrationRecoveryCoordinator` instance
- Independent retry logic (one server going offline doesn't affect others)

### Bootstrap

On app start, all configured servers connect in parallel. `syncServerReadModel(serverId, readModel)` is called per server, merging results into the shared store. `applyOrchestrationEvent()` receives events with server context and tags them with `serverId`.

### Refactoring

The existing `getWsRpcClient()` singleton is replaced by the registry. All call sites that use the client receive `serverId` as a parameter.

## UI Changes

### Settings - New "Servers" Tab

- List of all remote servers with name, URL, status dot (green/red)
- "Add Server" button opens form (name, URL, auth token)
- Inline edit and delete per server entry
- Local server is not listed (implicit, always present)

### Sidebar

- Projects show a small badge after the name: `my-project` `prod`
- Badge color correlates with connection status (normal = connected, dimmed = offline)
- Projects of an offline server: name + badge greyed out, threads visible but not clickable
- Sorting mixes all servers - sorted by chosen criterion (updated_at etc.) across servers
- Flat list, no grouping by server

### New Project Dialog

- New "Server" dropdown above the path input, default: "Local"
- Folder picker only available for local server; remote requires manual path input

### Connection Status Header

- Existing connection indicator extended: shows warning when at least one server is offline
- Hover/tooltip shows per-server status

## Offline Behavior

When a server disconnects:

- Its projects and threads remain in the store
- They are rendered greyed out based on connection status
- Threads are visible but not interactable
- Reconnect runs independently per server with existing retry logic

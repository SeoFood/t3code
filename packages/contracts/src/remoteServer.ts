import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas";

export const RemoteServerId = TrimmedNonEmptyString.pipe(Schema.brand("RemoteServerId"));
export type RemoteServerId = typeof RemoteServerId.Type;

export const ServerId = Schema.Union([Schema.Literal("local"), RemoteServerId]);
export type ServerId = typeof ServerId.Type;

export const LOCAL_SERVER_ID: ServerId = "local";

export const RemoteServer = Schema.Struct({
  id: RemoteServerId,
  name: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  authToken: Schema.String,
  sortOrder: Schema.Number,
});
export type RemoteServer = typeof RemoteServer.Type;

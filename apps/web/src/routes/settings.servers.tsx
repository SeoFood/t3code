import { createFileRoute } from "@tanstack/react-router";

import { ServersSettingsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/servers")({
  component: ServersSettingsPanel,
});

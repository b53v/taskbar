import { For, createComputed, Accessor } from "ags";
import { compositor } from "utils/compositor/detector";
import { Client } from "utils/compositor/types";
import { getAppIcon } from "utils/clients";
import { Gdk } from "ags/gtk4";
import Gio from "gi://Gio?version=2.0";

interface ClientButtonProps {
  client: Accessor<Client | undefined>;
}

function ClientButton({ client }: ClientButtonProps) {
  const iconName = client((c) => getAppIcon(c?.class || "", true));

  return (
    <button
      cssClasses={client((c) => c?.focused ? ["client-button", "focused"] : ["client-button"])}
      onClicked={() => {
        const current = client.get();
        if (!current || current.focused) return;

        if (compositor.focusClient) {
          try {
            compositor.focusClient(current.address);
          } catch (e) {
            console.error("Failed to focus client:", e);
          }
        } else {
          const focusedWorkspace = compositor.focusedWorkspace.get();
          if (focusedWorkspace?.id !== current.workspace) {
            try {
              compositor.focusWorkspace(current.workspace);
            } catch (e) {
              console.error("Failed to focus workspace:", e);
            }
          }
        }
      }}
      tooltipText={client((c) => c?.title || c?.class || "")}
    >
      <image gicon={iconName((icon) => Gio.icon_new_for_string(icon))} cssClasses={["client-icon"]} />
    </button>
  );
}

interface ClientsContainerProps {
  gdkmonitor?: Gdk.Monitor;
}

export function Clients({ gdkmonitor }: ClientsContainerProps = {}) {
  const monitorName = gdkmonitor?.get_connector() || null;

  const clients = createComputed(
    [compositor.clients],
    (clients) => {
      const filteredClients = monitorName
        ? clients.filter((c) => c.monitor === monitorName)
        : [...clients];

      const sorted = filteredClients.sort(
        (a, b) => Number(a.workspace) - Number(b.workspace),
      );

      return sorted;
    },
  );

  return (
    <box cssClasses={["Clients"]}>
      <For each={clients((list) => list.map((client) => client.address))}>
        {(address) => (
          <ClientButton client={clients((list) => list.find((client) => client.address === address))} />
        )}
      </For>
    </box>
  );
}

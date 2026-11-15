import { Gdk } from "ags/gtk4";
import app from "ags/gtk4/app";
import GObject, { register } from "ags/gobject";
import { createBinding, createComputed, Accessor } from "ags";
import { CompositorAdapter, Monitor, Workspace, Client } from "./types";

// Lazy import
// Type as any since we cant import Hyprland.Hyprland directly
let Hyprland: any = null;
function getHyprland() {
  if (Hyprland !== null) return Hyprland;

  try {
    Hyprland = (globalThis as any).imports.gi.AstalHyprland;
    return Hyprland;
  } catch (error) {
    throw new Error("AstalHyprland library not installed");
  }
}

// Create a unified reactive interface of compositor data to use in components
@register({ GTypeName: "HyprlandAdapter" })
export class HyprlandAdapter
  extends GObject.Object
  implements CompositorAdapter
{
  readonly name = "hyprland";
  // Type as any since we cant import Hyprland.Hyprland directly
  readonly hyprland: any;

  readonly focusedMonitor: Accessor<Monitor | null>;
  readonly monitors: Accessor<Monitor[]>;
  readonly focusedWorkspace: Accessor<Workspace | null>;
  readonly workspaces: Accessor<Workspace[]>;
  readonly focusedClient: Accessor<Client | null>;
  readonly clients: Accessor<Client[]>;

  constructor() {
    super();

    try {
      const HyprlandModule = getHyprland();
      this.hyprland = HyprlandModule.get_default();
    } catch (error) {
      throw new Error("Hyprland not available");
    }

    this.focusedMonitor = createBinding(
      this.hyprland,
      "focused-monitor",
    )((monitor: any | null): Monitor | null => {
      if (!monitor) return null;
      return {
        name: monitor.get_name(),
        width: monitor.get_width(),
        height: monitor.get_height(),
        x: monitor.get_x(),
        y: monitor.get_y(),
        focused: true,
        scale: monitor.get_scale(),
      };
    });

    this.monitors = createBinding(
      this.hyprland,
      "monitors",
    )((monitors: any[]): Monitor[] => {
      return monitors.map((m) => ({
        name: m.get_name(),
        width: m.get_width(),
        height: m.get_height(),
        x: m.get_x(),
        y: m.get_y(),
        focused: m.get_focused(),
        scale: m.get_scale(),
      }));
    });

    const focusedWorkspace = createBinding(
      this.hyprland,
      "focused-workspace",
    );
    this.focusedWorkspace = createComputed((): Workspace | null => {
      const workspace = focusedWorkspace();
      if (!workspace) return null;
      return {
        id: workspace.get_id(),
        name: workspace.get_name(),
        focused: true,
        occupied: createBinding(workspace, "clients")().length > 0,
        monitor: createBinding(workspace, "monitor")()?.get_name() || "",
      };
    });

    const workspaces = createBinding(
      this.hyprland,
      "workspaces",
    );
    this.workspaces = createComputed((): Workspace[] => {
      const focused = focusedWorkspace();
      return workspaces().map((ws: any) => ({
        id: ws.get_id(),
        name: ws.get_name(),
        focused: ws === focused,
        occupied: createBinding(ws, "clients")().length > 0,
        monitor: createBinding(ws, "monitor")()?.get_name() || "",
      }));
    });

    const focusedClient = createBinding(
      this.hyprland,
      "focused-client",
    );
    const snapshotClient = (client: any, focused: any): Client => ({
      address: client.get_address(),
      title: createBinding(client, "title")(),
      class: createBinding(client, "class")(),
      workspace: createBinding(client, "workspace")()?.get_id() || 0,
      monitor: createBinding(client, "monitor")()?.get_name() || "",
      floating: createBinding(client, "floating")(),
      fullscreen: createBinding(client, "fullscreen")() !== 0,
      focused: client === focused,
    });
    this.focusedClient = createComputed((): Client | null => {
      const client = focusedClient();
      if (!client) return null;
      return snapshotClient(client, client);
    });

    const clients = createBinding(this.hyprland, "clients");
    this.clients = createComputed((): Client[] => {
      const focused = focusedClient();
      return clients().map((client: any) => snapshotClient(client, focused));
    });
  }

  isAvailable(): boolean {
    try {
      return !!this.hyprland;
    } catch {
      return false;
    }
  }

  focusWorkspace(id: string | number): void {
    this.hyprland.dispatch("workspace", String(id));
  }

  focusClient(address: string): void {
    try {
      this.hyprland.dispatch("focuswindow", `address:0x${address.replace(/^0x/, "")}`);
    } catch (e) {
      console.error("Failed to focus client:", e);
    }
  }

  matchMonitor(compositorMonitor: Monitor): Gdk.Monitor | null {
    const monitors = app.get_monitors();
    if (!monitors || monitors.length === 0) return null;

    for (let gdkmonitor of monitors) {
      if (
        compositorMonitor &&
        gdkmonitor &&
        compositorMonitor.name === gdkmonitor.get_connector()
      ) {
        return gdkmonitor;
      }
    }

    return monitors.length > 0 ? monitors[0] : null;
  }
}

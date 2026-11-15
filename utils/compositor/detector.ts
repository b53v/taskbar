import { CompositorAdapter } from "./types";
import GLib from "gi://GLib?version=2.0";

async function detectCompositor(): Promise<CompositorAdapter> {
  if (GLib.getenv("HYPRLAND_INSTANCE_SIGNATURE")) {
    const { HyprlandAdapter } = await import("./hyprland");
    console.log("Detected running compositor via HYPRLAND_INSTANCE_SIGNATURE: hyprland");
    return new HyprlandAdapter();
  }

  const adapterFactories = [
    async () => {
      const { HyprlandAdapter } = await import("./hyprland");
      return new HyprlandAdapter();
    },
  ];

  for (const createAdapter of adapterFactories) {
    try {
      const adapter = await createAdapter();
      if (adapter.isAvailable()) {
        console.log(`Detected compositor: ${adapter.name}`);
        return adapter;
      }
    } catch (error) {
      continue;
    }
  }

  throw new Error(
    "No supported compositor detected. Make sure you're running Hyprland.",
  );
}

export const compositor = await detectCompositor();

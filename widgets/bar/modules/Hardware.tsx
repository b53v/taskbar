// widgets/bar/modules/Hardware.tsx
import { Gtk } from "ags/gtk4";
import { createBinding, createComputed, onCleanup } from "ags";
import { execAsync } from "ags/process";
import SystemMonitor from "utils/sysmon";
import options from "options";
import GLib from "gi://GLib?version=2.0";

export default function Hardware() {
  const sysmon = SystemMonitor.get_default();

  const openMonitor = () => {
    const command = options["app.resource-monitor"].get();
    try {
      const [, argv] = GLib.shell_parse_argv(command);
      if (argv?.[0] && GLib.find_program_in_path(argv[0])) {
        void execAsync(command).catch(console.error);
      } else {
        // Keep the existing btop fallback when the configured app is absent.
        void execAsync(["kitty", "--class", "btop", "--title", "btop", "-e", "btop"]).catch(console.error);
      }
    } catch (error) {
      console.error("Invalid resource monitor command:", error);
    }
  };

  const cpuUsage = createBinding(sysmon.cpu, "usagePercent")(
    (usage) => `${usage}%`,
  );
  const cpuTemp = createBinding(sysmon.cpu, "temperature")((temp) =>
    temp > 0 ? `${Math.round(temp)}°C` : "",
  );

  const cpuTooltip = createComputed(
    [
      createBinding(sysmon.cpu, "usagePercent"),
      createBinding(sysmon.cpu, "temperature"),
      createBinding(sysmon.cpu, "frequency"),
    ],
    (usage, temp, freq) =>
      `CPU: ${usage}%\nTemperature: ${temp > 0 ? `${Math.round(temp)}°C` : "N/A"}\nFrequency: ${freq} MHz\n\nClick to open resource monitor`,
  );

  const ramText = createBinding(sysmon.memory, "usagePercent")((p) => `${p}%`);

  const ramTooltip = createComputed(
    [
      createBinding(sysmon.memory, "used"),
      createBinding(sysmon.memory, "total"),
      createBinding(sysmon.memory, "usagePercent"),
    ],
    (used, total, p) => `RAM: ${used} / ${total} (${p}%)\n\nClick to open resource monitor`,
  );

  const gpuUsage = createBinding(sysmon.gpu, "utilizationPercent")(
    (usage) => `${usage}%`,
  );
  const gpuTemp = createBinding(sysmon.gpu, "temperature")((temp) =>
    temp > 0 ? `${Math.round(temp)}°C` : "",
  );

  const gpuTooltip = createComputed(
    [
      createBinding(sysmon.gpu, "utilizationPercent"),
      createBinding(sysmon.gpu, "temperature"),
      createBinding(sysmon.gpu, "memoryUsedFormatted"),
      createBinding(sysmon.gpu, "memoryTotalFormatted"),
    ],
    (util, temp, used, total) =>
      `GPU: ${util}%\nTemperature: ${temp > 0 ? `${Math.round(temp)}°C` : "N/A"}\nVRAM: ${used} / ${total}\n\nClick to open resource monitor`,
  );

  return (
    <box
      cssClasses={["bar-hardware", "module"]}
      spacing={4}
      $={(self) => {
        let release: (() => void) | null = null;
        const mapped = self.connect("map", () => { release ??= sysmon.retainCore(); });
        const unmapped = self.connect("unmap", () => { release?.(); release = null; });
        onCleanup(() => {
          self.disconnect(mapped);
          self.disconnect(unmapped);
          release?.();
        });
      }}
    >
      <button
        cssClasses={["bar-hw-item", "cpu"]}
        valign={Gtk.Align.CENTER}
        tooltipText={cpuTooltip}
        onClicked={openMonitor}
      >
        <box spacing={4}>
          <label label="" valign={Gtk.Align.CENTER} cssClasses={["hw-icon"]} />
          <label label={cpuUsage} valign={Gtk.Align.CENTER} cssClasses={["hw-val"]} />
          <label label={cpuTemp} valign={Gtk.Align.CENTER} cssClasses={["hw-temp"]} />
        </box>
      </button>

      <button
        cssClasses={["bar-hw-item", "ram"]}
        valign={Gtk.Align.CENTER}
        tooltipText={ramTooltip}
        onClicked={openMonitor}
      >
        <box spacing={4}>
          <label label="" valign={Gtk.Align.CENTER} cssClasses={["hw-icon"]} />
          <label label={ramText} valign={Gtk.Align.CENTER} cssClasses={["hw-val"]} />
        </box>
      </button>

      {sysmon.gpu.detected && (
        <button
          cssClasses={["bar-hw-item", "gpu"]}
          valign={Gtk.Align.CENTER}
          tooltipText={gpuTooltip}
          onClicked={openMonitor}
        >
          <box spacing={4}>
            <label label="󰢮" valign={Gtk.Align.CENTER} cssClasses={["hw-icon"]} />
            <label label={gpuUsage} valign={Gtk.Align.CENTER} cssClasses={["hw-val"]} />
            <label label={gpuTemp} valign={Gtk.Align.CENTER} cssClasses={["hw-temp"]} />
          </box>
        </button>
      )}
    </box>
  );
}

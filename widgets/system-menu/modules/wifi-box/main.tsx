import app from "ags/gtk4/app";
import { Gtk } from "ags/gtk4";
import Pango from "gi://Pango";
import { createBinding, createComputed, createState, For, onCleanup, With } from "ags";
import { execAsync } from "ags/process";
import { interval } from "ags/time";
import Network from "gi://AstalNetwork";
import { NetworkItem } from "./modules/NetworkItem.tsx";
import { PasswordDialog } from "./modules/PasswordDialog.tsx";
import {
  availableNetworks,
  savedNetworks,
  activeNetwork,
  showPasswordDialog,
  setShowPasswordDialog,
  setErrorMessage,
  scanTimer,
  setScanTimer,
  scanNetworks,
  getSavedNetworks,
  disconnectNetwork,
  forgetNetwork,
} from "utils/wifi";
import options from "options.ts";

// Main WiFi Box component
export const WiFiBox = () => {
  const network = Network.get_default();
  const [isExpanded, setIsExpanded] = createState(false);
  const [mounted, setMounted] = createState(false);
  let unmountTimer: ReturnType<typeof setTimeout> | null = null;

  const stopScanning = () => {
    scanTimer.get()?.cancel();
    setScanTimer(null);
  };

  const setOpen = (open: boolean) => {
    if (unmountTimer) {
      clearTimeout(unmountTimer);
      unmountTimer = null;
    }

    if (open) {
      setMounted(true);
      setIsExpanded(true);
    } else {
      setIsExpanded(false);
      stopScanning();
      setShowPasswordDialog(false);
      setErrorMessage("");
      unmountTimer = setTimeout(() => {
        unmountTimer = null;
        if (!isExpanded.get()) setMounted(false);
      }, 200);
    }
  };

  const filteredSavedNetworks = createComputed(
    [savedNetworks, availableNetworks],
    (saved, available) => {
      const visibleSsids = new Set(available.map((n) => n.ssid));
      return saved.filter((ssid) => !visibleSsids.has(ssid));
    },
  );

  return (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      cssClasses={["wifi-menu", "toggle"]}
    >
      {/* WiFi Toggle Header */}
      <box cssClasses={["toggle", "wifi-toggle"]}>
        <button
          onClicked={() => {
            const next = !network.wifi.enabled;
            network.wifi.set_enabled(next);
            if (!next && isExpanded.get()) {
              setOpen(false);
            }
          }}
          cssClasses={createBinding(
            network.wifi,
            "enabled",
          )((enabled) => (enabled ? ["button"] : ["button-disabled"]))}
        >
          <image iconName={createBinding(network.wifi, "icon_name")} />
        </button>
        <button
          hexpand={true}
          onClicked={() => {
            if (network.wifi.enabled) {
              setOpen(!isExpanded.get());
            }
          }}
        >
          <box hexpand={true}>
            <label
              hexpand={true}
              xalign={0}
              ellipsize={Pango.EllipsizeMode.END}
              label={createBinding(
                network.wifi,
                "ssid",
              )(
                (ssid) =>
                  ssid || (network.wifi.enabled ? "Not Connected" : "WiFi Off"),
              )}
            />
            <image
              iconName="pan-end-symbolic"
              halign={Gtk.Align.END}
              cssClasses={isExpanded((expanded) =>
                expanded
                  ? ["arrow-indicator", "arrow-down"]
                  : ["arrow-indicator"],
              )}
            />
          </box>
        </button>
      </box>

      <revealer
        transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
        transitionDuration={180}
        revealChild={isExpanded}
        $={() => {
          const unsubscribeExpanded = isExpanded.subscribe(() => {
            const expanded = isExpanded.get();
            stopScanning();

            if (expanded && network.wifi?.enabled) {
              scanNetworks();
              getSavedNetworks();
              const newTimer = interval(10000, () => {
                if (isExpanded.get() && network.wifi?.enabled) {
                  scanNetworks();
                  getSavedNetworks();
                } else {
                  stopScanning();
                }
              });
              setScanTimer(newTimer);
            }
          });

          const enabledListener = network.wifi.connect("notify::enabled", () => {
            if (!network.wifi.enabled && isExpanded.get()) {
              setOpen(false);
            }
          });

          const windowListener = app.connect("window-toggled", (_, window) => {
            if (
              window.name === "system-menu" &&
              !window.visible &&
              isExpanded.get()
            ) {
              setOpen(false);
            }
          });

          onCleanup(() => {
            if (unmountTimer) {
              clearTimeout(unmountTimer);
              unmountTimer = null;
            }
            stopScanning();
            network.wifi.disconnect(enabledListener);
            app.disconnect(windowListener);
            unsubscribeExpanded();
          });
        }}
      >
        <box orientation={Gtk.Orientation.VERTICAL}>
          <With value={mounted}>
            {(isMounted) =>
              isMounted ? (
                <box
                  orientation={Gtk.Orientation.VERTICAL}
                  cssClasses={["system-menu-list"]}
                >
                  {/* Password Dialog */}
                  <box visible={showPasswordDialog}>
                    <PasswordDialog />
                  </box>

                  {/* Available Networks */}
                  <box orientation={Gtk.Orientation.VERTICAL}>
                    <label
                      label="Available Networks"
                      xalign={0}
                      cssClasses={["section-label"]}
                    />

                    {/* Empty state container */}
                    <box
                      visible={availableNetworks(
                        (networks) => networks.length === 0,
                      )}
                    >
                      <label
                        label="No networks found"
                        cssClasses={["empty-label"]}
                        halign={Gtk.Align.CENTER}
                        hexpand
                      />
                    </box>

                    {/* Networks list container */}
                    <box
                      orientation={Gtk.Orientation.VERTICAL}
                      visible={availableNetworks(
                        (networks) => networks.length > 0,
                      )}
                    >
                      <For each={availableNetworks}>
                        {(net) => <NetworkItem network={net} />}
                      </For>
                    </box>
                  </box>

                  {/* Saved Networks */}
                  <box
                    orientation={Gtk.Orientation.VERTICAL}
                    visible={filteredSavedNetworks((list) => list.length > 0)}
                  >
                    <label
                      label="Saved Networks"
                      xalign={0}
                      cssClasses={["section-label"]}
                    />
                    <For each={filteredSavedNetworks}>
                      {(ssid) => (
                        <box cssClasses={["saved-network"]}>
                          <label
                            label={ssid}
                            ellipsize={Pango.EllipsizeMode.END}
                            xalign={0}
                            hexpand={true}
                          />
                          <button
                            label="Forget"
                            cssClasses={["forget-button", "button"]}
                            onClicked={() => forgetNetwork(ssid)}
                          />
                        </box>
                      )}
                    </For>
                  </box>

                  {/* Controls Container */}
                  <box hexpand>
                    {/* Refresh Button */}
                    <button
                      halign={Gtk.Align.START}
                      cssClasses={["refresh-button"]}
                      onClicked={() => {
                        scanNetworks();
                        getSavedNetworks();
                      }}
                    >
                      <image iconName="view-refresh-symbolic" />
                    </button>

                    {/* Connected Network Options */}
                    <box hexpand>
                      <box
                        orientation={Gtk.Orientation.VERTICAL}
                        cssClasses={["connected-network"]}
                        hexpand
                        visible={activeNetwork((active) => active !== null)}
                      >
                        <button
                          label="Disconnect"
                          cssClasses={["disconnect-button"]}
                          onClicked={() => {
                            const active = activeNetwork.get();
                            if (active) disconnectNetwork(active.ssid);
                          }}
                        />
                      </box>
                    </box>

                    {/* Advanced Settings Button */}
                    <button
                      cssClasses={["settings-button"]}
                      halign={Gtk.Align.END}
                      hexpand={false}
                      visible={
                        options["system-menu.modules.wifi-advanced.enable"]
                      }
                      onClicked={async () => {
                        try {
                          await execAsync([
                            "sh",
                            "-c",
                            options["app.wifi"].get(),
                          ]);
                        } catch (error) {
                          console.error("Error:", error);
                        } finally {
                          setOpen(false);
                        }
                      }}
                    >
                      <image iconName="emblem-system-symbolic" />
                    </button>
                  </box>
                </box>
              ) : null
            }
          </With>
        </box>
      </revealer>
    </box>
  );
};

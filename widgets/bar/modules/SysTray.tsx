import Tray from "gi://AstalTray";
import { Gtk } from "ags/gtk4";
import { For, createBinding, createComputed, createState, onCleanup } from "ags";

const tray = Tray.get_default();
const trayItems = createBinding(tray, "items");

export const hasTrayItems = trayItems((items) => items.length > 0);

function SysTrayItem({ item }: { item: Tray.TrayItem }) {
  return (
    <menubutton
      cssClasses={["tray-item"]}
      valign={Gtk.Align.CENTER}
      tooltipMarkup={createBinding(item, "tooltipMarkup")}
      $={(self) => {
        self.set_cursor_from_name("pointer");
        self.menuModel = item.menuModel;
        self.insert_action_group("dbusmenu", item.actionGroup);
        const ids = [
          item.connect("notify::action-group", () => {
            self.insert_action_group("dbusmenu", item.actionGroup);
          }),
          item.connect("notify::menu-model", () => {
            self.menuModel = item.menuModel;
          }),
        ];
        onCleanup(() => ids.forEach((id) => item.disconnect(id)));
      }}
    >
      <image gicon={createBinding(item, "gicon")} />
    </menubutton>
  );
}

export function SysTray() {
  const [expanded, setExpanded] = createState(false);

  const unsubscribeEmpty = trayItems.subscribe(() => {
    if (trayItems.get().length === 0 && expanded.get()) {
      setExpanded(false);
    }
  });
  onCleanup(unsubscribeEmpty);

  const toggleClasses = expanded((isOpen) =>
    isOpen ? ["tray-toggle", "expanded"] : ["tray-toggle"],
  );
  const toggleIcon = expanded((isOpen) =>
    isOpen ? "pan-end-symbolic" : "pan-start-symbolic",
  );
  const toggleTooltip = createComputed(
    [trayItems, expanded],
    (items, isOpen) =>
      `System Tray (${items.length}) — Click to ${isOpen ? "collapse" : "expand"}`,
  );

  return (
    <box
      cssClasses={["SysTray", "module"]}
      visible={hasTrayItems}
      valign={Gtk.Align.CENTER}
    >
      <revealer
        cssClasses={["tray-revealer"]}
        transitionType={Gtk.RevealerTransitionType.SLIDE_LEFT}
        transitionDuration={180}
        revealChild={expanded}
        valign={Gtk.Align.CENTER}
      >
        <box cssClasses={["tray-items"]} valign={Gtk.Align.CENTER}>
          <For each={trayItems}>
            {(item) => <SysTrayItem item={item} />}
          </For>
        </box>
      </revealer>
      <button
        cssClasses={toggleClasses}
        valign={Gtk.Align.CENTER}
        tooltipText={toggleTooltip}
        onClicked={() => setExpanded((isOpen) => !isOpen)}
        $={(self) => {
          self.set_cursor_from_name("pointer");
        }}
      >
        <image iconName={toggleIcon} />
      </button>
    </box>
  );
}

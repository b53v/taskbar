import Tray from "gi://AstalTray";
import { For, createBinding, onCleanup } from "ags";

const tray = Tray.get_default();

export const hasTrayItems = createBinding(
  tray,
  "items",
)((items) => items.length > 0);

function SysTrayItem({ item }) {
  return (
    <menubutton
      cssClasses={["tray-item"]}
      tooltipMarkup={createBinding(item, "tooltipMarkup")}
      $={(self) => {
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
  return (
    <box cssClasses={["SysTray", "module"]}>
      <For each={createBinding(tray, "items")}>
        {(item) => <SysTrayItem item={item} />}
      </For>
    </box>
  );
}

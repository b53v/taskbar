import { Accessor } from "ags";
import { Gtk } from "ags/gtk4";

interface SeparatorProps {
  visible?: boolean | Accessor<boolean>;
}

export default function Separator({ visible = true }: SeparatorProps) {
  return (
    <box
      visible={visible}
      valign={Gtk.Align.CENTER}
      cssClasses={["separator", "module"]}
    />
  );
}

import { OptionChoice } from "./types.ts";

export const OS_OPTIONS: OptionChoice[] = [
  { label: "Arch Linux", value: "arch-symbolic" },
];

export const BAR_POSITION_OPTIONS: OptionChoice[] = [
  { label: "Top", value: "top" },
  { label: "Bottom", value: "bottom" },
];

export const BAR_STYLE_OPTIONS: OptionChoice[] = [
  { label: "Expanded", value: "expanded" },
  { label: "Floating", value: "floating" },
];

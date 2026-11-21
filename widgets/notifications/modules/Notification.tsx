import { Gtk } from "ags/gtk4";
import Adw from "gi://Adw?version=1";
import Pango from "gi://Pango";
import type { Accessor } from "ags";
import { NotificationIcon } from "./Icon.tsx";
import {
  urgency,
  DisplayNotification,
  createNotificationTimeLabel,
} from "utils/notifd";

export interface BaseNotificationProps {
  notification: DisplayNotification;
  onAction?: (id: number, action: string) => void;
  onDismiss?: (id: number) => void;
  onClick?: (button: number, notification: DisplayNotification) => void;
  onHover?: () => void;
  onHoverLost?: () => void;
  variant?: "live" | "stored";
  showDismissButton?: boolean | Accessor<boolean>;
  showTimeAsRelative?: boolean;
  cssClasses?: string[];
  maxWidth?: number;
}

export function BaseNotification({
  notification,
  onAction,
  onDismiss,
  onClick,
  onHover,
  onHoverLost,
  variant = "live",
  showDismissButton = true,
  cssClasses = [],
  maxWidth,
}: BaseNotificationProps) {
  const { START, CENTER, END, FILL } = Gtk.Align;
  const timeLabel = createNotificationTimeLabel(notification.time, { variant });
  const iconWidget = NotificationIcon(notification);
  const appNameText = (notification.appName || "Unknown").trim() || "Unknown";
  const summaryText = (notification.summary || "").trim();
  const bodyText = (notification.body || "").trim();

  // Default click handling (for non-button clicks on the card surface)
  const handleClick = (button: number) => {
    if (onClick) {
      onClick(button, notification);
    } else {
      try {
        switch (button) {
          case 1: // PRIMARY/LEFT
            if (notification.actions.length > 0 && onAction) {
              onAction(notification.id, notification.actions[0].action);
            }
            break;
          case 3: // SECONDARY/RIGHT
            if (onDismiss) {
              onDismiss(notification.id);
            }
            break;
        }
      } catch (error) {
        console.error("Error handling notification click:", error);
      }
    }
  };

  const buildCssClasses = (): string[] => {
    const classes = [
      "base-notification",
      `notification-${variant}`,
      `${urgency(notification)}`,
      ...cssClasses,
      "notification-container",
    ];

    if (variant === "stored") {
      if (notification.seen) classes.push("notification-seen");
      else classes.push("notification-unseen");
      if (notification.dismissed) classes.push("notification-dismissed");
    }

    return classes;
  };

  const dismissVisible =
    typeof showDismissButton === "boolean"
      ? showDismissButton
      : showDismissButton.get();

  const card = (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      cssClasses={buildCssClasses()}
      name={notification.id.toString()}
      hexpand={true}
      halign={FILL}
      $={(self) => {
        const click = new Gtk.GestureClick();
        click.set_button(0);
        click.connect("pressed", (_gesture, _nPress, x, y) => {
          // Do not intercept clicks targeting child buttons (close / action buttons)
          let target = self.pick(x, y, Gtk.PickFlags.DEFAULT);
          while (target && target !== self) {
            if (target instanceof Gtk.Button) return;
            target = target.get_parent();
          }
          handleClick(click.get_current_button());
        });
        self.add_controller(click);

        if (onHover || onHoverLost) {
          const motion = new Gtk.EventControllerMotion();
          if (onHover) motion.connect("enter", onHover);
          if (onHoverLost) motion.connect("leave", onHoverLost);
          self.add_controller(motion);
        }
      }}
    >
      {/* Header */}
      <box cssClasses={["header"]} spacing={6} valign={CENTER} hexpand={true}>
        <label
          cssClasses={["app-name"]}
          halign={START}
          valign={CENTER}
          hexpand={true}
          xalign={0}
          label={appNameText}
          ellipsize={Pango.EllipsizeMode.END}
          singleLineMode={true}
        />
        <label
          cssClasses={["time"]}
          halign={END}
          valign={CENTER}
          singleLineMode={true}
          label={timeLabel}
        />
        {dismissVisible && (
          <button
            cssClasses={["dismiss-button"]}
            halign={END}
            valign={CENTER}
            focusable={false}
            onClicked={() => onDismiss?.(notification.id)}
            tooltipText="Dismiss notification"
          >
            <image iconName="window-close-symbolic" pixelSize={12} />
          </button>
        )}
      </box>

      <Gtk.Separator cssClasses={["notification-separator"]} />

      {/* Content */}
      <box cssClasses={["content"]} spacing={10} valign={START} hexpand={true}>
        {iconWidget && (
          <box cssClasses={["thumb"]} halign={CENTER} valign={START}>
            {iconWidget}
          </box>
        )}

        <box
          orientation={Gtk.Orientation.VERTICAL}
          cssClasses={["text-content"]}
          hexpand={true}
          halign={FILL}
          valign={CENTER}
          spacing={2}
        >
          {summaryText && (
            <label
              cssClasses={["title"]}
              halign={FILL}
              valign={START}
              hexpand={true}
              xalign={0}
              justify={Gtk.Justification.LEFT}
              wrap={true}
              wrapMode={Pango.WrapMode.WORD_CHAR}
              label={summaryText}
              ellipsize={Pango.EllipsizeMode.END}
              lines={2}
            />
          )}
          {bodyText && (
            <label
              cssClasses={["body"]}
              halign={FILL}
              valign={START}
              hexpand={true}
              xalign={0}
              justify={Gtk.Justification.LEFT}
              wrap={true}
              wrapMode={Pango.WrapMode.WORD_CHAR}
              label={bodyText}
              ellipsize={Pango.EllipsizeMode.END}
              lines={variant === "stored" ? 3 : 4}
            />
          )}
        </box>
      </box>

      {/* Actions */}
      {notification.actions.length > 0 && (
        <box cssClasses={["actions"]} spacing={6} homogeneous={true} hexpand={true}>
          {notification.actions.map(({ label, action }) => (
            <button
              hexpand={true}
              focusable={false}
              cssClasses={["action-button"]}
              onClicked={() => onAction?.(notification.id, action)}
            >
              <label
                label={label}
                halign={CENTER}
                hexpand={true}
                ellipsize={Pango.EllipsizeMode.END}
                singleLineMode={true}
              />
            </button>
          ))}
        </box>
      )}
    </box>
  );

  if (typeof maxWidth === "number") {
    return (
      <Adw.Clamp maximumSize={maxWidth} tighteningThreshold={maxWidth}>
        {card}
      </Adw.Clamp>
    );
  }

  return card;
}

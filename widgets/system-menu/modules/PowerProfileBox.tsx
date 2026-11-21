import app from "ags/gtk4/app";
import PowerProfiles from "gi://AstalPowerProfiles";
import { Gtk } from "ags/gtk4";
import { createBinding, createState, For, onCleanup, With } from "ags";

const powerProfiles = PowerProfiles.get_default();

const formatProfileName = (name: string) =>
  name.charAt(0).toUpperCase() + name.substring(1).replace("-", " ");

const ProfileItem = ({
  icon,
  label,
  onClicked,
  cssClasses = [],
  showArrow = false,
  expanded,
}: {
  icon: any;
  label: any;
  onClicked: () => void;
  cssClasses?: string[];
  showArrow?: boolean;
  expanded?: any;
}) => (
  <button hexpand={true} onClicked={onClicked}>
    <box cssClasses={cssClasses} hexpand={true} halign={Gtk.Align.FILL}>
      <image iconName={icon} />
      <label label={label} xalign={0} hexpand={true} />
      {showArrow && expanded && (
        <image
          iconName="pan-end-symbolic"
          halign={Gtk.Align.END}
          cssClasses={expanded((isOpen: boolean) =>
            isOpen ? ["arrow-indicator", "arrow-down"] : ["arrow-indicator"],
          )}
        />
      )}
    </box>
  </button>
);

export const PowerProfileBox = () => {
  const [isExpanded, setIsExpanded] = createState(false);
  const [mounted, setMounted] = createState(false);
  const profiles = createBinding(powerProfiles, "profiles");
  let unmountTimer: ReturnType<typeof setTimeout> | null = null;

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
      unmountTimer = setTimeout(() => {
        unmountTimer = null;
        if (!isExpanded.get()) setMounted(false);
      }, 200);
    }
  };

  return (
    <box orientation={Gtk.Orientation.VERTICAL} cssClasses={["power-profiles"]}>
      <ProfileItem
        cssClasses={["current-profile"]}
        icon={createBinding(powerProfiles, "icon-name")}
        label={createBinding(
          powerProfiles,
          "active-profile",
        )(formatProfileName)}
        showArrow={true}
        expanded={isExpanded}
        onClicked={() => setOpen(!isExpanded.get())}
      />
      <revealer
        transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
        transitionDuration={180}
        revealChild={isExpanded}
        $={() => {
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
            app.disconnect(windowListener);
          });
        }}
      >
        <box
          orientation={Gtk.Orientation.VERTICAL}
          cssClasses={["profile-options"]}
        >
          <With value={mounted}>
            {(isMounted) =>
              isMounted ? (
                <box orientation={Gtk.Orientation.VERTICAL}>
                  <For each={profiles}>
                    {(profile: PowerProfiles.Profile) => (
                      <ProfileItem
                        icon={`power-profile-${profile.profile}-symbolic`}
                        label={formatProfileName(profile.profile)}
                        onClicked={() => {
                          powerProfiles.set_active_profile(profile.profile);
                          setOpen(false);
                        }}
                      />
                    )}
                  </For>
                </box>
              ) : null
            }
          </With>
        </box>
      </revealer>
    </box>
  );
};

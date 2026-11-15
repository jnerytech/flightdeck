import { type RefObject, useEffect, useRef, useState } from "react";
import type { HostView } from "../../lib/app-store.ts";
import type { HostSection } from "../../lib/router.ts";
import { hasFeature } from "../../lib/version.ts";

/** The tab a section ask opens (#1484, #2588): Health is on the Overview, the others on Settings. */
const tabOf = (section: HostSection) => (section === "health" ? "overview" : "settings");
/** The panel whose heading takes the focus. */
const slotOf = (section: HostSection) => {
  const slot = section === "health" ? "host-health" : `host-section-${section}`;
  return `[data-slot="${slot}"]`;
};

/** Whether the host says it has the panel a section ask opens: a panel shows only for a host that has its feature. */
function hasSection(section: HostSection | undefined, info: HostView["hostInfo"]): boolean {
  if (section === "pause") return info?.pause !== undefined;
  if (section === "keep-awake") return info?.keepAwake !== undefined;
  if (section !== "health") return false;
  return (
    hasFeature(info?.features, "depsCheck", false) ||
    hasFeature(info?.features, "doctor.run", false)
  );
}

/**
 * The tab a host page shows, and what moves it besides a click: a section ask from the status bar
 * (#1484) opens its tab and puts the focus on the panel's heading, and "Add folder" in the Health
 * section opens Settings with the focus on the field. `tabsRef` goes on the `Tabs`, so the heading
 * is looked up only inside this page; `pickTab` is its `onValueChange`.
 */
export function useHostTab(
  info: HostView["hostInfo"],
  section: HostSection | undefined,
  onSectionDone: (() => void) | undefined,
): {
  tab: string;
  tabsRef: RefObject<HTMLDivElement | null>;
  pickTab(value: string): void;
  askFolder(): void;
} {
  const [tab, setTab] = useState(section ? tabOf(section) : "overview");
  // "Add folder" in the Health section opens Settings: once that panel shows, the field takes focus.
  const [folderAsk, setFolderAsk] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new ask moves the focus
  useEffect(() => {
    if (folderAsk === 0 || tab !== "settings") return;
    const field = document.querySelector<HTMLElement>("[data-folder-field]");
    field?.focus();
    field?.scrollIntoView?.({ block: "center" });
  }, [folderAsk]);
  // A status-bar item opens its section (#1484): Settings, the panel in view, the focus on its heading.
  // The panel shows once the host says it has the feature, so the move waits for it.
  const sectionShown = hasSection(section, info);
  // The focus moves once the Settings panel is active (a browser does not focus into a hidden
  // one), then the ask is used up, so it never pulls the person back later.
  // It looks only inside this page (another page may show the same section), and moves the focus
  // once per ask, even when the route keeps the ask.
  const tabsRef = useRef<HTMLDivElement>(null);
  const handled = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (section) setTab(tabOf(section));
    else handled.current = undefined;
  }, [section]);
  useEffect(() => {
    if (!section || handled.current === section || tab !== tabOf(section) || !sectionShown) return;
    const heading = tabsRef.current?.querySelector<HTMLElement>(`${slotOf(section)} h3`);
    if (!heading) return;
    handled.current = section;
    heading.tabIndex = -1;
    heading.scrollIntoView?.({ block: "center" });
    heading.focus();
    onSectionDone?.();
  }, [section, tab, sectionShown, onSectionDone]);
  // Another tab picked before the section showed drops the ask too.
  const pickTab = (value: string) => {
    setTab(value);
    if (!section) return;
    handled.current = section;
    onSectionDone?.();
  };
  const askFolder = () => {
    setTab("settings");
    setFolderAsk((n) => n + 1);
  };
  return { tab, tabsRef, pickTab, askFolder };
}

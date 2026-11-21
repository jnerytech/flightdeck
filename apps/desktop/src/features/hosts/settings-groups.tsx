import { type ReactNode, type RefObject, useId, useLayoutEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { Inline, Stack } from "@/shared/layout/index.ts";

/** The groups of the Settings tab, in the order they show. */
const SETTINGS_GROUPS = ["connection", "sessions", "upkeep"] as const;
export type SettingsGroupName = (typeof SETTINGS_GROUPS)[number];

const slotOf = (name: SettingsGroupName) => `settings-group-${name}`;
const bodyOf = (name: SettingsGroupName) => `settings-group-body-${name}`;

/**
 * Which groups hold a panel. A panel that does not apply to the host (no feature, nothing to
 * show) renders nothing, so a group is empty when its body has no element; the groups are
 * re-read when a body gains or loses one (the host announces its features after the first paint).
 */
export function useShownGroups(root: RefObject<HTMLElement | null>): SettingsGroupName[] {
  const [shown, setShown] = useState<SettingsGroupName[]>([]);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const bodies = SETTINGS_GROUPS.map((name) => ({
      name,
      body: el.querySelector(`[data-slot="${bodyOf(name)}"]`),
    }));
    const read = () => {
      const next = bodies.filter((b) => (b.body?.childElementCount ?? 0) > 0).map((b) => b.name);
      setShown((prev) => (prev.join() === next.join() ? prev : next));
    };
    read();
    const observer = new MutationObserver(read);
    for (const { body } of bodies) if (body) observer.observe(body, { childList: true });
    return () => observer.disconnect();
  }, [root]);
  return shown;
}

/** A named group of panels: a heading the jump row can focus, then the panels. Out of sight while empty. */
export function SettingsGroup(
  props: Readonly<{
    name: SettingsGroupName;
    shown: boolean;
    children: ReactNode;
  }>,
) {
  const t = useT();
  const title = t(`hostPage.group_${props.name}` as const);
  const id = useId();
  return (
    <section
      data-slot={slotOf(props.name)}
      aria-labelledby={props.shown ? id : undefined}
      hidden={!props.shown}
    >
      <Stack gap={3}>
        {props.shown && (
          <h2 id={id} tabIndex={-1} className="font-semibold text-base">
            {title}
          </h2>
        )}
        <Stack gap={4} slot={bodyOf(props.name)}>
          {props.children}
        </Stack>
      </Stack>
    </section>
  );
}

/** A row of buttons, one per group that has panels: each moves the focus to that group's heading. */
export function SettingsGroupJump(
  props: Readonly<{ shown: readonly SettingsGroupName[]; root: RefObject<HTMLElement | null> }>,
) {
  const t = useT();
  // One group is the whole tab: there is nowhere to jump to.
  if (props.shown.length < 2) return null;
  const jump = (name: SettingsGroupName) => {
    const heading = props.root.current?.querySelector<HTMLElement>(
      `[data-slot="${slotOf(name)}"] h2`,
    );
    heading?.scrollIntoView?.({ block: "start" });
    heading?.focus();
  };
  return (
    <nav aria-label={t("hostPage.groupsLabel")}>
      <Inline gap={2}>
        {props.shown.map((name) => (
          <Button key={name} type="button" variant="outline" size="sm" onClick={() => jump(name)}>
            {t(`hostPage.group_${name}` as const)}
          </Button>
        ))}
      </Inline>
    </nav>
  );
}

import { Columns2, Rows2, SquareSplitHorizontal } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useHeaderSlot } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import type { AppState, AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";
import type { Orientation } from "../lib/workspace.ts";
import { Screen } from "./Screens.tsx";
import { TabBar } from "./TabBar.tsx";

/** Below this height the one area's tabs share the top bar's row (issue #488). */
export const SHORT_WINDOW = "(max-height: 599px)";

const STEP = 0.05;

type ScreenProps = Parameters<typeof Screen>[0];

/** The grid of the areas: rows when split horizontally, columns when vertically. */
function gridStyle(split: Orientation | null, template: string) {
  if (split === "horizontal") return { gridTemplateRows: template };
  return split ? { gridTemplateColumns: template } : undefined;
}

/** The window's one or two areas, each with its tab bar and screen, and the divider between them. */
export function Areas(
  props: Readonly<{
    store: AppStore;
    state: AppState;
    screen: Omit<ScreenProps, "route">;
  }>,
) {
  const { store, state } = props;
  const { workspace } = store;
  const { t } = store.i18n;
  const { hostTabs } = store;
  useSyncExternalStore(hostTabs.subscribe, () => hostTabs.version);
  // With no host the shared tabs are the window's only area.
  const hostless = hostTabs.workspace === null;
  const areas = hostless ? [hostTabs.shared] : workspace.areas;
  const { fraction } = workspace;
  const split = hostless ? null : workspace.split;
  const box = useRef<HTMLDivElement>(null);
  // Issue #488: each area's tabs have a row of their own, as in VS Code and Orca. In a window under
  // 600 px tall the one area's strip goes back to the top bar's row: a 720x480 window keeps its
  // conversation at least 150 px tall.
  const slot = useHeaderSlot();
  const short = useMediaQuery(SHORT_WINDOW);
  const inHeader = short && !split && areas.length === 1 ? slot : null;
  const dragging = useRef(false);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const rect = box.current?.getBoundingClientRect();
      if (!dragging.current || !rect || rect.width === 0 || rect.height === 0) return;
      workspace.setFraction(
        workspace.split === "horizontal"
          ? (e.clientY - rect.top) / rect.height
          : (e.clientX - rect.left) / rect.width,
      );
    };
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, [workspace]);

  const onDividerKey = (e: KeyboardEvent<HTMLElement>) => {
    const [less, more] =
      split === "horizontal" ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
    if (e.key === less) workspace.setFraction(workspace.fraction - STEP);
    else if (e.key === more) workspace.setFraction(workspace.fraction + STEP);
  };

  const buttons = (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="mb-0.5 size-7"
        aria-label={split ? t("tabs.join") : t("tabs.split")}
        onClick={() => workspace.toggleSplit()}
      >
        <SquareSplitHorizontal />
      </Button>
      {split && (
        <Button
          variant="ghost"
          size="icon"
          className="mb-0.5 size-7"
          aria-label={split === "vertical" ? t("tabs.splitHorizontal") : t("tabs.splitVertical")}
          onClick={() => workspace.setOrientation(split === "vertical" ? "horizontal" : "vertical")}
        >
          {split === "vertical" ? <Rows2 /> : <Columns2 />}
        </Button>
      )}
    </>
  );
  const template = `${fraction}fr 6px ${1 - fraction}fr`;

  return (
    <div ref={box} className="grid min-h-0 flex-1" style={gridStyle(split, template)}>
      {areas.flatMap((area, i) => {
        const pane = (
          <section
            key={area.id}
            aria-label={t("tabs.area", { n: String(i + 1) })}
            className="flex min-h-0 min-w-0 flex-col"
            onPointerDownCapture={() => workspace.focusArea(i as 0 | 1)}
          >
            {inHeader ? (
              createPortal(
                <TabBar
                  store={store}
                  state={state}
                  tabs={area}
                  {...(i === 0 && !hostless ? { shared: hostTabs.shared } : {})}
                >
                  {i === 0 && buttons}
                </TabBar>,
                inHeader,
              )
            ) : (
              <TabBar
                store={store}
                state={state}
                tabs={area}
                {...(i === 0 && !hostless ? { shared: hostTabs.shared } : {})}
              >
                {i === 0 && buttons}
              </TabBar>
            )}
            {/* Screens that are a Page scroll by themselves; the others scroll here. The area is the
                container its screens lay out against. */}
            <div data-slot="area-screen" className="area-screen">
              <Screen
                {...props.screen}
                route={
                  (i === 0 && hostTabs.onShared ? hostTabs.shared : area).router.current as Route
                }
              />
            </div>
          </section>
        );
        if (i === 0 || !split) return [pane];
        return [
          // biome-ignore lint/a11y/useSemanticElements: a focusable window splitter, unlike hr
          <div
            key="divider"
            role="separator"
            aria-orientation={split}
            aria-label={t("tabs.resize")}
            aria-valuenow={Math.round(fraction * 100)}
            aria-valuemin={20}
            aria-valuemax={80}
            tabIndex={0}
            onKeyDown={onDividerKey}
            onPointerDown={() => {
              dragging.current = true;
            }}
            className={cn(
              "bg-border transition-colors hover:bg-brand/50 focus-visible:bg-brand focus-visible:outline-none",
              split === "horizontal" ? "cursor-row-resize" : "cursor-col-resize",
            )}
          />,
          pane,
        ];
      })}
    </div>
  );
}

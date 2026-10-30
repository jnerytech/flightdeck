import { Columns2, Rows2, SquareSplitHorizontal } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { AppState, AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";
import { Screen } from "./Screens.tsx";
import { TabBar } from "./TabBar.tsx";

const STEP = 0.05;

type ScreenProps = Parameters<typeof Screen>[0];

/** The window's one or two areas, each with its tab bar and screen, and the divider between them. */
export function Areas(props: {
  store: AppStore;
  state: AppState;
  screen: Omit<ScreenProps, "route">;
}) {
  const { store, state } = props;
  const { workspace } = store;
  const { t } = store.i18n;
  useSyncExternalStore(workspace.subscribe, () => workspace.version);
  const { split, fraction } = workspace;
  const box = useRef<HTMLDivElement>(null);
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
    <div
      ref={box}
      className="grid min-h-0 flex-1"
      style={
        split === "horizontal"
          ? { gridTemplateRows: template }
          : split
            ? { gridTemplateColumns: template }
            : undefined
      }
    >
      {workspace.areas.flatMap((area, i) => {
        const pane = (
          <section
            key={area.id}
            aria-label={t("tabs.area", { n: String(i + 1) })}
            className="flex min-h-0 min-w-0 flex-col"
            onPointerDownCapture={() => workspace.focusArea(i as 0 | 1)}
          >
            <TabBar store={store} state={state} tabs={area}>
              {i === 0 && buttons}
            </TabBar>
            {/* Screens that are a Page scroll by themselves; the others scroll here. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Screen {...props.screen} route={area.router.current as Route} />
            </div>
          </section>
        );
        if (i === 0 || !split) return [pane];
        return [
          // biome-ignore lint/a11y/useSemanticElements: a focusable window splitter, which <hr> is not
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
            className={`bg-border transition-colors hover:bg-brand/50 focus-visible:bg-brand focus-visible:outline-none ${split === "horizontal" ? "cursor-row-resize" : "cursor-col-resize"}`}
          />,
          pane,
        ];
      })}
    </div>
  );
}

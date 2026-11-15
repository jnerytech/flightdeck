import { ArrowLeft, ArrowLeftRight, ArrowRight, MoreHorizontal, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AppStore } from "../../lib/app-store.ts";
import type { Tab, Tabs } from "./tabs.ts";

/** The current tab's menu: move, pin and the rest, at the end of the strip and of the narrow row. */
export function ActiveMenu(
  props: Readonly<{
    store: AppStore;
    tabs: Tabs;
    active: Tab;
    /** The tab's title, as the menu's items name it. */
    label: string;
    shift(id: string, delta: -1 | 1): void;
  }>,
) {
  const { store, tabs, active, label: activeLabel, shift } = props;
  const { t } = store.i18n;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="mb-0.5 size-7"
          aria-label={t("tabs.actions", { title: activeLabel })}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={!tabs.canShift(active.id, -1)}
          onSelect={() => shift(active.id, -1)}
        >
          <ArrowLeft aria-hidden="true" />
          {t("tabs.moveLeft", { title: activeLabel })}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!tabs.canShift(active.id, 1)}
          onSelect={() => shift(active.id, 1)}
        >
          <ArrowRight aria-hidden="true" />
          {t("tabs.moveRight", { title: activeLabel })}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => store.workspace.moveToOtherArea(active.id)}>
          <ArrowLeftRight aria-hidden="true" />
          {t("tabs.moveToOther", { title: activeLabel })}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => tabs.pin(active.id, !active.pinned)}>
          {active.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
          {t(active.pinned ? "tabs.unpin" : "tabs.pin", { title: activeLabel })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

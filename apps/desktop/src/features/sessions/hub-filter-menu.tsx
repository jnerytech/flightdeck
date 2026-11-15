import { ListFilter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NativeSelect } from "@/shared/layout/index.ts";
import type { T } from "../../i18n/index.ts";
import type { HubFilter, HubRow } from "./domain/hub.ts";

/** The hub's filter menu: origin, state, persona, pinned and archived, behind one button that counts them. */
export function HubFilterMenu(
  props: Readonly<{
    t: T;
    filter: HubFilter;
    /** How many filters are on. */
    active: number;
    personas: readonly NonNullable<HubRow["persona"]>[];
    set(patch: Partial<HubFilter>): void;
  }>,
) {
  const { t, filter, active, personas, set } = props;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <ListFilter aria-hidden="true" />
          {t("hub.filters")}
          {active > 0 && (
            <Badge className="h-4 min-w-4 px-1 tabular-nums" variant="default">
              {active}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col gap-2">
        <NativeSelect
          compact
          aria-label={t("hub.origin")}
          value={filter.origin}
          onChange={(e) => set({ origin: e.target.value as HubFilter["origin"] })}
        >
          <option value="">{t("hub.allOrigins")}</option>
          <option value="flightdeck">{t("hub.origins.flightdeck")}</option>
          <option value="terminal">{t("hub.origins.terminal")}</option>
          <option value="history">{t("hub.origins.history")}</option>
          <option value="background">{t("hub.origins.background")}</option>
        </NativeSelect>
        <NativeSelect
          compact
          aria-label={t("hub.state")}
          value={filter.state}
          onChange={(e) => set({ state: e.target.value as HubFilter["state"] })}
        >
          <option value="">{t("hub.allStates")}</option>
          <option value="running">{t("hub.states.running")}</option>
          <option value="needs_you">{t("hub.states.needs_you")}</option>
          <option value="idle">{t("hub.states.idle")}</option>
          <option value="ended">{t("hub.states.ended")}</option>
          <option value="failed">{t("hub.states.failed")}</option>
        </NativeSelect>
        {personas.length > 0 && (
          <NativeSelect
            compact
            aria-label={t("hub.persona")}
            value={filter.persona}
            onChange={(e) => set({ persona: e.target.value })}
          >
            <option value="">{t("hub.allPersonas")}</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        )}
        <Button
          variant="outline"
          size="sm"
          aria-pressed={filter.pinnedOnly}
          onClick={() => set({ pinnedOnly: !filter.pinnedOnly })}
        >
          {t("hub.pinnedOnly")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={filter.showArchived}
          onClick={() => set({ showArchived: !filter.showArchived })}
        >
          {t("hub.showArchived")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

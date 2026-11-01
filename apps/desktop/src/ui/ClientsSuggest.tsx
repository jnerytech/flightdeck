import { useState } from "react";
import { ListRow } from "@/components/layout/list-row";
import { Panel } from "@/components/layout/panel";
import { Inline, Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { applySuggestion, suggestClients } from "../lib/client-suggest.ts";
import { UNASSIGNED } from "../lib/clients.ts";

/** What the screen says about the projects without a client: how many, a suggestion, the pins. */
export function ClientsSuggest(props: {
  store: AppStore;
  state: Pick<AppState, "clientList" | "clientOverrides">;
}) {
  const { store, state } = props;
  const { t } = store.i18n;
  const [asked, setAsked] = useState(false);
  const scope = store.clientScope();
  const data = { clients: state.clientList, overrides: state.clientOverrides };
  const suggestions = suggestClients(scope.knownProjects, data);
  const unassigned = scope.knownProjects.filter((p) => scope.clientOf(p.key) === UNASSIGNED).length;
  const pinned = Object.entries(state.clientOverrides);
  const owner = (id: string | null) =>
    state.clientList.find((c) => c.id === id)?.name ?? t("clients.unassigned");

  return (
    <Stack gap={4}>
      {state.clientList.length > 0 && unassigned > 0 && (
        <p className="text-muted-foreground text-sm">
          {unassigned === 1
            ? t("clients.unassignedOne")
            : t("clients.unassignedMany", { count: unassigned })}
        </p>
      )}
      <Panel>
        <Inline gap={2}>
          <Button variant="outline" onClick={() => setAsked(true)}>
            {t("clients.suggestButton")}
          </Button>
        </Inline>
        {asked && suggestions.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("clients.suggestNothing")}</p>
        )}
        {asked && suggestions.length > 0 && (
          <Stack as="ul" label={t("clients.suggestionsList")} gap={1}>
            {suggestions.map((s) => (
              <li key={s.pattern}>
                <ListRow
                  title={
                    s.projects.length === 1
                      ? t("clients.suggestionOne", { name: s.name, pattern: s.pattern })
                      : t("clients.suggestionMany", {
                          name: s.name,
                          pattern: s.pattern,
                          count: s.projects.length,
                        })
                  }
                  trailing={
                    <Button size="sm" onClick={() => applySuggestion(store.clients, s)}>
                      {s.existingClientId
                        ? t("clients.suggestAddRule", { name: owner(s.existingClientId) })
                        : t("clients.suggestCreate", { name: s.name })}
                    </Button>
                  }
                />
              </li>
            ))}
          </Stack>
        )}
      </Panel>
      {pinned.length > 0 && (
        <Panel title={t("clients.pinnedTitle")}>
          <Stack as="ul" label={t("clients.pinnedTitle")} gap={1}>
            {pinned.map(([key, to]) => (
              <li key={key}>
                <ListRow
                  title={key}
                  meta={owner(to)}
                  trailing={
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("clients.release", { project: key })}
                      onClick={() => store.clients.clearOverride(key)}
                    >
                      {t("clients.releaseShort")}
                    </Button>
                  }
                />
              </li>
            ))}
          </Stack>
        </Panel>
      )}
    </Stack>
  );
}

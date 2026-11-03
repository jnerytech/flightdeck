import { Page, Section } from "@/components/layout/page";
import { Inline, Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { basename } from "../lib/paths.ts";
import type { Route } from "../lib/router.ts";

const RECENT = 5;
const SHORTCUTS = [
  ["Ctrl+K", "start.shortcut.search"],
  ["Ctrl+T", "start.shortcut.newTab"],
  ["Ctrl+Shift+T", "start.shortcut.reopen"],
  ["Ctrl+\\", "start.shortcut.split"],
] as const;

/** What an area with no tab shows: where to begin, the latest sessions and the main shortcuts. */
export function StartScreen(props: {
  store: AppStore;
  state: AppState;
  go: (route: Route) => void;
}) {
  const t = useT();
  const { state, go } = props;
  const firstHost = state.hosts.find((host) => host.status === "online");
  const recent = state.hosts
    .flatMap((host) => host.sessions.map((session) => ({ host: host.id, session })))
    .sort((a, b) => b.session.updatedAt.localeCompare(a.session.updatedAt))
    .slice(0, RECENT);
  return (
    <Page title={t("start.title")} subtitle={t("start.subtitle")}>
      <Stack gap={6}>
        <Inline gap={2}>
          {firstHost && (
            <Button
              onClick={() => {
                props.store.select(firstHost.id, null);
                go({ name: "new-session", host: firstHost.id });
              }}
            >
              {t("sidebar.newSession")}
            </Button>
          )}
          <Button variant="outline" onClick={() => go({ name: "hub" })}>
            {t("sidebar.sessions")}
          </Button>
          <Button variant="outline" onClick={() => go({ name: "needs-you" })}>
            {t("sidebar.needsYou")}
          </Button>
        </Inline>
        {recent.length > 0 && (
          <Section title={t("start.recent")}>
            <Stack gap={1} as="ul" label={t("start.recent")}>
              {recent.map(({ host, session }) => (
                <li key={`${host}/${session.id}`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => go({ name: "session", host, id: session.id })}
                  >
                    {session.name ?? basename(session.cwd)}
                  </Button>
                </li>
              ))}
            </Stack>
          </Section>
        )}
        <Section title={t("start.shortcuts")}>
          <Stack gap={1} as="ul" label={t("start.shortcuts")}>
            {SHORTCUTS.map(([keys, label]) => (
              <li key={keys}>
                <kbd className="keycap">{keys}</kbd> {t(label)}
              </li>
            ))}
          </Stack>
        </Section>
      </Stack>
    </Page>
  );
}

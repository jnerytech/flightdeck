import { Info } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppState, AppStore, HostView } from "../../lib/app-store.ts";
import { missingTools } from "../../lib/setup-steps.ts";

/**
 * A quiet, dismissible card for each tool an online host lacks (the GitHub CLI, `claude`): muted,
 * not a red banner, since a missing tool reduces what the app can do rather than breaking it.
 */
export function MissingToolsCards(props: {
  store: AppStore;
  hosts: HostView[];
  deps: AppState["deps"];
}) {
  const t = useT();
  const { store } = props;
  const dismissed = useSyncExternalStore(store.setup.subscribe, () =>
    store.setup.dismissedTools().join("\n"),
  ).split("\n");
  const cards = props.hosts
    .filter((host) => host.status === "online")
    .flatMap((host) =>
      missingTools(props.deps[host.id]).map((tool) => ({
        host,
        tool,
        id: `${tool.id}@${host.id}`,
      })),
    )
    .filter((card) => !dismissed.includes(card.id));
  return (
    <>
      {cards.map(({ host, tool, id }) => {
        const title = t("setup.tools.title", { tool: tool.id, host: host.name });
        const fix = tool.fix.find((entry) => entry.url)?.url;
        return (
          <aside
            key={id}
            role="note"
            aria-label={title}
            className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3"
          >
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="font-medium text-[13px]">{title}</p>
              <p className="text-muted-foreground text-xs">{t("setup.tools.text")}</p>
              {fix && (
                <a
                  href={fix}
                  className="w-fit text-xs underline"
                  onClick={(e) => {
                    e.preventDefault();
                    store.openLink(fix);
                  }}
                >
                  {t("setup.tools.fix")}
                </a>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => store.setup.dismissTool(id)}>
              {t("setup.tools.dismiss")}
            </Button>
          </aside>
        );
      })}
    </>
  );
}

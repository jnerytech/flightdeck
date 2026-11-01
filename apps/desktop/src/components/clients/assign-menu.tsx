import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { applySuggestion, suggestClients } from "../../lib/client-suggest.ts";

/**
 * What to do with a project no client has: pin it to a client by hand, or make a rule from its
 * owner (a new client, or a rule added to the client that already has the owner's name).
 */
export function AssignMenu(props: {
  store: AppStore;
  state: AppState;
  projectKey: string;
  name: string;
}) {
  const { store, state, projectKey, name } = props;
  const { t } = store.i18n;
  const [suggestion] = suggestClients([{ key: projectKey, cwds: [] }], {
    clients: state.clientList,
    overrides: state.clientOverrides,
  });
  const existing = state.clientList.find((c) => c.id === suggestion?.existingClientId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-5"
          aria-label={t("clients.assignTo", { name })}
        >
          <UserPlus />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {state.clientList.map((client) => (
          <DropdownMenuItem
            key={client.id}
            onSelect={() => store.clients.setOverride(projectKey, client.id)}
          >
            {t("clients.assignClient", { name: client.name })}
          </DropdownMenuItem>
        ))}
        {suggestion && (
          <DropdownMenuItem onSelect={() => applySuggestion(store.clients, suggestion)}>
            {existing
              ? t("clients.assignAddRule", { pattern: suggestion.pattern, name: existing.name })
              : t("clients.assignCreate", { name: suggestion.name, pattern: suggestion.pattern })}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

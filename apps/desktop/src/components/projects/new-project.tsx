import type { Project } from "@flightdeck/protocol";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { AddProject } from "@/components/projects/add-project";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n/context";
import type { AppState, AppStore } from "@/lib/app-store";

type HostInfo = AppState["hosts"][number];

/**
 * New project on the Projects page (issue #931): with one host in scope it opens the add form for
 * that host, with several it asks which first, and with none online it is off and says why. The
 * form is the one the Board and Workflows pickers use.
 */
export function NewProject(
  props: Readonly<{
    store: AppStore;
    hosts: readonly HostInfo[];
    onAdded(hostId: string, project: Project): void;
  }>,
) {
  const t = useT();
  const [chosen, setChosen] = useState<string | null>(null);
  const online = props.hosts.filter((host) => host.status === "online");
  const label = t("projectsOverview.newProject");
  const [only] = online;
  if (!only) {
    return (
      <ActionButton disabled disabledReason={t("projectsOverview.noHostOnline")}>
        <Plus aria-hidden="true" />
        {label}
      </ActionButton>
    );
  }
  if (online.length === 1) {
    return (
      <AddProject
        store={props.store}
        hostId={only.id}
        label={label}
        onAdded={(project) => props.onAdded(only.id, project)}
      />
    );
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            <Plus aria-hidden="true" />
            {label}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {online.map((host) => (
            <DropdownMenuItem key={host.id} onSelect={() => setChosen(host.id)}>
              {t("projectsOverview.newOn", { host: host.name })}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {chosen && (
        <AddProject
          bare
          store={props.store}
          hostId={chosen}
          onClosed={() => setChosen(null)}
          onAdded={(project) => props.onAdded(chosen, project)}
        />
      )}
    </>
  );
}

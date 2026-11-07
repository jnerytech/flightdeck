import { ChevronsUpDown, Server } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AppStore } from "../../lib/app-store.ts";
import { ALL_SCOPE, type DataScope, scopeOfValue, scopeValue } from "../../lib/data-scope.ts";

/**
 * The data scope in a scoped screen's toolbar (#126): it says whose numbers the screen shows and
 * changes them for every scoped screen at once. Not the host switcher, which is about tabs (#644).
 * A change is announced in a polite live region.
 */
export function ScopeMenu(
  props: Readonly<{
    store: AppStore;
    /**
     * An incompatible host is not offered (#886): it has nothing to show until its daemon is
     * updated. The scoped one stays, checked, so the menu says what is chosen.
     */
    hosts: readonly { id: string; name: string; status?: string }[];
    /**
     * The projects a screen can show one of (slice 4), labelled as everywhere. A screen that passes
     * none does not read projects yet: a project scope there reads, and shows, every host.
     */
    projects?: readonly { key: string; label: string }[];
    scope: DataScope;
    /** Called when the person picks from the menu, so a screen can end a route's own choice. */
    onPick?(): void;
  }>,
) {
  const { store, hosts, projects, scope } = props;
  const { t } = store.i18n;
  const [said, setSaid] = useState("");
  const projectsId = useId();
  const nameOf = (value: DataScope) => {
    if (value.kind === "host") {
      return hosts.find((host) => host.id === value.hostId)?.name ?? t("scope.all");
    }
    if (value.kind === "project" && projects) {
      return (
        projects.find((project) => project.key === value.projectKey)?.label ?? value.projectKey
      );
    }
    return t("scope.all");
  };
  const label = nameOf(scope);
  // Where projects are not read, a project scope is every host, and the menu says so.
  const value = scope.kind === "project" && !projects ? scopeValue(ALL_SCOPE) : scopeValue(scope);
  const choose = (value: string) => {
    const next = scopeOfValue(value);
    store.dataScope.set(next);
    props.onPick?.();
    setSaid(t("scope.showing", { scope: nameOf(next) }));
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label={t("scope.menu", { scope: label })}>
            <Server aria-hidden="true" />
            {label}
            <ChevronsUpDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={value} onValueChange={choose}>
            <DropdownMenuRadioItem value={scopeValue(ALL_SCOPE)}>
              {t("scope.all")}
            </DropdownMenuRadioItem>
            {hosts
              .filter(
                (host) =>
                  host.status !== "incompatible" ||
                  scopeValue(scope) === scopeValue({ kind: "host", hostId: host.id }),
              )
              .map((host) => (
                <DropdownMenuRadioItem
                  key={host.id}
                  value={scopeValue({ kind: "host", hostId: host.id })}
                >
                  {host.name}
                </DropdownMenuRadioItem>
              ))}
          </DropdownMenuRadioGroup>
          {projects && projects.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={value}
                onValueChange={choose}
                aria-labelledby={projectsId}
              >
                <DropdownMenuLabel id={projectsId}>{t("scope.projects")}</DropdownMenuLabel>
                {projects.map((project) => (
                  <DropdownMenuRadioItem
                    key={project.key}
                    value={scopeValue({ kind: "project", projectKey: project.key })}
                  >
                    {project.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Not role=status: Home's own status region is the one that says the screen's state (#212). */}
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {said}
      </span>
    </>
  );
}

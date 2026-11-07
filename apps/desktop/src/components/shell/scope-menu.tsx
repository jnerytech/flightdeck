import { ChevronsUpDown, Server } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AppStore } from "../../lib/app-store.ts";
import { ALL_SCOPE, type DataScope } from "../../lib/data-scope.ts";

/** The menu's value for every host; a host's is its id. */
const ALL = "*";

/**
 * The data scope in a scoped screen's toolbar (#126): it says whose numbers the screen shows and
 * changes them for every scoped screen at once. Not the host switcher, which is about tabs (#644).
 * A change is announced in a polite live region.
 */
export function ScopeMenu(
  props: Readonly<{
    store: AppStore;
    hosts: readonly { id: string; name: string }[];
    scope: DataScope;
  }>,
) {
  const { store, hosts, scope } = props;
  const { t } = store.i18n;
  const [said, setSaid] = useState("");
  const nameOf = (value: DataScope) =>
    value.kind === "host"
      ? (hosts.find((host) => host.id === value.hostId)?.name ?? t("scope.all"))
      : t("scope.all");
  const label = nameOf(scope);
  const choose = (value: string) => {
    const next: DataScope = value === ALL ? ALL_SCOPE : { kind: "host", hostId: value };
    store.dataScope.set(next);
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
          <DropdownMenuRadioGroup
            value={scope.kind === "host" ? scope.hostId : ALL}
            onValueChange={choose}
          >
            <DropdownMenuRadioItem value={ALL}>{t("scope.all")}</DropdownMenuRadioItem>
            {hosts.map((host) => (
              <DropdownMenuRadioItem key={host.id} value={host.id}>
                {host.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span role="status" className="sr-only">
        {said}
      </span>
    </>
  );
}

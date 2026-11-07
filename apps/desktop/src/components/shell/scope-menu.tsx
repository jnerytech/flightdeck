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
import { ALL_SCOPE, type DataScope, scopeOfValue, scopeValue } from "../../lib/data-scope.ts";

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
    const next = scopeOfValue(value);
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
          <DropdownMenuRadioGroup value={scopeValue(scope)} onValueChange={choose}>
            <DropdownMenuRadioItem value={scopeValue(ALL_SCOPE)}>
              {t("scope.all")}
            </DropdownMenuRadioItem>
            {hosts.map((host) => (
              <DropdownMenuRadioItem
                key={host.id}
                value={scopeValue({ kind: "host", hostId: host.id })}
              >
                {host.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Not role=status: Home's own status region is the one that says the screen's state (#212). */}
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {said}
      </span>
    </>
  );
}

import { ChevronRight, Ellipsis } from "lucide-react";
import { Fragment } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Crumb } from "@/lib/breadcrumb";
import type { Route } from "@/lib/router";

/** More steps than this and the ones in between fold into a menu: the first and the last stay. */
const FOLD_AT = 3;

/** The header's path: the steps above are buttons that go back, the last one says where you are. */
export function Breadcrumb(props: {
  crumbs: Crumb[];
  label: string;
  /** The name of the menu that holds the steps in between, when there are many. */
  moreLabel?: string;
  onGo(route: Route): void;
}) {
  const { crumbs } = props;
  const folded = crumbs.length > FOLD_AT;
  const hidden = folded ? crumbs.slice(1, -1) : [];
  const shown = folded ? [crumbs[0], crumbs.at(-1)] : crumbs;
  return (
    <nav aria-label={props.label} className="min-w-0 flex-1 overflow-hidden">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {shown.map((crumb, i) => {
          if (!crumb) return null;
          const isLast = i === shown.length - 1;
          const currentPage = isLast ? { "aria-current": "page" as const } : {};
          const labelClass = isLast
            ? "block truncate font-medium"
            : "block truncate text-muted-foreground";
          return (
            <Fragment key={crumb.label}>
              {i > 0 && (
                <>
                  {folded && i === 1 && (
                    <>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                      <li className="shrink-0">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label={props.moreLabel}
                              title={props.moreLabel}
                              className="inline-flex min-h-6 items-center rounded-sm px-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            >
                              <Ellipsis aria-hidden="true" className="size-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {hidden.map((step) => (
                              <DropdownMenuItem
                                key={step.label}
                                onSelect={() => step.route && props.onGo(step.route)}
                              >
                                {step.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </li>
                    </>
                  )}
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                </>
              )}
              {/* The earlier steps give way first (a factor 100 times larger), down to 1rem; then the current one, which keeps 4rem. The floors of three steps and their chevrons (140 px) fit the slot of a 720 px window (156 px). Factors under 1 in total would shrink only that share of the overflow. */}
              <li className={isLast ? "min-w-[4rem] shrink" : "min-w-[1rem] shrink-[100]"}>
                {crumb.route ? (
                  <button
                    type="button"
                    className="block min-h-6 max-w-full truncate rounded-sm text-muted-foreground leading-6 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    title={crumb.label}
                    onClick={() => crumb.route && props.onGo(crumb.route)}
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span className={labelClass} title={crumb.label} {...currentPage}>
                    {crumb.label}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

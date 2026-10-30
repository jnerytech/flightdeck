import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import type { Crumb } from "@/lib/breadcrumb";
import type { Route } from "@/lib/router";

/** The header's path: the steps above are buttons that go back, the last one says where you are. */
export function Breadcrumb(props: { crumbs: Crumb[]; label: string; onGo(route: Route): void }) {
  return (
    <nav aria-label={props.label} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {props.crumbs.map((crumb, i) => {
          const isLast = i === props.crumbs.length - 1;
          const labelClass = isLast ? "truncate font-medium" : "text-muted-foreground";
          const labelProps = isLast ? { "aria-current": "page" as const } : {};
          return (
            <Fragment key={crumb.label}>
              {i > 0 && (
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
              )}
              <li className="min-w-0">
                {crumb.route ? (
                  <button
                    type="button"
                    className="truncate rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => crumb.route && props.onGo(crumb.route)}
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span className={labelClass} {...labelProps}>
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

import { type ReactNode, useId } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Every screen: title, subtitle, actions on the right and an optional toolbar, fixed above a body
 * that scrolls by itself (the shell never scrolls), or, with `fill`, fills the rest of the height.
 */
export function Page(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  /** The body is a column that fills the rest of the height (a terminal), not a scrolling page. */
  fill?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-3 border-b px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 id={id} className="truncate font-semibold text-xl">
              {props.title}
            </h1>
            {props.subtitle && <p className="text-muted-foreground text-sm">{props.subtitle}</p>}
          </div>
          {props.actions && (
            <div data-slot="page-actions" className="flex flex-wrap items-end gap-2">
              {props.actions}
            </div>
          )}
        </div>
        {props.toolbar}
      </div>
      {props.fill ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
          {props.children}
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
          <div className="px-6 py-4">{props.children}</div>
        </ScrollArea>
      )}
    </section>
  );
}

/** A titled block inside a page. */
export function Section(props: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="font-semibold text-lg">
          {props.title}
        </h2>
        {props.actions && <div className="flex items-center gap-2">{props.actions}</div>}
      </div>
      {props.children}
    </section>
  );
}

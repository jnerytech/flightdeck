import { type ReactNode, useId } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Every screen: title, subtitle, actions on the right and an optional toolbar, fixed above a body
 * that scrolls by itself (the shell never scrolls), or, with `fill`, fills the rest of the height.
 */
export function Page(
  props: Readonly<{
    title: ReactNode;
    subtitle?: ReactNode;
    actions?: ReactNode;
    toolbar?: ReactNode;
    /** The body is a column that fills the rest of the height (a terminal), not a scrolling page. */
    fill?: boolean;
    children: ReactNode;
  }>,
) {
  const id = useId();
  return (
    // The page's stable slot: a layout finding inside it names the region (docs/DESIGN.md).
    <section aria-labelledby={id} data-slot="page" className="flex h-full min-h-0 flex-col">
      {/* The side gutter is 12 px compact, 16 px from 640 px and 24 px from 1024 px (#641). */}
      <div className="flex flex-col gap-3 border-b px-3 py-4 sm:px-4 lg:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {/* Two lines, then an ellipsis; the full text stays in `title` (#641). */}
            <h1
              id={id}
              title={typeof props.title === "string" ? props.title : undefined}
              className="line-clamp-2 break-words font-semibold text-xl"
            >
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
        <div
          data-slot="page-body"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 sm:px-4 lg:px-6"
        >
          {props.children}
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
          {/* The body's blocks sit 24 px apart, the scale's step between blocks of a page (#588).
              It is positioned, so what it holds absolutely (an sr-only caption) scrolls and clips
              inside it instead of stretching the screen into a second scrollbar (#640). */}
          <div
            data-slot="page-body"
            className="relative flex flex-col gap-6 px-3 py-4 sm:px-4 lg:px-6"
          >
            {props.children}
          </div>
        </ScrollArea>
      )}
    </section>
  );
}

/** A titled block inside a page. */
export function Section(
  props: Readonly<{ title: ReactNode; actions?: ReactNode; children: ReactNode }>,
) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-slot="section" className="flex flex-col gap-3">
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

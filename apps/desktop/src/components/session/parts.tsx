import { MoreHorizontal } from "lucide-react";
import { createContext, forwardRef, type ReactNode, useContext, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/i18n/context";
import { useHeight, useWidth } from "@/lib/use-width";
import { cn } from "@/lib/utils";

/** Below this width of the header's own box it is one line and the actions fold into a menu. */
const NARROW_HEADER = 560;

/**
 * Below this height of the session's area it is short (a 720x480 window): the header is one line
 * and the summary starts folded, so the conversation keeps its room (#232).
 */
const SHORT_AREA = 600;

/** Whether the session's area is short; `SessionPane` measures it. */
export const ShortArea = createContext(false);

/**
 * Whether the conversation needs the room: the area is short, or a request waits for the person
 * (issue #488). The header, the not-trusted notice and the summary then take one line each, so the
 * request card stays whole.
 */
export const TightArea = createContext(false);

/** The area is short or a request waits: what the bands over the conversation read. */
export function useTight(): boolean {
  const short = useContext(ShortArea);
  const tight = useContext(TightArea);
  return short || tight;
}

/** A session's title, its gray line and its controls, over the timeline. */
export function SessionHeader(
  props: Readonly<{
    title: ReactNode;
    subtitle?: ReactNode;
    controls?: ReactNode;
    /** A row of its own under the buttons (the persona controls). */
    extra?: ReactNode;
    /** The buttons that fold into a "More actions" menu when the header is narrow. */
    actions?: ReactNode;
    /** Dialogs of the actions: they stay mounted whether the menu is open or not. */
    dialogs?: ReactNode;
    /** The path and cost as one line of text: the tooltip of the title when the header is narrow. */
    hint?: string;
  }>,
) {
  const t = useT();
  const box = useRef<HTMLElement>(null);
  const width = useWidth(box);
  const tight = useTight();
  const narrow = (width > 0 && width < NARROW_HEADER) || tight;
  if (narrow) {
    return (
      <header
        ref={box}
        className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2"
      >
        <h2 title={props.hint} className="min-w-0 flex-1 truncate font-semibold text-base">
          {props.title}
        </h2>
        <div data-slot="session-controls" className="flex shrink-0 items-center gap-2">
          {props.controls}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t("session.moreActions")}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="flex w-auto max-w-[calc(100vw-2rem)] flex-col gap-2"
            >
              {props.actions}
              {props.extra}
            </PopoverContent>
          </Popover>
          {props.dialogs}
        </div>
      </header>
    );
  }
  return (
    <header
      ref={box}
      className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b px-4 py-3"
    >
      <div className="min-w-0">
        <h2 className="truncate font-semibold text-base">{props.title}</h2>
        {props.subtitle && (
          <div className="flex flex-col text-muted-foreground text-xs">{props.subtitle}</div>
        )}
      </div>
      {(props.controls || props.actions || props.dialogs) && (
        <div data-slot="session-controls" className="flex flex-wrap items-end gap-2">
          {props.controls}
          {props.actions}
          {props.dialogs}
        </div>
      )}
      {props.extra && (
        <div data-slot="session-extra" className="basis-full">
          {props.extra}
        </div>
      )}
    </header>
  );
}

/** The conversation: scrolls by itself between the header and the composer. */
export const Timeline = forwardRef<
  HTMLDivElement,
  { children: ReactNode } & React.HTMLAttributes<HTMLDivElement>
>(function Timeline({ children, className, ...rest }, ref) {
  return (
    <div
      ref={ref}
      data-slot="timeline"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a region that scrolls takes focus, so the keyboard reaches it
      tabIndex={0}
      className={cn(
        // The items never shrink: in a column that scrolls they would squash into each other.
        "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 [&>*]:shrink-0",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

/** One message: the user's in a soft bubble on the right, the assistant's plain. */
export function Message(
  props: Readonly<{
    from: "user" | "assistant";
    children: ReactNode;
    className?: string;
    "data-uuid"?: string;
    "aria-current"?: "true";
  }>,
) {
  return (
    <div
      data-uuid={props["data-uuid"]}
      aria-current={props["aria-current"]}
      className={cn(
        "message-hover max-w-full break-words text-sm",
        props.from === "user"
          ? "self-end whitespace-pre-wrap rounded-lg bg-secondary px-3 py-2"
          : "message-prose flex flex-col gap-2",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

/** Under the conversation: what waits to go out, the activity line, the box and its state line. */
/** The band above the conversation: the not-trusted notice and the summary (issue #422). */
export function RecapSlot(props: Readonly<{ children: ReactNode }>) {
  const short = useContext(ShortArea);
  return (
    <div className="recap-slot" {...(short ? { "data-short": "true" } : {})}>
      {props.children}
    </div>
  );
}

export function ComposerDock(props: Readonly<{ children: ReactNode }>) {
  // In a short area the dock's padding and gaps shrink: the conversation keeps its room (#232).
  const short = useContext(ShortArea);
  return (
    <div className="composer-dock" {...(short ? { "data-short": "true" } : {})}>
      {props.children}
    </div>
  );
}

/** How far above the window's bottom each message box on screen reaches, in px. */
const composerTops = new Map<HTMLElement, number>();

/**
 * Issue #994: the toasts' corner is a session's message box, so a toast covered Send (and on a
 * phone the whole box). While a box shows, it tells styles.css to keep the toasts above its top
 * (--composer-clear, the highest box's top and a 0.75rem gap), following its height and the
 * window's, and takes it back when it goes. A ref callback, so React runs the cleanup.
 */
function clearToasts(card: HTMLElement | null): (() => void) | undefined {
  if (!card) return undefined;
  const root = card.ownerDocument.documentElement;
  const apply = () => {
    const highest = Math.max(0, ...composerTops.values());
    if (composerTops.size === 0) root.style.removeProperty("--composer-clear");
    else root.style.setProperty("--composer-clear", `calc(${highest}px + 0.75rem)`);
  };
  const measure = () => {
    const height = card.ownerDocument.defaultView?.innerHeight ?? 0;
    composerTops.set(card, Math.ceil(height - card.getBoundingClientRect().top));
    apply();
  };
  measure();
  const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
  watch?.observe(card);
  watch?.observe(root);
  return () => {
    watch?.disconnect();
    composerTops.delete(card);
    apply();
  };
}

/** The floating rounded card of the message box and its buttons. */
export function Composer(props: Readonly<{ children: ReactNode }>) {
  return (
    <div ref={clearToasts} data-slot="composer-card" className="composer-card">
      {props.children}
    </div>
  );
}

/** A session pane: header, timeline and composer stacked, filling its column. */
export function SessionPane(
  props: Readonly<{
    children: ReactNode;
    /** A request waits for the person: the bands over the conversation take one line each (#488). */
    waiting?: boolean;
  }>,
) {
  const box = useRef<HTMLElement>(null);
  const height = useHeight(box);
  const short = height > 0 && height < SHORT_AREA;
  return (
    <section ref={box} className="flex h-full min-h-0 flex-col">
      <ShortArea.Provider value={short}>
        <TightArea.Provider value={short || props.waiting === true}>
          {props.children}
        </TightArea.Provider>
      </ShortArea.Provider>
    </section>
  );
}

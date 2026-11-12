import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Toaster, toast } from "sonner";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Button } from "@/components/ui/button";
import { focusLost } from "@/hooks/use-page-focus";
import { translateError } from "@/i18n/errors";
import type { T } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import { type NoticeAction, noticeAction, noticeLifetime } from "@/lib/notice-lifetime";
import { useStoreSlice } from "@/lib/use-store";

/** Mounted Notices so far: each one prefixes its toast ids with its number. */
let instances = 0;

/** A host's error: its translated title, the daemon's message behind Detalhes, and Fechar. */
function ErrorToast(
  props: Readonly<{
    store: AppStore;
    noticeId: number;
    title: string;
    detail: string;
    action: NoticeAction | null;
    retry?: () => void;
    /** The refusal of a command the person gave: it takes the focus when the step lost it (#1546). */
    takesFocus?: boolean;
    t: T;
    onClose(): void;
  }>,
) {
  const { t, store, noticeId } = props;
  const box = useRef<HTMLDivElement>(null);
  // A refusal that holds the focus gives it to the page's heading however it goes away (Close, the
  // timer, the store dropping it for a newer one), not to the body.
  const holding = useRef(false);
  const alive = useSyncExternalStore(store.subscribe, () =>
    store.getState().notices.some((n) => n.id === noticeId),
  );
  useLayoutEffect(() => {
    if (alive || !holding.current) return;
    holding.current = false;
    document.querySelector<HTMLElement>("[data-slot=page-title]")?.focus();
  }, [alive]);
  // The dialog or button that gave the command is gone, and the browser left the focus on the page body.
  useEffect(() => {
    if (props.takesFocus && focusLost()) box.current?.focus();
  }, [props.takesFocus]);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  // Closed: gone at once, before sonner's exit animation ends.
  if (!alive) return null;
  return (
    <div
      ref={box}
      role="alert"
      tabIndex={-1}
      onFocus={() => {
        holding.current = true;
      }}
      onBlur={(event) => {
        // A toast taken out of the page drops the focus without the person leaving it: not a blur here.
        if (event.currentTarget.isConnected) holding.current = false;
      }}
      className="flex w-80 flex-col gap-2 rounded-lg border border-destructive/40 bg-popover p-3 text-popover-foreground text-sm shadow-lg focus-visible:outline-2 focus-visible:outline-ring"
    >
      <p className="font-medium">{props.title}</p>
      {open && <p className="break-words text-muted-foreground text-xs">{props.detail}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {props.action && (
          <Button size="sm" onClick={() => setAsking(true)}>
            {t("toast.allowRoot")}
          </Button>
        )}
        {props.detail && (
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
            {t("toast.details")}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={props.onClose}>
          {t("toast.close")}
        </Button>
      </div>
      {asking && props.action && (
        <ConfirmDialog
          message={t("toast.allowRootMessage", {
            host: store.getState().hosts.find((h) => h.id === props.action?.hostId)?.name ?? "",
            folder: props.action.folder,
          })}
          confirmLabel={t("toast.allowRoot")}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            props.onClose();
            if (props.action)
              void store.allowRoot(props.action.hostId, props.action.folder, props.retry);
          }}
        />
      )}
    </div>
  );
}

const NOTICES_KEYS = ["notices"] as const;

/**
 * Issue #581: the toasts sit over the status bar, and over the update card while it shows, with the
 * card's 0.75rem gap: styles.css's --toast-bottom, on a phone too. Their right edge lines up with
 * the card's.
 */
const TOAST_OFFSET = { bottom: "var(--toast-bottom)", right: "0.75rem" };

/**
 * The app's toasts (sonner): each error of a host, translated by its code with the daemon's
 * message behind "Detalhes", stays about ten seconds (paused while hovered or focused; one with an action waits until it is acted on) and always has Close; successes are short.
 */
export const Notices = memo(function Notices(props: { store: AppStore }) {
  const { store } = props;
  const state = useStoreSlice(store, NOTICES_KEYS);
  const theme = useSyncExternalStore(store.theme.subscribe, () => store.theme.resolved);
  const { t } = store.i18n;
  /** Notices already handed to sonner. */
  const shown = useRef(new Set<number>());
  /** The error toasts on screen, by notice: one whose notice left the list goes too (#581). */
  const errors = useRef(new Map<number, string>());
  // sonner keeps its toasts per module: ids carry this instance's prefix, so another store's
  // notices (numbered from 1 too) never take over these, and leaving clears them.
  const [prefix] = useState(() => `n${++instances}-`);
  useEffect(
    () => () => {
      toast.dismiss();
    },
    [],
  );
  useEffect(() => {
    const listed = new Set(state.notices.map((notice) => notice.id));
    for (const [noticeId, toastId] of errors.current) {
      if (listed.has(noticeId)) continue;
      toast.dismiss(toastId);
      errors.current.delete(noticeId);
    }
    for (const notice of state.notices) {
      if (shown.current.has(notice.id)) continue;
      shown.current.add(notice.id);
      if (notice.kind === "success") {
        toast.success(notice.text, {
          id: `${prefix}s${notice.id}`,
          duration: noticeLifetime(notice),
          ...(notice.link
            ? { action: { label: notice.link.label, onClick: notice.link.run } }
            : {}),
        });
        store.dismissNotice(notice.id);
        continue;
      }
      const { title, detail } = translateError(notice.code, notice.text, t, notice);
      const id = `${prefix}e${notice.id}`;
      errors.current.set(notice.id, id);
      toast.custom(
        () => (
          <ErrorToast
            store={store}
            noticeId={notice.id}
            title={title}
            detail={detail}
            action={noticeAction(notice)}
            {...(notice.retry ? { retry: notice.retry } : {})}
            takesFocus={notice.answersCommand === true}
            t={t}
            onClose={() => {
              toast.dismiss(id);
              store.dismissNotice(notice.id);
            }}
          />
        ),
        {
          id,
          duration: noticeLifetime(notice),
          // Gone by itself: it leaves the list too.
          onAutoClose: () => store.dismissNotice(notice.id),
        },
      );
    }
  }, [state.notices, store, t, prefix]);
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      visibleToasts={6}
      offset={TOAST_OFFSET}
      mobileOffset={TOAST_OFFSET}
    />
  );
});

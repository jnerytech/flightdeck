import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import { translateError } from "@/i18n/errors";
import type { T } from "@/i18n/index";
import type { AppState, AppStore } from "@/lib/app-store";

/** Mounted Notices so far: each one prefixes its toast ids with its number. */
let instances = 0;

/** A host's error: its translated title, the daemon's message behind Detalhes, and Fechar. */
function ErrorToast(props: {
  store: AppStore;
  noticeId: number;
  title: string;
  detail: string;
  t: T;
  onClose(): void;
}) {
  const [open, setOpen] = useState(false);
  const { t, store, noticeId } = props;
  // Closed: gone at once, before sonner's exit animation ends.
  const alive = useSyncExternalStore(store.subscribe, () =>
    store.getState().notices.some((n) => n.id === noticeId),
  );
  if (!alive) return null;
  return (
    <div
      role="alert"
      className="flex w-80 flex-col gap-2 rounded-lg border border-destructive/40 bg-popover p-3 text-popover-foreground text-sm shadow-lg"
    >
      <p className="font-medium">{props.title}</p>
      {open && <p className="break-words text-muted-foreground text-xs">{props.detail}</p>}
      <div className="flex justify-end gap-2">
        {props.detail && (
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
            {t("toast.details")}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={props.onClose}>
          {t("toast.close")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The app's toasts (sonner): each error of a host, translated by its code with the daemon's
 * message behind "Detalhes", stays until closed (several at once); successes are short.
 */
export function Notices(props: { store: AppStore; state: AppState }) {
  const { store, state } = props;
  const theme = useSyncExternalStore(store.theme.subscribe, () => store.theme.resolved);
  const { t } = store.i18n;
  /** Notices already handed to sonner. */
  const shown = useRef(new Set<number>());
  // sonner keeps its toasts per module: ids carry this instance's prefix, so another store's
  // notices (numbered from 1 too) never take over these, and leaving clears them.
  const [prefix] = useState(() => `n${++instances}-`);
  useEffect(() => () => void toast.dismiss(), []);
  useEffect(() => {
    for (const notice of state.notices) {
      if (shown.current.has(notice.id)) continue;
      shown.current.add(notice.id);
      if (notice.kind === "success") {
        toast.success(notice.text, { id: `${prefix}s${notice.id}`, duration: 2500 });
        store.dismissNotice(notice.id);
        continue;
      }
      const { title, detail } = translateError(notice.code, notice.text, t);
      const id = `${prefix}e${notice.id}`;
      toast.custom(
        () => (
          <ErrorToast
            store={store}
            noticeId={notice.id}
            title={title}
            detail={detail}
            t={t}
            onClose={() => {
              toast.dismiss(id);
              store.dismissNotice(notice.id);
            }}
          />
        ),
        { id, duration: Number.POSITIVE_INFINITY },
      );
    }
  }, [state.notices, store, t, prefix]);
  return <Toaster theme={theme} position="bottom-right" visibleToasts={6} />;
}

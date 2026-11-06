import { X } from "lucide-react";
import { memo, useId } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Button } from "@/components/ui/button";
import { useStoreSlice } from "@/lib/use-store";
import type { AppStore } from "../lib/app-store.ts";

const UPDATECARD_KEYS = ["appUpdate", "settings"] as const;

/** Where a version's notes are read. */
export const releaseUrl = (version: string) =>
  `https://github.com/jnerytech/flightdeck/releases/tag/v${version}`;

/**
 * Issue #581: while the card shows, the toasts sit above it. It tells styles.css how far to lift
 * them (its height and the 0.75rem gap) through --update-card-lift on the page's root, following
 * its height, and takes the lift back when it goes. A ref callback, so React runs the cleanup.
 */
function liftToasts(card: HTMLElement | null): (() => void) | undefined {
  if (!card) return undefined;
  const root = card.ownerDocument.documentElement;
  const lift = () =>
    root.style.setProperty(
      "--update-card-lift",
      `calc(${Math.ceil(card.getBoundingClientRect().height)}px + 0.75rem)`,
    );
  lift();
  const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(lift);
  watch?.observe(card);
  return () => {
    watch?.disconnect();
    root.style.removeProperty("--update-card-lift");
  };
}

/**
 * Issue #490: once a new version is downloaded, a card in the bottom-right corner (above the status
 * bar) offers to update, as Orca does. The sessions run in the hosts' daemons, so restarting the app
 * interrupts none of them. It is a labelled region, not a dialog: it never takes the focus.
 */
export const UpdateCard = memo(function UpdateCard(props: { store: AppStore }) {
  const { store } = props;
  const t = store.i18n.t;
  const state = useStoreSlice(store, UPDATECARD_KEYS);
  const titleId = useId();
  const { offer, ready } = state.appUpdate;
  if (!offer || !state.settings.autoUpdate || ready !== offer.version) return null;
  const url = releaseUrl(offer.version);
  return (
    <section
      ref={liftToasts}
      data-slot="update-card"
      aria-labelledby={titleId}
      className="update-card"
    >
      <div className="update-card-head">
        <h2 id={titleId} className="update-card-title">
          {t("update.cardTitle")}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t("update.cardClose")}
          onClick={() => store.dismissAppUpdate()}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <p>{t("update.cardReady", { version: offer.version })}</p>
      <p className="update-card-note">{t("update.cardSafe")}</p>
      <a
        href={url}
        className="update-card-link"
        onClick={(e) => {
          e.preventDefault();
          store.openLink(url);
        }}
      >
        {t("update.cardNotes")}
      </a>
      <ActionButton className="w-full" onClick={() => store.installAppUpdate()}>
        {t("update.cardUpdate")}
      </ActionButton>
    </section>
  );
});

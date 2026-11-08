import type { Card } from "@flightdeck/protocol";
import { useEffect, useRef, useState } from "react";
import { Field, NativeSelect } from "@/components/layout/form";
import { Stack } from "@/components/layout/stack";
import { refusalText } from "@/i18n/errors";
import type { Key } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

export interface CardMergePrProps {
  store: AppStore;
  hostId: string;
  card: Card;
  open: boolean;
  onOpenChange(open: boolean): void;
}

type Outcome = { text: string; url: string | null } | null;

/**
 * Issue #1196: merges the card's open PR from the card. Nothing is sent before the confirm; a
 * refusal says why where the card is (not in a dialog that is gone), with a link to the PR. When
 * the host merges, the card moves to Done through the card update the answer carries.
 */
export function CardMergePr(props: Readonly<CardMergePrProps>) {
  const { store, hostId, card } = props;
  const { t } = store.i18n;
  const [method, setMethod] = useState<"merge" | "squash">("merge");
  const [refused, setRefused] = useState<Outcome>(null);
  const [merged, setMerged] = useState(false);
  const [busy, setBusy] = useState(false);
  const said = useRef<HTMLDivElement>(null);
  const refusedBox = useRef<HTMLDivElement>(null);
  const url = card.prUrl ?? "";

  const merge = async () => {
    props.onOpenChange(false);
    setRefused(null);
    setMerged(false);
    setBusy(true);
    const result = await store
      .hostRequest(hostId, "card.pr.merge", { cardId: card.id, method, confirm: true })
      .finally(() => setBusy(false));
    if (!result.ok) {
      setRefused({
        text: refusalText(result.code, result.message, t, result),
        url: result.params?.url === undefined ? url || null : String(result.params.url),
      });
      return;
    }
    setMerged(true);
  };

  // A refusal is about this card's open PR: it goes with the card or with the PR's openness.
  useEffect(() => {
    if (card.prState !== "open") setRefused(null);
  }, [card.prState]);

  // After the render, and a tick later: the closing dialog gives the focus back to its button in a
  // timeout of its own, which the outcome's box must come after.
  useEffect(() => {
    let box: HTMLElement | null = null;
    if (refused) box = refusedBox.current;
    else if (merged) box = said.current;
    if (!box) return;
    const timer = setTimeout(() => box.focus(), 0);
    return () => clearTimeout(timer);
  }, [refused, merged]);

  return (
    <>
      {merged && (
        <div // NOSONAR: holds flow content (a paragraph), which <output> may not
          role="status"
          ref={said}
          tabIndex={-1}
          className="rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
        >
          <p className="text-sm">{t("cardMergePr.done")}</p>
        </div>
      )}
      {refused && (
        <div
          role="alert"
          ref={refusedBox}
          tabIndex={-1}
          className="rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Stack gap={1}>
            <p className="text-sm">{refused.text}</p>
            {refused.url && <PrLink store={store} url={refused.url} />}
          </Stack>
        </div>
      )}
      {props.open && (
        <ConfirmDialog
          message={t("cardMergePr.message")}
          confirmLabel={t("cardMergePr.action")}
          confirmDisabled={busy}
          onCancel={() => props.onOpenChange(false)}
          onConfirm={() => void merge()}
        >
          <Stack gap={3}>
            <Stack gap={1}>
              <span className="text-muted-foreground text-xs">{t("cardMergePr.pr")}</span>
              <PrLink store={store} url={url} text={url} />
              {card.checksState && (
                <span className="text-sm">{t(`checks.${card.checksState}` as Key)}</span>
              )}
            </Stack>
            <Field label={t("cardMergePr.how")}>
              {(control) => (
                <NativeSelect
                  {...control}
                  value={method}
                  onChange={(event) => setMethod(event.target.value as "merge" | "squash")}
                >
                  <option value="merge">{t("cardMergePr.merge")}</option>
                  <option value="squash">{t("cardMergePr.squash")}</option>
                </NativeSelect>
              )}
            </Field>
          </Stack>
        </ConfirmDialog>
      )}
    </>
  );
}

/** The PR's address, opened by the app (never inside the webview). */
function PrLink(props: Readonly<{ store: AppStore; url: string; text?: string }>) {
  const { store, url } = props;
  return (
    <a
      href={url}
      className="break-all text-sm underline"
      onClick={(event) => {
        event.preventDefault();
        store.openLink(url);
      }}
    >
      {props.text ?? store.i18n.t("cardMergePr.openPr")}
    </a>
  );
}

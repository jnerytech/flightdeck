import type { ReleaseNote } from "@flightdeck/protocol";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/context";
import { formatDate } from "@/i18n/format";
import type { AppStore, ReleaseNotesResult } from "../../lib/app-store.ts";

/** Every release, on GitHub: "View all" opens it. */
export const RELEASES_PAGE = "https://github.com/jnerytech/flightdeck/releases";

/**
 * What's new: the latest releases of the app, from the first host that can read them (issue #125).
 * Opening it counts as seeing the notes of this version, so the dot of the account menu goes. Below
 * 640 px it takes the whole window.
 */
export function WhatsNewDialog(props: Readonly<{ store: AppStore; onClose(): void }>) {
  const { store, onClose } = props;
  const t = useT();
  /** `null` while the notes are being read. */
  const [result, setResult] = useState<ReleaseNotesResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: read again when the person asks (attempt)
  useEffect(() => {
    store.whatsNew.markSeen();
    let current = true;
    setResult(null);
    void store.releaseNotes().then((notes) => current && setResult(notes));
    return () => {
      current = false;
    };
  }, [store, attempt]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[85vh] overflow-y-auto max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>{t("whatsNew.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("whatsNew.description")}</DialogDescription>
        </DialogHeader>
        <Body result={result} onRetry={() => setAttempt((n) => n + 1)} store={store} />
        <DialogFooter className="max-sm:flex-col-reverse">
          <Button variant="outline" onClick={() => store.openLink(RELEASES_PAGE)}>
            <ExternalLink aria-hidden="true" />
            {t("whatsNew.viewAll")}
          </Button>
          <Button onClick={onClose}>{t("whatsNew.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Body(
  props: Readonly<{ result: ReleaseNotesResult | null; onRetry(): void; store: AppStore }>,
) {
  const t = useT();
  const { result } = props;
  if (result === null) return <p role="status">{t("whatsNew.loading")}</p>;
  if (result.kind === "none")
    return <p className="text-muted-foreground text-sm">{t("whatsNew.none")}</p>;
  if (result.kind === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm">
        <p>{result.message}</p>
        <Button variant="outline" size="sm" onClick={props.onRetry}>
          {t("whatsNew.retry")}
        </Button>
      </div>
    );
  }
  return (
    <ul aria-label={t("whatsNew.releases")} className="flex flex-col gap-5">
      {result.releases.map((release) => (
        <ReleaseItem key={release.tag} release={release} store={props.store} />
      ))}
    </ul>
  );
}

function ReleaseItem(props: Readonly<{ release: ReleaseNote; store: AppStore }>) {
  const t = useT();
  const { release } = props;
  return (
    <li className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-medium text-sm">{release.title}</h3>
        <span className="text-muted-foreground text-xs">
          {formatDate(release.publishedAt, t.lang)}
        </span>
      </div>
      {release.highlights.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {release.highlights.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{t("whatsNew.noHighlights")}</p>
      )}
      <Button
        variant="link"
        size="sm"
        className="self-start px-0"
        aria-label={t("whatsNew.openRelease", { title: release.title })}
        onClick={() => props.store.openLink(release.url)}
      >
        {t("whatsNew.open")}
        <ExternalLink aria-hidden="true" />
      </Button>
    </li>
  );
}

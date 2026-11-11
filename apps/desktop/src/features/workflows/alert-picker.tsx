import type { AlertsUnavailable, RepoAlert } from "@flightdeck/protocol";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { AppDialogContent } from "@/components/feedback/dialog-content";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Stack } from "@/components/layout/stack";
import { LoadingState } from "@/components/layout/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/context";
import type { Key } from "@/i18n/index";
import type { AppStore } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";

/**
 * Issue #79: "Choose an alert" beside a workflow's `alert` input. The host reads the repository's
 * open code-scanning and Dependabot alerts with its own `gh`; picking one puts the alert's text in
 * the input, for the person to read before the card starts. Nothing is shown on a host that cannot
 * read alerts.
 */
export function AlertPicker(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    projectId: string;
    onPick(text: string): void;
  }>,
) {
  const t = useT();
  const { store, hostId, projectId } = props;
  const [open, setOpen] = useState(false);
  /** Null until the host answers. */
  const [alerts, setAlerts] = useState<RepoAlert[] | null>(null);
  const [unavailable, setUnavailable] = useState<AlertsUnavailable[]>([]);
  const [failed, setFailed] = useState(false);
  const host = store.getState().hosts.find((h) => h.id === hostId);
  if (!hasFeature(host?.hostInfo?.features, "alerts", false)) return null;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setAlerts(null);
    setUnavailable([]);
    setFailed(false);
    void store.hostCommand(hostId, "alert.list", { projectId }).then((result) => {
      setFailed(result === null);
      setAlerts(result?.alerts ?? null);
      setUnavailable(result?.unavailable ?? []);
    });
  };
  const pick = (alert: RepoAlert) => {
    setOpen(false);
    props.onPick(alert.text);
  };
  const nothing = alerts?.length === 0 && unavailable.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="self-start">
          <ShieldAlert aria-hidden="true" />
          {t("alertsUi.open")}
        </Button>
      </DialogTrigger>
      <AppDialogContent>
        <DialogHeader>
          <DialogTitle>{t("alertsUi.title")}</DialogTitle>
          <DialogDescription>{t("alertsUi.intro")}</DialogDescription>
        </DialogHeader>
        {failed && <InlineNotice tone="error">{t("alertsUi.failed")}</InlineNotice>}
        {!failed && alerts === null && <LoadingState label={t("alertsUi.loading")} />}
        {unavailable.map((source) => (
          <InlineNotice key={source.kind} tone="warn">
            {t(`alertsUi.reason.${source.reason}` as Key, {
              source: t(`alertsUi.kind.${source.kind}` as Key),
            })}
          </InlineNotice>
        ))}
        {nothing && <p className="text-sm">{t("alertsUi.empty")}</p>}
        {alerts && alerts.length > 0 && (
          <Stack as="ul" label={t("alertsUi.list")} gap={2}>
            {alerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} onPick={pick} />
            ))}
          </Stack>
        )}
      </AppDialogContent>
    </Dialog>
  );
}

/** One alert: its severity in words, its title and where it is, and the button that picks it. */
function AlertRow(props: Readonly<{ alert: RepoAlert; onPick(alert: RepoAlert): void }>) {
  const t = useT();
  const { alert } = props;
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
      <Badge variant="outline">{t(`alertsUi.severity.${alert.severity}` as Key)}</Badge>
      <strong className="min-w-0 break-words">{alert.title}</strong>
      {alert.location && <span className="text-muted-foreground">{alert.location}</span>}
      <Button
        size="sm"
        variant="outline"
        className="ml-auto"
        aria-label={t("alertsUi.use", { title: alert.title })}
        onClick={() => props.onPick(alert)}
      >
        {t("alertsUi.useShort")}
      </Button>
    </li>
  );
}

import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "@/lib/app-store";
import { useStoreState } from "@/lib/use-store";
import { hasFeature } from "@/lib/version";

/** On the host's page: the setting that resumes interrupted sessions by itself, and the way back to a put-off offer. */
export function ResumePanel(props: { store: AppStore; host: HostView }) {
  const { store, host } = props;
  const t = useT();
  const state = useStoreState(store);
  if (!hasFeature(host.hostInfo?.features, "resume-offer", false)) return null;
  const offer = state.resumeOffers[host.id];
  return (
    <Panel title={t("resumeOffer.title")}>
      <p className="text-muted-foreground text-xs">{t("resumeOffer.autoHint")}</p>
      <span className="inline-flex items-center gap-2 text-sm">
        <Switch
          aria-label={t("resumeOffer.auto")}
          checked={store.autoResume(host.id)}
          onCheckedChange={(on) => store.setAutoResume(host.id, on)}
        />
        {t("resumeOffer.auto")}
      </span>
      {offer && !offer.open && (
        <Button variant="outline" onClick={() => store.openResumeOffer(host.id)}>
          {t("resumeOffer.reopen", { n: offer.sessions.length - offer.resumed.length })}
        </Button>
      )}
    </Panel>
  );
}

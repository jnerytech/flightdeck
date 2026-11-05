import { useEffect, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Button } from "@/components/ui/button";
import type { AppStore } from "@/lib/app-store";

/**
 * A session in a folder the person has not trusted says what did not load: the folder's own hooks,
 * MCP servers, settings, CLAUDE.md, agents and skills, and also the person's own MCP servers and
 * plugins (issue #196). Nothing when the folder is trusted or the host does not announce it.
 */
export function UntrustedNotice(props: {
  store: AppStore;
  hostId: string;
  /** The host announces projectTrust. */
  announced: boolean;
  cwd: string;
  /** Opens the project's page, where the person can read what it would load and trust it. */
  onReview?: () => void;
}) {
  const { store, hostId, announced, cwd } = props;
  const { t } = store.i18n;
  const [untrusted, setUntrusted] = useState(false);
  useEffect(() => {
    if (!announced) return;
    let current = true;
    void store.hostCommand(hostId, "project.trust.state", { paths: [cwd] }).then((answer) => {
      if (current) setUntrusted(answer?.items[0]?.trusted === false);
    });
    return () => {
      current = false;
    };
  }, [store, hostId, announced, cwd]);
  if (!untrusted) return null;
  return (
    <InlineNotice>
      {t("projectPage.trust.sessionNotice")}{" "}
      {props.onReview && (
        <Button variant="link" size="sm" onClick={props.onReview}>
          {t("projectPage.trust.review")}
        </Button>
      )}
    </InlineNotice>
  );
}

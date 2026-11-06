import { CircleAlert } from "lucide-react";
import type { T } from "@/i18n/index";

/**
 * The host page header's line (issue #281): the address and the daemon's version; a daemon on
 * another version than the app's is marked in words, with an icon, never by color alone.
 */
export function HostVersionLine(
  props: Readonly<{ url: string; daemon: string | null; app: string; t: T }>,
) {
  const { t, daemon } = props;
  if (!daemon) return <>{props.url}</>;
  return (
    <>
      {props.url} · {t("hostPage.daemon", { version: daemon })}
      {daemon !== props.app && (
        <>
          {" · "}
          <span className="host-version-differs">
            <CircleAlert aria-hidden="true" />
            {t("hostPage.differs")}
          </span>
        </>
      )}
    </>
  );
}

import { CircleAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { T } from "@/i18n/index";

/** "flightdeckd 0.36.0", and the mismatch in words when it is not the app's; null before it is known. */
export function hostVersionText(
  t: T,
  daemon: string | null | undefined,
  app: string,
): string | null {
  if (!daemon) return null;
  const line = t("hostPage.daemon", { version: daemon });
  return daemon === app ? line : `${line} · ${t("hostPage.differs")}`;
}

/**
 * A host's row in the sidebar says its daemon's version in a real tooltip (issue #281), on hover and
 * on keyboard focus; never a native title. The same words are on the host page and in the switcher.
 */
export function HostVersionTip(props: Readonly<{ text: string | null; children: ReactElement }>) {
  if (!props.text) return props.children;
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>{props.children}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={4}>
          {props.text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

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

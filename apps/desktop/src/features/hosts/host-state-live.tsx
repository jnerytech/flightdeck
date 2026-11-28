import { useT } from "@/i18n/context";
import type { Key } from "@/i18n/index";
import type { HostView } from "../../lib/app-store.ts";

/**
 * The host page's polite live region: always in the page, so a screen reader says the host's
 * connection state when it changes (a drop under the open page), and says nothing on the first render.
 */
export function HostStateLive(props: Readonly<{ host: HostView }>) {
  const t = useT();
  const { host } = props;
  return (
    <output className="sr-only">
      {t("sidebar.hostState", { host: host.name, state: t(`hosts.status.${host.status}` as Key) })}
    </output>
  );
}

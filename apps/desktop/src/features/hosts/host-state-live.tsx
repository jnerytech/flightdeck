import { useT } from "@/i18n/context";
import type { Key } from "@/i18n/index";
import type { HostView } from "../../lib/app-store.ts";

/**
 * The host page's polite live region: always in the page, so a screen reader says the host's
 * connection state when it drops under the open page, and says nothing on the first render. It
 * says the state only: the title names the host, and a rename is no news. An incompatible host
 * says nothing here: its notice is a status of its own and already says what is wrong.
 */
export function HostStateLive(props: Readonly<{ host: HostView }>) {
  const t = useT();
  const { host } = props;
  const said = host.status === "incompatible" ? "" : t(`hosts.status.${host.status}` as Key);
  return <output className="sr-only">{said}</output>;
}

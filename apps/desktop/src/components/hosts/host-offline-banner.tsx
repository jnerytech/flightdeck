import { useState } from "react";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNow } from "@/hooks/use-now";
import { useT } from "@/i18n/context";
import type { HostView } from "../../lib/app-store.ts";
import { mayBeRefusedAddress, offlineHint } from "../../lib/host-offline.ts";

const COMMAND = "rounded bg-muted px-1 font-mono text-xs";
// Commands, not prose: the same in every language.
const CHECK_DAEMON = "systemctl --user status flightdeckd";
const ENABLE_LINGER = "sudo loginctl enable-linger $USER";
const WSL_SYSTEMD = "systemd=true";

/**
 * At the top of the host page while the host is not online: the state, what failed in plain words,
 * the last try, the countdown to the next one and Reconnect now with its result.
 */
export function HostOfflineBanner(props: {
  host: HostView;
  onReconnect(): void;
  /** Tries a new token or pairing link; the error text, or null when it worked. */
  onPairAgain?(input: string): Promise<string | null>;
}) {
  const t = useT();
  const { host } = props;
  const now = useNow();
  // The time of the last try when Reconnect now was pressed: a later one is its answer.
  const [asked, setAsked] = useState<number | null>(null);
  const [fresh, setFresh] = useState("");
  const [pairError, setPairError] = useState<string | null>(null);
  const retry = host.retry;
  const connecting = host.status === "connecting";
  const kind = retry?.kind ?? "refused";
  const seconds = retry ? Math.max(0, Math.ceil((retry.nextRetryAt - now) / 1000)) : 0;
  const hint = offlineHint(kind, host.url, host.hostInfo?.os ?? null);
  const answered = asked !== null && !connecting && (retry?.lastTryAt ?? 0) > asked;
  const reason =
    host.status === "unauthorized"
      ? t("hostOffline.unauthorized")
      : t(`hostOffline.${kind}` as const, { url: host.url });
  return (
    <section
      aria-label={t("hostOffline.label")}
      className="rounded-md border border-status-needs-you/40 p-3 text-sm"
    >
      <Stack gap={2}>
        <h3 className="font-semibold">
          {connecting ? t("hostOffline.connecting") : t("hostOffline.title")}
        </h3>
        <p>{reason}</p>
        {retry && !connecting && (
          <p className="text-muted-foreground">
            {t("hostOffline.lastTry", { time: new Date(retry.lastTryAt).toLocaleTimeString() })}
            {" · "}
            {t("hostOffline.nextTry", { n: seconds })}
          </p>
        )}
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={connecting}
            onClick={() => {
              setAsked(retry?.lastTryAt ?? 0);
              props.onReconnect();
            }}
          >
            {connecting ? t("hostOffline.reconnecting") : t("hostOffline.reconnectNow")}
          </Button>
        </div>
        {host.status === "unauthorized" && props.onPairAgain && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              setPairError(
                (await props.onPairAgain?.(fresh).catch((e: Error) => e.message)) ?? null,
              );
            }}
          >
            <Input
              aria-label={t("hostOffline.pairLabel")}
              placeholder={t("hostOffline.pairLabel")}
              className="w-72"
              value={fresh}
              onChange={(e) => setFresh(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={fresh.trim() === ""}>
              {t("hostOffline.pairAgain")}
            </Button>
            {pairError && <p role="alert">{pairError}</p>}
          </form>
        )}
        {answered && <p>{t("hostOffline.still")}</p>}
        {hint === "linux" && (
          <Stack gap={1}>
            <p>{t("hostOffline.hintLinux")}</p>
            <code className={COMMAND}>{CHECK_DAEMON}</code>
            <code className={COMMAND}>{ENABLE_LINGER}</code>
            <p>{t("hostOffline.hintWsl")}</p>
            <code className={COMMAND}>{WSL_SYSTEMD}</code>
          </Stack>
        )}
        {hint === "generic" && <p>{t("hostOffline.hintGeneric")}</p>}
        {mayBeRefusedAddress(kind, host.url) && <p>{t("hostOffline.hintAddress")}</p>}
      </Stack>
    </section>
  );
}

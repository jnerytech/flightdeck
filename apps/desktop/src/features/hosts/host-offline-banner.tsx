import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import { Inline, Stack } from "@/shared/layout/index.ts";
import type { HostView } from "../../lib/app-store.ts";
import { mayBeRefusedAddress, offlineHint } from "./domain/host-offline.ts";
import { useNow } from "./use-now.ts";

const COMMAND = "rounded bg-muted px-1 font-mono text-xs";
// Commands, not prose: the same in every language.
const CHECK_DAEMON = "systemctl --user status flightdeckd";
const ENABLE_LINGER = "sudo loginctl enable-linger $USER";
// A file snippet, not a command: the key works only under its [boot] header.
const WSL_SYSTEMD = "[boot]\nsystemd=true";
const SERVICE_STATUS = "flightdeckd service status";
const SERVICE_START = "flightdeckd service start";

/**
 * A command to type on the host, or (`snippet`) lines to put in a file there, with a button that
 * copies exactly that text and is named for what it is.
 */
function CopyCommand(
  props: Readonly<{ command: string; snippet?: boolean; onCopy(command: string): void }>,
) {
  const t = useT();
  return (
    <Inline gap={2}>
      <code className={props.snippet ? `${COMMAND} whitespace-pre` : COMMAND}>{props.command}</code>
      <Button type="button" variant="outline" size="xs" onClick={() => props.onCopy(props.command)}>
        {props.snippet
          ? t("hostOffline.copyWsl")
          : t("hostOffline.copy", { command: props.command })}
      </Button>
    </Inline>
  );
}

/**
 * At the top of the host page while the host is not online: the state, what failed in plain words,
 * the last try, the countdown to the next one and Reconnect now with its result.
 */
export function HostOfflineBanner(
  props: Readonly<{
    host: HostView;
    onReconnect(): void;
    /** A time of day in the app's language and time zone. */
    formatTime(iso: string): string;
    /** Puts a command on the clipboard; true when it landed. */
    onCopy(text: string): Promise<boolean>;
    /** Tries a new token or pairing link; the error text, or null when it worked. */
    onPairAgain?(input: string): Promise<string | null>;
  }>,
) {
  const t = useT();
  const { host } = props;
  const now = useNow();
  // The time of the last try when Reconnect now was pressed: a later one is its answer.
  const [asked, setAsked] = useState<number | null>(null);
  const [fresh, setFresh] = useState("");
  const [pairError, setPairError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  // How many copies landed: the live region says "Copied" once per press, even on the same command.
  const [copied, setCopied] = useState(0);
  const trying = useRef(false);
  // How many times Reconnect now was pressed: a copy that resolves after one belongs to the old try.
  const reconnects = useRef(0);
  const retry = host.retry;
  const connecting = host.status === "connecting";
  const kind = retry?.kind ?? "refused";
  const seconds = retry ? Math.max(0, Math.ceil((retry.nextRetryAt - now) / 1000)) : 0;
  const hint = offlineHint(kind, host.url, host.hostInfo?.os ?? null);
  const answered = asked !== null && !connecting && (retry?.lastTryAt ?? 0) > asked;
  const waitingForAnswer = connecting && asked !== null;
  const waiting = useRef(waitingForAnswer);
  waiting.current = waitingForAnswer;
  const copy = (command: string) => {
    // A copy made while Reconnect now waits for its answer, or before it was pressed, is not announced:
    // the live region keeps the try's own words, then its answer.
    const press = reconnects.current;
    void props
      .onCopy(command)
      .then(
        (landed) =>
          landed && press === reconnects.current && !waiting.current && setCopied((n) => n + 1),
      )
      // A refusal is already reported by the store's own failure notice; the live region only confirms.
      .catch(() => {});
  };
  const status = (() => {
    if (waitingForAnswer) return t("hostOffline.connecting");
    if (copied > 0) return t("hostOffline.copied");
    return answered ? t("hostOffline.still") : "";
  })();
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
            {t("hostOffline.lastTry", {
              time: props.formatTime(new Date(retry.lastTryAt).toISOString()),
            })}
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
              reconnects.current += 1;
              setAsked(retry?.lastTryAt ?? 0);
              setCopied(0);
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
              // A second submit before the first state update is seen must not start another try.
              if (trying.current) return;
              trying.current = true;
              setPairing(true);
              const error =
                (await props.onPairAgain?.(fresh).catch((e: Error) => e.message)) ?? null;
              trying.current = false;
              setPairing(false);
              setPairError(error);
              if (error === null) setFresh("");
            }}
          >
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={t("hostOffline.pairLabel")}
              placeholder={t("hostOffline.pairLabel")}
              className="w-72"
              value={fresh}
              onChange={(e) => setFresh(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={pairing || fresh.trim() === ""}>
              {pairing ? t("hostOffline.pairTesting") : t("hostOffline.pairAgain")}
            </Button>
            {pairError && <p role="alert">{pairError}</p>}
          </form>
        )}
        {/* Always in the page, so a screen reader announces what lands in it (#2586). */}
        <output className="block">{status && <span key={copied}>{status}</span>}</output>
        {hint === "linux" && (
          <Stack gap={1}>
            <p>{t("hostOffline.hintLinux")}</p>
            <CopyCommand command={CHECK_DAEMON} onCopy={copy} />
            <CopyCommand command={ENABLE_LINGER} onCopy={copy} />
            <p>{t("hostOffline.hintWsl")}</p>
            <CopyCommand command={WSL_SYSTEMD} snippet onCopy={copy} />
          </Stack>
        )}
        {hint === "windows" && (
          <Stack gap={1}>
            <p>{t("hostOffline.hintWindows")}</p>
            <CopyCommand command={SERVICE_STATUS} onCopy={copy} />
            <CopyCommand command={SERVICE_START} onCopy={copy} />
          </Stack>
        )}
        {hint === "generic" && <p>{t("hostOffline.hintGeneric")}</p>}
        {mayBeRefusedAddress(kind, host.url) && <p>{t("hostOffline.hintAddress")}</p>}
      </Stack>
    </section>
  );
}

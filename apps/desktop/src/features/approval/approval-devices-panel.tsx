import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "@/lib/app-store";
import { ActionButton, InlineNotice } from "@/shared/feedback/index.ts";
import { Panel } from "@/shared/layout/index.ts";
import type { ApprovalStatus } from "./store.ts";

type View = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; status: ApprovalStatus };

/**
 * The host page's panel for the devices that approve for the person (#3439): whether protection is
 * on, which devices are enrolled, enrolling this one with the code the host's terminal printed,
 * revoking one and dropping this device's own key. Shown only for a host that checks proofs, on an
 * app that can hold a key. The system's dialog, not this panel, is where a person says yes.
 */
export function ApprovalDevicesPanel(props: Readonly<{ store: AppStore; host: HostView }>) {
  const { store, host } = props;
  const t = useT();
  const [view, setView] = useState<View>({ kind: "loading" });
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  // The most devices this panel saw: protection that drops to none after that was not turned off here.
  const seen = useRef(0);
  const reload = useCallback(async () => {
    try {
      const status = await store.approval.status(host.id);
      seen.current = Math.max(seen.current, status.keys.length);
      setView({ kind: "ready", status });
    } catch {
      setView({ kind: "failed" });
    }
  }, [store, host.id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  /** Runs one change: its refusal is shown here, its success is said once, and the list is read again. */
  const change = async (work: () => Promise<void>, success: string) => {
    setDone(null);
    setProblem(null);
    try {
      await work();
      setDone(success);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
    await reload();
  };
  const hint = <p className="text-muted-foreground text-xs">{t("approvalDevices.hint")}</p>;
  if (view.kind !== "ready") {
    return (
      <Panel title={t("approvalDevices.title")} slot="host-section-approval">
        {hint}
        <p className="text-sm" role="status">
          {t(view.kind === "failed" ? "approvalDevices.loadFailed" : "approvalDevices.loading")}
        </p>
        {view.kind === "failed" && (
          <div>
            <ActionButton variant="outline" onClick={reload}>
              {t("approvalDevices.retry")}
            </ActionButton>
          </div>
        )}
      </Panel>
    );
  }
  const { status } = view;
  const lost = status.protectionOff && seen.current > 0;
  const enrolling = status.thisKeyId === null;
  return (
    <Panel title={t("approvalDevices.title")} slot="host-section-approval">
      {hint}
      <p className="text-sm">
        {t(status.protectionOff ? "approvalDevices.off" : "approvalDevices.on")}
      </p>
      {lost && <InlineNotice tone="warn">{t("approvalDevices.lost")}</InlineNotice>}
      {status.keys.length > 0 && (
        <ul aria-label={t("approvalDevices.listLabel")} className="flex flex-col gap-2">
          {status.keys.map((key) => (
            <li key={key.keyId} className="flex items-center justify-between gap-2">
              <span className="flex flex-col text-sm">
                <span>
                  {key.name} ·{" "}
                  {t(
                    key.keyId === status.thisKeyId
                      ? "approvalDevices.thisDevice"
                      : "approvalDevices.elsewhere",
                  )}
                </span>
                <span className="text-muted-foreground text-xs">
                  {t("approvalDevices.detail", {
                    client: key.client,
                    address: key.address,
                    date: store.formatDateTime(key.enrolledAt),
                  })}
                </span>
              </span>
              {status.thisKeyId !== null && (
                <ActionButton
                  variant="outline"
                  aria-label={t("approvalDevices.revokeLabel", { name: key.name })}
                  onClick={() =>
                    change(
                      () => store.approval.revoke(host.id, key.keyId),
                      t("approvalDevices.revoked"),
                    )
                  }
                >
                  {t("approvalDevices.revoke")}
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {enrolling && status.protectionOff && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void change(
              () =>
                store.approval.enroll(host.id, name.trim(), code.trim()).then(() => setCode("")),
              t("approvalDevices.enrolled"),
            );
          }}
        >
          <h4 className="font-medium text-sm">{t("approvalDevices.enrollTitle")}</h4>
          <p className="text-muted-foreground text-xs">{t("approvalDevices.enrollHint")}</p>
          <Input
            aria-label={t("approvalDevices.nameLabel")}
            value={name}
            maxLength={64}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            aria-label={t("approvalDevices.codeLabel")}
            value={code}
            maxLength={256}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setCode(event.target.value)}
          />
          <div>
            <ActionButton type="submit" disabled={name.trim() === "" || code.trim() === ""}>
              {t("approvalDevices.enroll")}
            </ActionButton>
          </div>
        </form>
      )}
      {!enrolling && (
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-xs">{t("approvalDevices.removeLocalHint")}</p>
          <div>
            <ActionButton
              variant="outline"
              onClick={() =>
                change(
                  () => store.approval.removeLocalKey(host.id),
                  t("approvalDevices.removedLocal"),
                )
              }
            >
              {t("approvalDevices.removeLocal")}
            </ActionButton>
          </div>
        </div>
      )}
      {problem && <InlineNotice tone="error">{problem}</InlineNotice>}
      {done && <InlineNotice tone="info">{done}</InlineNotice>}
      <p className="text-muted-foreground text-xs">{t("approvalDevices.scope")}</p>
    </Panel>
  );
}

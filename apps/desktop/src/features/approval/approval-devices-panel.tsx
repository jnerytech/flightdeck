import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "@/lib/app-store";
import { ActionButton, InlineNotice } from "@/shared/feedback/index.ts";
import { Field, Form, FormActions, Inline, ListRow, Panel, Stack } from "@/shared/layout/index.ts";
import {
  type AddOffer,
  type AddRequest,
  type ApprovalHeard,
  type ApprovalStatus,
  heardText,
  heardTone,
  type UncheckedCommand,
} from "./store.ts";

/** The notice for each command a host does not guard. */
const UNCHECKED_TEXT = {
  merge: "approvalDevices.commandsUnchecked",
  trust: "approvalDevices.trustUnchecked",
  bypass: "approvalDevices.bypassUnchecked",
  roots: "approvalDevices.rootsUnchecked",
} as const satisfies Record<UncheckedCommand, string>;

type View = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; status: ApprovalStatus };

/**
 * The host page's panel for the devices that approve for the person (#3439): whether protection is
 * on, which devices are enrolled, enrolling this one with the code the host's terminal printed,
 * revoking one and dropping this device's own key. Shown only for a host that checks proofs, on an
 * app that can hold a key. The system's dialog, not this panel, is where a person says yes.
 */
/** The most announced changes the panel keeps on screen. */
const MAX_HEARD = 5;

export function ApprovalDevicesPanel(props: Readonly<{ store: AppStore; host: HostView }>) {
  const { store, host } = props;
  const t = useT();
  const [view, setView] = useState<View>({ kind: "loading" });
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A change the host announced that this device did not make (#3477), until the person dismisses it.
  // All of them are kept: a later change must not hide an alert about an earlier one.
  const [heard, setHeard] = useState<ApprovalHeard[]>([]);
  const heardBox = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  // Adding a second device (#3478): the new device's text, and what an enrolled one read from it.
  const [addName, setAddName] = useState("");
  const [request, setRequest] = useState<AddRequest | null>(null);
  const [addText, setAddText] = useState("");
  const [offer, setOffer] = useState<AddOffer | null>(null);
  const addBox = useRef<HTMLDivElement>(null);
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
    // Another host: what was seen on the last one says nothing about this one.
    seen.current = 0;
    setView({ kind: "loading" });
    setDone(null);
    setProblem(null);
    setRequest(null);
    setOffer(null);
    setAddText("");
    setAddName("");
    setHeard([]);
    void reload();
  }, [reload]);
  useEffect(
    () =>
      store.approval.subscribe(host.id, (change) => {
        // A device enrolled here, or by this person's agreement, is no news: the list is read again, no more.
        if (!(change.kind === "enrolled" && change.own)) {
          setHeard((before) => [...before, change].slice(-MAX_HEARD));
        }
        void reload();
      }),
    [store, host.id, reload],
  );
  // The form the person used is swapped for the next step: the focus it lost goes to the new part, not the page's top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the step changes, which the body does not read
  useEffect(() => {
    const box = addBox.current;
    if (!box || (document.activeElement && document.activeElement !== document.body)) return;
    box.focus();
  }, [offer, request]);
  // The host lists this device now: the text did its work.
  useEffect(() => {
    if (!request || view.kind !== "ready") return;
    const { thisKeyId, keys } = view.status;
    if (thisKeyId && keys.some((key) => key.keyId === thisKeyId)) {
      setRequest(null);
      setDone(t("approvalDevices.enrolled"));
    }
  }, [request, view, t]);
  /**
   * Runs one change, one at a time: its refusal is shown here, its success is said once (not when the
   * person declined the system's dialog), and the list is read again.
   */
  const change = async (work: () => Promise<unknown>, success: string | null) => {
    if (busy) return;
    setBusy(true);
    setDone(null);
    setProblem(null);
    try {
      if ((await work()) !== "declined" && success) setDone(success);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
    await reload();
    setBusy(false);
  };
  const notices = (
    <>
      {problem && <InlineNotice tone="error">{problem}</InlineNotice>}
      {done && <InlineNotice tone="info">{done}</InlineNotice>}
    </>
  );
  const hint = <p className="text-muted-foreground text-xs">{t("approvalDevices.hint")}</p>;
  // First in the panel, and always mounted: it takes the focus back when the person dismisses.
  const heardNotices = (
    <div ref={heardBox} tabIndex={-1}>
      {heard.length > 0 && (
        <Stack gap={1}>
          {heard.map((one, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a list that only grows, cleared as a whole
            <InlineNotice key={index} tone={heardTone(one)}>
              {heardText(t, one, host.name)}
            </InlineNotice>
          ))}
          <Inline>
            <ActionButton
              variant="outline"
              onClick={() => {
                setHeard([]);
                heardBox.current?.focus();
              }}
            >
              {t("approvalDevices.dismiss")}
            </ActionButton>
          </Inline>
        </Stack>
      )}
    </div>
  );
  if (view.kind !== "ready") {
    return (
      <Panel title={t("approvalDevices.title")} slot="host-section-approval">
        {heardNotices}
        {hint}
        <p className="text-sm" role="status">
          {t(view.kind === "failed" ? "approvalDevices.loadFailed" : "approvalDevices.loading")}
        </p>
        {view.kind === "failed" && (
          <Inline>
            <ActionButton variant="outline" onClick={reload}>
              {t("approvalDevices.retry")}
            </ActionButton>
          </Inline>
        )}
        {notices}
      </Panel>
    );
  }
  const { status } = view;
  const lost = status.protectionOff && seen.current > 0;
  const hasKey = status.thisKeyId !== null;
  const enrolledHere = hasKey && status.keys.some((key) => key.keyId === status.thisKeyId);
  return (
    <Panel title={t("approvalDevices.title")} slot="host-section-approval">
      {heardNotices}
      {hint}
      <p className="text-sm">
        {t(status.protectionOff ? "approvalDevices.off" : "approvalDevices.on")}
      </p>
      {lost && <InlineNotice tone="warn">{t("approvalDevices.lost")}</InlineNotice>}
      {!status.protectionOff &&
        store.approval.uncheckedCommands(host.id).map((command) => (
          <InlineNotice key={command} tone="warn">
            {t(UNCHECKED_TEXT[command])}
          </InlineNotice>
        ))}
      {status.keys.length > 0 && (
        <Stack as="ul" gap={2} label={t("approvalDevices.listLabel")}>
          {status.keys.map((key) => (
            <li key={key.keyId}>
              <ListRow
                boxed
                title={`${key.name} · ${t(key.keyId === status.thisKeyId ? "approvalDevices.thisDevice" : "approvalDevices.elsewhere")}`}
                meta={t("approvalDevices.detail", {
                  client: key.client,
                  address: key.address,
                  date: store.formatDateTime(key.enrolledAt),
                })}
                trailing={
                  enrolledHere && (
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
                  )
                }
              />
            </li>
          ))}
        </Stack>
      )}
      {!status.protectionOff && !hasKey && (
        <p className="text-sm" role="status">
          {t("approvalDevices.noKeyHere")}
        </p>
      )}
      {status.protectionOff && (
        <Form
          variant="panel"
          aria-label={t("approvalDevices.enrollTitle")}
          onSubmit={() =>
            void change(
              () =>
                store.approval.enroll(host.id, name.trim(), code.trim()).then((outcome) => {
                  if (outcome === "done") setCode("");
                  return outcome;
                }),
              t("approvalDevices.enrolled"),
            )
          }
        >
          <h4 className="font-medium text-sm">{t("approvalDevices.enrollTitle")}</h4>
          <Field label={t("approvalDevices.nameLabel")}>
            {(control) => (
              <Input
                {...control}
                value={name}
                maxLength={64}
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Field label={t("approvalDevices.codeLabel")} help={t("approvalDevices.enrollHint")}>
            {(control) => (
              <Input
                {...control}
                value={code}
                maxLength={256}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setCode(event.target.value)}
              />
            )}
          </Field>
          <FormActions
            submit={t("approvalDevices.enroll")}
            disabled={name.trim() === "" || code.trim() === ""}
            busy={busy}
          />
        </Form>
      )}
      {!status.protectionOff && enrolledHere && (
        <Panel title={t("approvalDevices.addTitle")} slot="approval-add-device">
          <div ref={addBox} tabIndex={-1} data-add-box>
            <p className="text-muted-foreground text-xs">{t("approvalDevices.addHint")}</p>
            {offer ? (
              <Form
                variant="panel"
                aria-label={t("approvalDevices.addOfferTitle")}
                onSubmit={() =>
                  void change(async () => {
                    const outcome = await store.approval.confirmAdd(host.id, offer);
                    if (outcome === "done") {
                      setOffer(null);
                      setAddText("");
                    } else setDone(t("approvalDevices.addDeclined"));
                    return outcome;
                  }, t("approvalDevices.addDone"))
                }
              >
                <h4 className="font-medium text-sm">{t("approvalDevices.addOfferTitle")}</h4>
                <p className="text-sm">
                  {t("approvalDevices.addOfferFor", { name: offer.name, host: offer.host })}
                </p>
                <p className="text-sm">
                  {t("approvalDevices.addOfferCode")}{" "}
                  <code className="font-mono">{offer.fingerprint}</code>
                </p>
                <p className="text-muted-foreground text-xs">{t("approvalDevices.addOfferHint")}</p>
                <FormActions
                  submit={t("approvalDevices.addConfirm")}
                  busy={busy}
                  cancel={t("approvalDevices.addCancel")}
                  onCancel={() => {
                    setOffer(null);
                    setAddText("");
                  }}
                />
              </Form>
            ) : (
              <Form
                variant="panel"
                aria-label={t("approvalDevices.addTitle")}
                onSubmit={() =>
                  void change(async () => {
                    setOffer(await store.approval.readAdd(host.id, addText.trim()));
                  }, null)
                }
              >
                <Field label={t("approvalDevices.addTextLabel")}>
                  {(control) => (
                    <Input
                      {...control}
                      value={addText}
                      maxLength={1024}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => setAddText(event.target.value)}
                    />
                  )}
                </Field>
                <FormActions
                  submit={t("approvalDevices.addRead")}
                  disabled={addText.trim() === ""}
                  busy={busy}
                />
              </Form>
            )}
          </div>
        </Panel>
      )}
      {!status.protectionOff && !enrolledHere && (
        <Panel title={t("approvalDevices.requestTitle")} slot="approval-request-add">
          <div ref={addBox} tabIndex={-1} data-add-box>
            <p className="text-muted-foreground text-xs">{t("approvalDevices.requestHint")}</p>
            {request ? (
              <Stack gap={2}>
                <Field label={t("approvalDevices.requestTextLabel")}>
                  {(control) => (
                    <Input
                      {...control}
                      readOnly
                      value={request.text}
                      spellCheck={false}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  )}
                </Field>
                <p className="text-sm">
                  {t("approvalDevices.addOfferCode")}{" "}
                  <code className="font-mono">{request.fingerprint}</code>
                </p>
                <p className="text-sm" role="status">
                  {t("approvalDevices.requestWaiting")}
                </p>
                <Inline>
                  <ActionButton variant="outline" onClick={reload}>
                    {t("approvalDevices.requestCheck")}
                  </ActionButton>
                  <ActionButton
                    variant="outline"
                    onClick={() =>
                      change(async () => {
                        await store.approval.removeLocalKey(host.id);
                        setRequest(null);
                      }, null)
                    }
                  >
                    {t("approvalDevices.addCancel")}
                  </ActionButton>
                </Inline>
              </Stack>
            ) : (
              <Form
                variant="panel"
                aria-label={t("approvalDevices.requestTitle")}
                onSubmit={() =>
                  void change(async () => {
                    setRequest(await store.approval.requestAdd(host.id, addName.trim()));
                  }, null)
                }
              >
                <Field label={t("approvalDevices.nameLabel")}>
                  {(control) => (
                    <Input
                      {...control}
                      value={addName}
                      maxLength={64}
                      autoComplete="off"
                      onChange={(event) => setAddName(event.target.value)}
                    />
                  )}
                </Field>
                <FormActions
                  submit={t("approvalDevices.requestShow")}
                  disabled={addName.trim() === ""}
                  busy={busy}
                />
              </Form>
            )}
          </div>
        </Panel>
      )}
      {hasKey && !request && (
        <Stack gap={1}>
          <p className="text-muted-foreground text-xs">{t("approvalDevices.removeLocalHint")}</p>
          <Inline>
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
          </Inline>
        </Stack>
      )}
      {notices}
      <p className="text-muted-foreground text-xs">{t("approvalDevices.scope")}</p>
    </Panel>
  );
}

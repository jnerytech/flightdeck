import { parsePairingLink } from "@flightdeck/protocol";
import { useState } from "react";
import { useBusy } from "@/components/feedback/busy";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Field, Form, FormActions } from "@/components/layout/form";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";

export interface HostDraft {
  name: string;
  address: string;
  port: string;
  token: string;
}

export const emptyDraft = (): HostDraft => ({ name: "", address: "", port: "7420", token: "" });

/** `ws://<address>:<port>/v1/ws`, with IPv6 addresses in brackets. */
export function draftUrl(draft: HostDraft): string {
  const host = draft.address.includes(":") ? `[${draft.address}]` : draft.address;
  return `ws://${host}:${draft.port}/v1/ws`;
}

/** Fields of a parsed pairing link, ready for the form. */
export function draftFromLink(url: string, name: string, token: string): HostDraft {
  const parsed = new URL(url.replace("ws://", "http://"));
  return { name, address: parsed.hostname.replace(/^\[|\]$/g, ""), port: parsed.port, token };
}

/**
 * Adds a host from a pasted `flightdeck://` link or from address, port and token. Saving goes
 * through `onSubmit`, which tests the connection first.
 */
export function HostForm(props: {
  initial?: HostDraft;
  notice?: string;
  error?: string | null;
  /** May return a promise: the form is busy until it settles (the connection is tested). */
  onSubmit(draft: HostDraft): unknown;
}) {
  const t = useT();
  const [busy, run] = useBusy();
  const [draft, setDraft] = useState<HostDraft>(props.initial ?? emptyDraft());
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof HostDraft) => (e: { target: { value: string } }) =>
    setDraft({ ...draft, [key]: e.target.value });
  const error = problem ?? props.error ?? null;

  return (
    <Form
      className="mx-auto p-6"
      onSubmit={() => {
        if (!draft.name.trim() || !draft.address.trim() || !draft.token.trim()) {
          setProblem(t("hostForm.missing"));
          return;
        }
        const port = Number(draft.port);
        if (!/^\d+$/.test(draft.port) || port < 1 || port > 65535) {
          setProblem(t("hostForm.badPort"));
          return;
        }
        setProblem(null);
        run(() =>
          props.onSubmit({ ...draft, name: draft.name.trim(), address: draft.address.trim() }),
        );
      }}
    >
      {props.notice && <InlineNotice>{props.notice}</InlineNotice>}
      <Field label={t("hostForm.link")} error={linkError}>
        {(control) => (
          <Input
            {...control}
            value={link}
            placeholder="flightdeck://…"
            onChange={(e) => {
              setLink(e.target.value);
              const parsed = parsePairingLink(e.target.value);
              setLinkError(parsed.ok || !e.target.value ? null : parsed.error);
              if (parsed.ok) {
                setDraft(draftFromLink(parsed.value.url, parsed.value.name, parsed.value.token));
              }
            }}
          />
        )}
      </Field>
      <Field label={t("hostForm.name")}>
        {(control) => (
          <Input
            {...control}
            value={draft.name}
            onChange={set("name")}
            placeholder={t("hostForm.namePlaceholder")}
          />
        )}
      </Field>
      <Field label={t("hostForm.address")}>
        {(control) => (
          <Input
            {...control}
            value={draft.address}
            onChange={set("address")}
            placeholder="100.64.0.1"
          />
        )}
      </Field>
      <Field label={t("hostForm.port")}>
        {(control) => (
          <Input {...control} value={draft.port} onChange={set("port")} inputMode="numeric" />
        )}
      </Field>
      <Field label={t("hostForm.token")}>
        {(control) => (
          <Input {...control} type="password" value={draft.token} onChange={set("token")} />
        )}
      </Field>
      {error && (
        <p role="alert" className="text-sm text-status-error">
          {error}
        </p>
      )}
      <FormActions submit={t("hostForm.submit")} busy={busy} />
    </Form>
  );
}

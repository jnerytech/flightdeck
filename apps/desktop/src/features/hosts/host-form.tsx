import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import { InlineNotice, useBusy } from "@/shared/feedback/index.ts";
import { Field, Form, FormActions, Stack } from "@/shared/layout/index.ts";
import { type BoundToken, maskOnLeave, readLinkEdit } from "./domain/pairing-mask.ts";
import { pairingErrorText } from "./domain/pairing-text.ts";

export interface HostDraft {
  name: string;
  address: string;
  port: string;
  token: string;
}

/** The fields filled in by hand, in the order the form shows them. */
const FIELDS = ["name", "address", "port", "token"] as const;
type FieldName = (typeof FIELDS)[number];

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
export function HostForm(
  props: Readonly<{
    initial?: HostDraft;
    notice?: string;
    error?: string | null;
    /** May return a promise: the form is busy until it settles (the connection is tested). */
    onSubmit(draft: HostDraft): unknown;
  }>,
) {
  const t = useT();
  const [busy, run] = useBusy();
  const [draft, setDraft] = useState<HostDraft>(props.initial ?? emptyDraft());
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  /** The token the pasted link carried and the host it was read with (never the Token field's own). */
  const [bound, setBound] = useState<BoundToken | null>(null);
  /** What is wrong with each field the last submit refused, in words that name it (#2585). */
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  /** The field that takes the focus once the form has drawn its error. */
  const [focusOn, setFocusOn] = useState<FieldName | "link" | null>(null);
  /** The connection test's error the person has answered by editing the token. */
  const [answered, setAnswered] = useState<string | null>(null);
  const inputs = useRef<Partial<Record<FieldName | "link", HTMLInputElement | null>>>({});
  // The fields to fill by hand are folded; they open on what needs them: a draft (a link from
  // outside), a pasted link they now show, or an error to fix there (#1199).
  const [byHand, setByHand] = useState(props.initial !== undefined);
  const set = (key: FieldName) => (e: { target: { value: string } }) => {
    setDraft({ ...draft, [key]: e.target.value });
    setFieldErrors(({ [key]: _gone, ...rest }) => rest);
    if (key === "token") setAnswered(props.error ?? null);
  };
  // A refused token is the token field's to say; the other errors of the test stay in one line.
  const refusal = props.error === t("hostForm.probeRefused");
  const refused = refusal && answered !== props.error;
  const error = refusal ? null : (props.error ?? null);
  const tokenError = fieldErrors.token ?? (refused ? props.error : null);
  const input = (key: FieldName | "link") => (element: HTMLInputElement | null) => {
    inputs.current[key] = element;
  };
  useEffect(() => {
    if (focusOn === null) return;
    inputs.current[focusOn]?.focus();
    setFocusOn(null);
  }, [focusOn]);
  // An error from the connection test (the form's own are opened in `onSubmit`).
  useEffect(() => {
    if (props.error) setByHand(true);
  }, [props.error]);

  return (
    <Form
      onSubmit={() => {
        // A link typed by hand is masked as the form goes, the field not left (#1548).
        setLink(maskOnLeave(link));
        setAnswered(null);
        // A link that is refused names a host the form does not hold: it is fixed or emptied first.
        if (linkError) {
          setFocusOn("link");
          return;
        }
        const refusal: Partial<Record<FieldName, string>> = {};
        if (!draft.name.trim()) refusal.name = t("hostForm.missingName");
        if (!draft.address.trim()) refusal.address = t("hostForm.missingAddress");
        const port = Number(draft.port);
        if (!/^\d+$/.test(draft.port) || port < 1 || port > 65535) {
          refusal.port = t("hostForm.badPort");
        }
        if (!draft.token.trim()) refusal.token = t("hostForm.missingToken");
        setFieldErrors(refusal);
        const first = FIELDS.find((key) => refusal[key]);
        if (first) {
          setByHand(true);
          setFocusOn(first);
          return;
        }
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
            ref={input("link")}
            value={link}
            placeholder="flightdeck://…"
            // A typed link shows its token until the field is left: not for autofill, history or the spellchecker.
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            onChange={(e) => {
              const inputType = (e.nativeEvent as { inputType?: string }).inputType ?? "";
              const edit = readLinkEdit(e.target.value, link, bound, inputType);
              setLink(edit.shown);
              setLinkError(edit.problem ? pairingErrorText(t, edit.problem) : null);
              if (edit.fields) {
                setDraft({ ...draft, ...edit.fields });
                setByHand(true);
              } else if (bound && !edit.bound && draft.token === bound.token) {
                // The link that carried the token no longer has one: the form does not keep it.
                setDraft({ ...draft, token: "" });
              }
              setBound(edit.bound);
            }}
            // A link that was typed is masked when the field is left (#1548).
            onBlur={() => setLink(maskOnLeave(link))}
          />
        )}
      </Field>
      <details
        className="host-fold"
        open={byHand}
        onToggle={(event) => setByHand(event.currentTarget.open)}
      >
        <summary>{t("hostForm.byHand")}</summary>
        <Stack gap={4}>
          <Field label={t("hostForm.name")} error={fieldErrors.name}>
            {(control) => (
              <Input
                {...control}
                ref={input("name")}
                value={draft.name}
                onChange={set("name")}
                placeholder={t("hostForm.namePlaceholder")}
              />
            )}
          </Field>
          <Field label={t("hostForm.address")} error={fieldErrors.address}>
            {(control) => (
              <Input
                {...control}
                ref={input("address")}
                value={draft.address}
                onChange={set("address")}
                placeholder="100.64.0.1" // NOSONAR: an example address in a placeholder
              />
            )}
          </Field>
          <Field label={t("hostForm.port")} error={fieldErrors.port}>
            {(control) => (
              <Input
                {...control}
                ref={input("port")}
                value={draft.port}
                onChange={set("port")}
                inputMode="numeric"
              />
            )}
          </Field>
          <Field label={t("hostForm.token")} error={tokenError}>
            {(control) => (
              <Input
                {...control}
                ref={input("token")}
                type="password"
                value={draft.token}
                onChange={set("token")}
              />
            )}
          </Field>
        </Stack>
      </details>
      {error && (
        <p role="alert" className="text-sm text-status-error">
          {error}
        </p>
      )}
      <FormActions submit={t("hostForm.submit")} busy={busy} />
    </Form>
  );
}

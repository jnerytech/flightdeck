import { parsePairingLink } from "@flightdeck/protocol";
import { useId, useState } from "react";
import { Spinner, useBusy } from "@/components/feedback/busy";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Button } from "@/components/ui/button";
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
  const id = useId();
  const [busy, run] = useBusy();
  const [draft, setDraft] = useState<HostDraft>(props.initial ?? emptyDraft());
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof HostDraft) => (e: { target: { value: string } }) =>
    setDraft({ ...draft, [key]: e.target.value });
  const error = problem ?? props.error ?? null;

  return (
    <form
      className="mx-auto flex w-full max-w-md flex-col gap-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
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
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-link`}>
        {t("hostForm.link")}
        <Input
          id={`${id}-link`}
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
      </label>
      {linkError && <small className="text-status-error text-xs">{linkError}</small>}
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-name`}>
        {t("hostForm.name")}
        <Input
          id={`${id}-name`}
          value={draft.name}
          onChange={set("name")}
          placeholder={t("hostForm.namePlaceholder")}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-address`}>
        {t("hostForm.address")}
        <Input
          id={`${id}-address`}
          value={draft.address}
          onChange={set("address")}
          placeholder="100.64.0.1"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-port`}>
        {t("hostForm.port")}
        <Input id={`${id}-port`} value={draft.port} onChange={set("port")} inputMode="numeric" />
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-token`}>
        {t("hostForm.token")}
        <Input id={`${id}-token`} type="password" value={draft.token} onChange={set("token")} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-status-error">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
        {busy && <Spinner />}
        {t("hostForm.submit")}
      </Button>
    </form>
  );
}

import { parsePairingLink } from "@flightdeck/protocol";
import { useState } from "react";

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
  onSubmit(draft: HostDraft): void;
}) {
  const [draft, setDraft] = useState<HostDraft>(props.initial ?? emptyDraft());
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof HostDraft) => (e: { target: { value: string } }) =>
    setDraft({ ...draft, [key]: e.target.value });
  const error = problem ?? props.error ?? null;

  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.name.trim() || !draft.address.trim() || !draft.token.trim()) {
          setProblem("preencha nome, endereço, porta e token");
          return;
        }
        const port = Number(draft.port);
        if (!/^\d+$/.test(draft.port) || port < 1 || port > 65535) {
          setProblem("porta inválida");
          return;
        }
        setProblem(null);
        props.onSubmit({ ...draft, name: draft.name.trim(), address: draft.address.trim() });
      }}
    >
      {props.notice && <p className="notice">{props.notice}</p>}
      <label>
        Link de pareamento
        <input
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
      {linkError && <small className="field-error">{linkError}</small>}
      <label>
        Nome
        <input value={draft.name} onChange={set("name")} placeholder="meu pc" />
      </label>
      <label>
        Endereço
        <input value={draft.address} onChange={set("address")} placeholder="100.64.0.1" />
      </label>
      <label>
        Porta
        <input value={draft.port} onChange={set("port")} inputMode="numeric" />
      </label>
      <label>
        Token
        <input type="password" value={draft.token} onChange={set("token")} />
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button type="submit" className="primary">
        Testar e adicionar
      </button>
    </form>
  );
}

/** Pairing links: `flightdeck://<address>:<port>?name=<hostName>&token=<token>`. */

export const PAIRING_SCHEME = "flightdeck://";

export interface PairingTarget {
  address: string;
  port: number;
  name: string;
  token: string;
}

export interface PairingValue {
  name: string;
  /** WebSocket URL of the daemon. */
  url: string;
  token: string;
}

export type PairingParse = { ok: true; value: PairingValue } | { ok: false; error: string };

const bracket = (address: string) => (address.includes(":") ? `[${address}]` : address);

export function formatPairingLink(target: PairingTarget): string {
  const query = `name=${encodeURIComponent(target.name)}&token=${encodeURIComponent(target.token)}`;
  return `${PAIRING_SCHEME}${bracket(target.address)}:${target.port}?${query}`;
}

const LINK = /^flightdeck:\/\/(\[[0-9a-fA-F:.]+\]|[^/:?#[\]\s]+)(?::([^/?#]*))?\/?(?:\?(.*))?$/;

/** Parses a pairing link (pasted or opened as a deep link). Never throws. */
export function parsePairingLink(link: string): PairingParse {
  const text = link.trim();
  if (!text.toLowerCase().startsWith(PAIRING_SCHEME)) {
    return { ok: false, error: "esquema inválido" };
  }
  const match = LINK.exec(PAIRING_SCHEME + text.slice(PAIRING_SCHEME.length));
  if (!match) return { ok: false, error: "endereço inválido" };
  const [, host = "", portText = "", query = ""] = match;
  const port = Number(portText);
  if (!/^\d{1,5}$/.test(portText) || port < 1 || port > 65535) {
    return { ok: false, error: "porta inválida" };
  }
  const params = new URLSearchParams(query);
  const token = params.get("token");
  if (!token) return { ok: false, error: "token ausente" };
  const name = params.get("name") || host.replace(/^\[|\]$/g, "");
  return { ok: true, value: { name, url: `ws://${host}:${port}/v1/ws`, token } };
}

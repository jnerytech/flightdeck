/** Loopback only, IPv4 and IPv6. */
export const DEFAULT_ALLOWED_NETWORKS: string[] = ["127.0.0.0/8", "::1/128"];

interface Address {
  v6: boolean;
  value: bigint;
}

function parseV4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    value = (value << 8n) | BigInt(part);
  }
  return value;
}

function parseV6(text: string): bigint | null {
  let groups: string[];
  let tail: bigint | null = null;
  const lastColon = text.lastIndexOf(":");
  // Embedded IPv4 in the last 32 bits, e.g. ::ffff:127.0.0.1
  if (text.includes(".")) {
    tail = parseV4(text.slice(lastColon + 1));
    if (tail === null) return null;
    text = `${text.slice(0, lastColon + 1)}0:0`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return tail === null ? value : (value & ~0xffffffffn) | tail;
}

function parseAddress(text: string): Address | null {
  const v4 = parseV4(text);
  if (v4 !== null) return { v6: false, value: v4 };
  const v6 = parseV6(text);
  return v6 === null ? null : { v6: true, value: v6 };
}

const MAPPED_PREFIX = 0xffffn << 32n;

/** IPv4-mapped IPv6 (::ffff:a.b.c.d) is matched as the IPv4 it carries. */
function unmap(address: Address): Address {
  if (address.v6 && address.value >> 32n === 0xffffn) {
    return { v6: false, value: address.value - MAPPED_PREFIX };
  }
  return address;
}

interface Network extends Address {
  prefix: number;
}

export function parseCidr(cidr: string): Network | null {
  const [ip = "", bits, ...extra] = cidr.split("/");
  if (bits === undefined || extra.length > 0 || !/^\d{1,3}$/.test(bits)) return null;
  const address = parseAddress(ip);
  const prefix = Number(bits);
  if (!address || prefix > (address.v6 ? 128 : 32)) return null;
  return { ...address, prefix };
}

function contains(network: Network, address: Address): boolean {
  if (network.v6 !== address.v6) return false;
  const width = network.v6 ? 128n : 32n;
  const shift = width - BigInt(network.prefix);
  return network.value >> shift === address.value >> shift;
}

/** True when `ip` lies in any of the CIDR `networks`. Invalid input never matches. */
export function ipInNetworks(ip: string, networks: readonly string[]): boolean {
  const parsed = parseAddress(ip);
  if (!parsed) return false;
  const address = unmap(parsed);
  return networks.some((cidr) => {
    const network = parseCidr(cidr);
    return network !== null && contains(network, address);
  });
}

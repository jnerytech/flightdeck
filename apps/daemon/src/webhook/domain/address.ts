/**
 * The address checks behind the webhook sender's SSRF guard (#465): which addresses a webhook may
 * reach. Pure over an address string and its kind (`isIP`'s answer: 4, 6 or 0), which the sender
 * reads with `node:net`.
 */

function ipv4Public(octets: number[]): boolean {
  const [a, b] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

/** The eight 16-bit groups of an IPv6 address; the dotted tail of a mapped IPv4 becomes two groups. */
function groupsOf(address: string): number[] {
  let text = address;
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text); // NOSONAR: a validated IP address (isIP), 45 chars at most
  if (tail) {
    const [, a, b, c, d] = tail.map(Number) as [number, number, number, number, number];
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", rest] = text.split("::");
  const front = head === "" ? [] : head.split(":");
  const back = rest === undefined || rest === "" ? [] : rest.split(":");
  const fill = rest === undefined ? 0 : 8 - front.length - back.length;
  return [...front, ...new Array(fill).fill("0"), ...back].map((group) =>
    Number.parseInt(group, 16),
  );
}

/** Whether an address of this kind (`isIP`'s answer) is one a webhook may be sent to: not private, link-local, loopback or reserved. */
export function isPublicIp(address: string, kind: number): boolean {
  if (kind === 4) return ipv4Public(address.split(".").map(Number));
  if (kind !== 6) return false;
  const g = groupsOf(address);
  const [g0 = 0, , , , , g5 = 0, g6 = 0, g7 = 0] = g;
  if (g.slice(0, 5).every((group) => group === 0) && g5 === 0xffff) {
    return ipv4Public([g6 >> 8, g6 & 255, g7 >> 8, g7 & 255]);
  }
  if (g.every((group) => group === 0) || (g.slice(0, 7).every((x) => x === 0) && g7 === 1)) {
    return false;
  }
  return (g0 & 0xfe00) !== 0xfc00 && (g0 & 0xffc0) !== 0xfe80 && (g0 & 0xff00) !== 0xff00;
}

/** Whether an address of this kind (`isIP`'s answer) is the loopback one. */
export const isLoopbackIp = (address: string, kind: number): boolean => {
  if (kind === 4) return address.startsWith("127.");
  const g = kind === 6 ? groupsOf(address) : [];
  return g.length === 8 && g.slice(0, 7).every((x) => x === 0) && g[7] === 1;
};

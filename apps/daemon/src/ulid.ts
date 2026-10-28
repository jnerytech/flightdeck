const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastTime = -1;
let lastRandom: number[] = [];

/** Monotonic ULID (Crockford base32, 26 chars). */
export function ulid(now: number = Date.now()): string {
  let random: number[];
  if (now === lastTime) {
    random = increment(lastRandom);
  } else {
    random = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b % 32);
  }
  lastTime = now;
  lastRandom = random;

  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return time + random.map((d) => ALPHABET[d]).join("");
}

function increment(digits: number[]): number[] {
  const next = [...digits];
  let i = next.length - 1;
  while (i >= 0 && next[i] === 31) {
    next[i] = 0;
    i--;
  }
  if (i >= 0) next[i] = (next[i] ?? 0) + 1;
  return next;
}

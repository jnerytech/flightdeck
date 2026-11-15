import { createHash } from "node:crypto";

export const TOKEN = "cofre-token-0123456789abcdef";
export const VALUE = "ghp_SEGREDO-DE-TESTE-9f3a1c7e\ncom quebra e acentuação é ç 中";
export const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export const echo = { echo: sha };

export const cleanups: Array<() => unknown> = [];

export async function runCleanups() {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

export const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (error) {
    return `${(error as { code?: string }).code}: ${(error as Error).message}`;
  }
};

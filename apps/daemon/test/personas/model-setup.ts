import type { PersonaInput } from "@flightdeck/protocol";
import { SecretScanner } from "../../src/snippets/domain/model.ts";

export const scanner = new SecretScanner();

export const SECURITY = [
  "---",
  "id: seguranca",
  "name: Revisor de segurança",
  "description: Revisa mudanças procurando falhas de segurança e explica o risco de cada uma",
  "icon: shield",
  "model: claude-opus-5-5",
  "effort: high",
  "tools: [Read, Grep, Glob, Bash]",
  "permissionMode: plan",
  "---",
  "Você atua como revisor de segurança sênior.",
  "- Procure injeção (SQL, comando, caminho), segredos expostos, validação faltando.",
  "- Classifique cada achado por gravidade e mostre a linha.",
  "- Não altere código: proponha a correção.",
  "",
].join("\n");

/** The error code of a call that is expected to fail. */
export async function codeOf(fn: () => unknown): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
}

export const input = (extra: Record<string, unknown> = {}): PersonaInput =>
  ({
    id: "revisor",
    name: "Revisor",
    description: "Revisa código",
    body: "Revise o código com cuidado.",
    ...extra,
  }) as PersonaInput;

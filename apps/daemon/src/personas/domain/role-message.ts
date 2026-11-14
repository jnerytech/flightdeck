import type { Language } from "./language.ts";

/** The message that makes the Claude take a role: the body of the persona, as a conversation instruction. */
export function roleMessage(name: string, body: string, language: Language): string {
  return language === "en"
    ? `From now on, act as "${name}" until I ask you to leave the role. Role instructions:\n\n${body}`
    : `A partir de agora, atue como "${name}" até eu pedir para sair do papel. Instruções do papel:\n\n${body}`;
}

/** The message that ends it. */
export function leaveMessage(name: string, language: Language): string {
  return language === "en"
    ? `Leave the "${name}" role and go back to your normal behavior.`
    : `Saia do papel de "${name}" e volte ao seu comportamento normal.`;
}

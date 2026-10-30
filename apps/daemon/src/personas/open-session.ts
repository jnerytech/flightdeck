import type { PersonaSwitchResult, SessionPersona } from "@flightdeck/protocol";
import { type Central, messageExternal } from "../central/central.ts";
import { FlightdeckError } from "../errors.ts";
import type { SessionManager } from "../sessions/session-manager.ts";
import type { PersonaContext, PersonaRef, ResolvedPersona } from "./store.ts";

export interface OpenSessionPersonasOptions {
  /** Resolves a persona (the project's, the host's, the pack's or one from the app). */
  personas?: { resolve(ref: PersonaRef, ctx: PersonaContext): ResolvedPersona };
  manager: Pick<SessionManager, "get" | "send" | "appliedPersona" | "markPersona">;
  /** Terminal sessions and their channels (phase 5). */
  central?: Pick<Central, "external" | "receptor">;
}

export interface SwitchTarget {
  sessionId?: string | undefined;
  claudeSessionId?: string | undefined;
}

type Language = "pt-BR" | "en";

const badRequest = (message: string) => new FlightdeckError("bad_request", message);

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

/**
 * Applies a persona to a session that is already open, and takes it back (phase 20). It is a
 * message of the conversation, not the system prompt: the model, effort and tools of the persona
 * do not change in a session that is running. It works for a managed session and for a terminal
 * session whose channel is connected, and leaves a mark on the timeline.
 */
export class OpenSessionPersonas {
  constructor(private readonly opts: OpenSessionPersonasOptions) {}

  async apply(request: SwitchTarget & { persona: PersonaRef }): Promise<PersonaSwitchResult> {
    const target = this.target(request);
    const cwd = target.managed
      ? this.opts.manager.get(target.id).cwd
      : (this.external().external.get(target.id)?.cwd ?? undefined);
    if (!target.managed && !this.external().external.get(target.id)) {
      throw new FlightdeckError("not_found", `sessão ${target.id} não existe`);
    }
    if (!this.opts.personas) {
      throw new FlightdeckError("invalid_state", "personas indisponíveis neste host");
    }
    const language = request.persona.language ?? "pt-BR";
    const resolved = this.opts.personas.resolve(request.persona, { projectPath: cwd, language });
    const badge: SessionPersona = {
      id: resolved.persona.id,
      name: resolved.persona.name,
      icon: resolved.persona.icon,
    };
    const text = roleMessage(badge.name, resolved.persona.body, language);
    this.deliver(target, text);
    this.mark(target, badge);
    return { persona: badge, text };
  }

  async clear(request: SwitchTarget & { language?: Language }): Promise<PersonaSwitchResult> {
    const target = this.target(request);
    const applied = target.managed
      ? this.opts.manager.appliedPersona(target.id)
      : this.external().external.appliedPersona(target.id);
    if (!target.managed && !this.external().external.get(target.id)) {
      throw new FlightdeckError("not_found", `sessão ${target.id} não existe`);
    }
    if (!applied)
      throw new FlightdeckError("invalid_state", "nenhuma persona foi aplicada a esta sessão");
    const text = leaveMessage(applied.name, request.language ?? "pt-BR");
    this.deliver(target, text);
    this.mark(target, null);
    return { persona: applied, text };
  }

  private target(request: SwitchTarget): { managed: boolean; id: string } {
    if ((request.sessionId === undefined) === (request.claudeSessionId === undefined)) {
      throw badRequest("informe sessionId ou claudeSessionId, um dos dois");
    }
    return request.sessionId !== undefined
      ? { managed: true, id: request.sessionId }
      : { managed: false, id: request.claudeSessionId as string };
  }

  private external(): Pick<Central, "external" | "receptor"> {
    if (!this.opts.central)
      throw new FlightdeckError("invalid_state", "sessões de terminal indisponíveis");
    return this.opts.central;
  }

  private deliver(target: { managed: boolean; id: string }, text: string): void {
    if (target.managed) {
      this.opts.manager.send(target.id, text);
    } else if (!messageExternal(this.external(), target.id, text)) {
      throw new FlightdeckError(
        "invalid_state",
        "sessão sem canal: só sessões abertas com flightdeckd claude recebem mensagens",
      );
    }
  }

  private mark(target: { managed: boolean; id: string }, badge: SessionPersona | null): void {
    if (target.managed) this.opts.manager.markPersona(target.id, badge);
    else this.external().external.setPersona(target.id, badge);
  }
}

import type { Key, Lang } from "./index.ts";

/**
 * The words simple mode puts over the shared screens' (phase 33); the key is the full-mode one.
 * The main renames: session to task, needs you to waiting for your answer, persona to style,
 * host and project to computer and folder.
 */
export const SIMPLE_RENAMES: Record<Lang, Partial<Record<Key, string>>> = {
  en: {
    "sidebar.sessions": "Tasks",
    "sidebar.needsYou": "Waiting for your answer",
    "sidebar.projects": "Folders",
    "sidebar.hosts": "Computers",
    "sidebar.addHost": "Add a computer",
    "sidebar.personas": "Styles",
    "session.end": "Stop the task",
    "session.endMessage": "Stop this task? Claude stops working on it; you can ask again later.",
    "session.endConfirm": "Stop the task",
    "session.resume": "Continue",
  },
  "pt-BR": {
    "sidebar.sessions": "Tarefas",
    "sidebar.needsYou": "Esperando a sua resposta",
    "sidebar.projects": "Pastas",
    "sidebar.hosts": "Computadores",
    "sidebar.addHost": "Adicionar um computador",
    "sidebar.personas": "Estilos",
    "session.end": "Parar a tarefa",
    "session.endMessage":
      "Parar esta tarefa? O Claude para de trabalhar nela; dá para pedir de novo depois.",
    "session.endConfirm": "Parar a tarefa",
    "session.resume": "Continuar",
  },
};

import type { Template } from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";
import type { TaskState } from "../../lib/simple-task.ts";

export interface HomeTask {
  sessionId: string;
  title: string;
  state: TaskState;
}

export interface HomeViewProps {
  templates: Template[];
  tasks: HomeTask[];
  t: T;
  /** Where the folder dialog is available, the field offers it (the desktop app on this machine). */
  canPickFolder: boolean;
  onPickFolder(): Promise<string | null>;
  /** Starts a task; resolves when it has started (the screen then moves to it). */
  onStart(templateId: string, values: Record<string, string>): Promise<void>;
  onOpenTask(sessionId: string): void;
}

/** The first place of simple mode: the templates, what waits for an answer, the recent tasks. */
export function HomeView(_props: HomeViewProps) {
  return null;
}

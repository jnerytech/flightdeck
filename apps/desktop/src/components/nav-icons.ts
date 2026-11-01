import {
  CircleAlert,
  Coins,
  Columns3,
  Drama,
  History,
  KeyRound,
  Layers,
  type LucideIcon,
  MessagesSquare,
  Network,
  Settings,
  SquareCode,
  UsersRound,
  Workflow,
} from "lucide-react";

/** The screens the sidebar lists. */
export type NavKey =
  | "sessions"
  | "needs-you"
  | "board"
  | "workflows"
  | "costs"
  | "conversations"
  | "teams"
  | "personas"
  | "snippets"
  | "connections"
  | "vault"
  | "history"
  | "settings";

/** The one icon of each screen the sidebar lists: the sidebar and the tab of that screen both read it. */
export const NAV_ICONS: Record<NavKey, LucideIcon> = {
  sessions: Layers,
  "needs-you": CircleAlert,
  board: Columns3,
  workflows: Workflow,
  costs: Coins,
  conversations: MessagesSquare,
  teams: UsersRound,
  personas: Drama,
  snippets: SquareCode,
  connections: Network,
  vault: KeyRound,
  history: History,
  settings: Settings,
};

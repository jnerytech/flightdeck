import {
  Briefcase,
  CircleAlert,
  Coins,
  Columns3,
  Drama,
  FolderGit2,
  History,
  House,
  KeyRound,
  Layers,
  type LucideIcon,
  MessagesSquare,
  Network,
  Puzzle,
  Server,
  Settings,
  SquareCode,
  UsersRound,
  Workflow,
} from "lucide-react";

/** The screens the sidebar lists. */
export type NavKey =
  | "overview"
  | "sessions"
  | "needs-you"
  | "projects"
  | "board"
  | "workflows"
  | "costs"
  | "conversations"
  | "teams"
  | "personas"
  | "clients"
  | "snippets"
  | "connections"
  | "vault"
  | "history"
  | "host"
  | "plugins"
  | "settings";

/** The one icon of each screen the sidebar lists: the sidebar and the tab of that screen both read it. */
export const NAV_ICONS: Record<NavKey, LucideIcon> = {
  overview: House,
  sessions: Layers,
  "needs-you": CircleAlert,
  projects: FolderGit2,
  board: Columns3,
  workflows: Workflow,
  costs: Coins,
  conversations: MessagesSquare,
  teams: UsersRound,
  personas: Drama,
  clients: Briefcase,
  snippets: SquareCode,
  connections: Network,
  vault: KeyRound,
  history: History,
  host: Server,
  plugins: Puzzle,
  settings: Settings,
};

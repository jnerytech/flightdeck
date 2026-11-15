import { lazyScreen } from "./lazy-screen.ts";
import type { RouteTable } from "./route-table.ts";

const ActionsPage = lazyScreen(() => import("../features/actions/page.tsx"), "ActionsPage");
const AgentPage = lazyScreen(() => import("../features/agentcfg/page.tsx"), "AgentPage");
const Automations = lazyScreen(() => import("../features/automations/page.tsx"), "AutomationsPage");
const BoardView = lazyScreen(() => import("../features/board/board-view.tsx"), "BoardView");
const CardDetail = lazyScreen(() => import("../features/board/card-detail.tsx"), "CardDetail");
const PrsPage = lazyScreen(() => import("../features/board/pull-requests.tsx"), "PullRequestsPage");
const HomePage = lazyScreen(() => import("../features/home/page.tsx"), "HomePage");
const ProjectPage = lazyScreen(() => import("../features/projects/project.tsx"), "ProjectPage");
const WorkflowsPage = lazyScreen(() => import("../features/workflows/page.tsx"), "WorkflowsPage");

/** The routes of a project: its board, cards and pull requests, and the pages of its automation. */
export const BOARD_ROUTES = {
  "pull-requests": ({ store, go }) => <PrsPage store={store} go={go} />,
  project: ({ store, state, go }, route) => (
    <ProjectPage
      key={`${route.host}/${route.projectId}`}
      store={store}
      state={state}
      hostId={route.host}
      projectId={route.projectId}
      go={go}
    />
  ),
  overview: ({ store, state, go }) => <HomePage store={store} state={state} go={go} />,
  board: ({ store, go }, route) => (
    <BoardView
      key={`${route.host}/${route.projectId}`}
      store={store}
      hostId={route.host}
      projectId={route.projectId}
      newCard={route.newCard === true}
      onOpenCard={(cardId, edit) =>
        go({
          name: "card",
          host: route.host,
          projectId: route.projectId,
          cardId,
          ...(edit ? { edit: true as const } : {}),
        })
      }
      onOpenProject={(projectId) => go({ name: "board", host: route.host, projectId })}
      onOpenSettings={() => go({ name: "settings", section: "assistant" })}
    />
  ),
  card: ({ store, go }, route) => (
    <CardDetail
      key={route.cardId}
      store={store}
      hostId={route.host}
      cardId={route.cardId}
      edit={route.edit === true}
      onOpenSettings={() => go({ name: "settings", section: "assistant" })}
      onBack={() => go({ name: "board", host: route.host, projectId: route.projectId })}
      onOpenCard={(cardId) =>
        go({ name: "card", host: route.host, projectId: route.projectId, cardId })
      }
      onOpenWorkflows={(project) =>
        go({
          name: "workflows",
          host: route.host,
          projectId: project.id,
          projectName: project.name,
        })
      }
    />
  ),
  agent: ({ store }, route) => (
    <AgentPage
      key={`${route.host}/${route.projectId}`}
      store={store}
      hostId={route.host}
      projectId={route.projectId}
      projectName={route.projectName}
    />
  ),
  automations: ({ store }, route) => (
    <Automations
      key={`${route.host}/${route.projectId}`}
      store={store}
      hostId={route.host}
      projectId={route.projectId}
      projectName={route.projectName}
    />
  ),
  actions: ({ store }, route) => (
    <ActionsPage
      // A draft handed over opens a fresh screen, with its form.
      key={`${route.host}/${route.projectId}/${JSON.stringify(route.draft ?? null)}`}
      store={store}
      hostId={route.host}
      projectId={route.projectId}
      projectName={route.projectName}
      draft={route.draft}
    />
  ),
  workflows: ({ store }, route) => (
    <WorkflowsPage
      key={`${route.host}/${route.projectId}`}
      store={store}
      hostId={route.host}
      projectId={route.projectId}
      projectName={route.projectName}
    />
  ),
} satisfies RouteTable<
  | "pull-requests"
  | "project"
  | "overview"
  | "board"
  | "card"
  | "agent"
  | "automations"
  | "actions"
  | "workflows"
>;

import { Page } from "@/components/layout/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AppStore } from "../lib/app-store.ts";
import { AgentFiles } from "./AgentFiles.tsx";
import { AgentMcp } from "./AgentMcp.tsx";

/** A project's agent (phase 12): its MCP servers, CLAUDE.md files, agents and skills. */
export function AgentPage(props: {
  store: AppStore;
  hostId: string;
  projectId: string;
  projectName: string;
}) {
  const { store, hostId, projectId } = props;
  const { t } = store.i18n;
  return (
    <Page title={t("agent.title", { project: props.projectName })} subtitle={t("agent.subtitle")}>
      <Tabs defaultValue="mcp">
        <TabsList aria-label={t("agent.tabs")}>
          <TabsTrigger value="mcp">{t("agent.tabMcp")}</TabsTrigger>
          <TabsTrigger value="claudemd">{t("agent.tabClaudeMd")}</TabsTrigger>
          <TabsTrigger value="agent">{t("agent.tabAgents")}</TabsTrigger>
          <TabsTrigger value="skill">{t("agent.tabSkills")}</TabsTrigger>
        </TabsList>
        <TabsContent value="mcp">
          <AgentMcp store={store} hostId={hostId} projectId={projectId} />
        </TabsContent>
        {(["claudemd", "agent", "skill"] as const).map((kind) => (
          <TabsContent key={kind} value={kind}>
            <AgentFiles store={store} hostId={hostId} projectId={projectId} kind={kind} />
          </TabsContent>
        ))}
      </Tabs>
    </Page>
  );
}

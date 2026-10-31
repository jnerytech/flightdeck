import { Page } from "@/components/layout/page";
import { SubagentsSwitch } from "@/components/personas/subagents-switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AppStore } from "../lib/app-store.ts";
import { hasFeature } from "../lib/version.ts";
import { AgentFiles } from "./AgentFiles.tsx";
import { AgentMcp } from "./AgentMcp.tsx";
import { AgentMemory } from "./AgentMemory.tsx";

/** A project's agent (phase 12): its MCP servers, CLAUDE.md files, agents and skills. */
export function AgentPage(props: {
  store: AppStore;
  hostId: string;
  projectId: string;
  projectName: string;
}) {
  const { store, hostId, projectId } = props;
  const { t } = store.i18n;
  const host = store.getState().hosts.find((h) => h.id === hostId);
  const withMemory = hasFeature(host?.hostInfo?.features, "memory", false);
  return (
    <Page title={t("agent.title", { project: props.projectName })} subtitle={t("agent.subtitle")}>
      {hasFeature(host?.hostInfo?.features, "personas", false) && (
        <SubagentsSwitch store={store} hostId={hostId} projectId={projectId} />
      )}
      <Tabs defaultValue="mcp">
        <TabsList aria-label={t("agent.tabs")}>
          <TabsTrigger value="mcp">{t("agent.tabMcp")}</TabsTrigger>
          <TabsTrigger value="claudemd">{t("agent.tabClaudeMd")}</TabsTrigger>
          <TabsTrigger value="agent">{t("agent.tabAgents")}</TabsTrigger>
          <TabsTrigger value="skill">{t("agent.tabSkills")}</TabsTrigger>
          {withMemory && <TabsTrigger value="memory">{t("agent.tabMemory")}</TabsTrigger>}
        </TabsList>
        <TabsContent value="mcp">
          <AgentMcp store={store} hostId={hostId} projectId={projectId} />
        </TabsContent>
        {withMemory && (
          <TabsContent value="memory">
            <AgentMemory store={store} hostId={hostId} projectId={projectId} />
          </TabsContent>
        )}
        {(["claudemd", "agent", "skill"] as const).map((kind) => (
          <TabsContent key={kind} value={kind}>
            <AgentFiles store={store} hostId={hostId} projectId={projectId} kind={kind} />
          </TabsContent>
        ))}
      </Tabs>
    </Page>
  );
}

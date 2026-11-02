import type { Project } from "@flightdeck/protocol";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";

/** The one flow that registers a folder of a host as a project (Board, Workflows, Teams, Projects). */
export function AddProject(props: {
  store: AppStore;
  hostId: string;
  onAdded(project: Project): void;
}) {
  const t = useT();
  return <Button>{t("states.addProject")}</Button>;
}

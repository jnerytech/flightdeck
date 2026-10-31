import type { PluginInventory } from "@flightdeck/protocol";
import { useT } from "@/i18n/context";

/** What a plugin installs, as read from its folder: shown before any install or update. */
export function InventoryView(props: { inventory: PluginInventory }) {
  const t = useT();
  const { inventory } = props;
  const names = (label: string, list: string[]) =>
    list.length > 0 && (
      <p className="text-sm">
        {label}: {list.join(", ")}
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      {inventory.manifest?.description && (
        <p className="text-sm">{inventory.manifest.description}</p>
      )}
      {inventory.hooks.length > 0 && (
        <ul aria-label={t("pluginsUi.hooks")} className="flex flex-col gap-1 text-sm">
          {inventory.hooks.map((hook) => (
            <li key={`${hook.event}/${hook.matcher ?? ""}/${hook.command ?? hook.type}`}>
              <code>
                {hook.event}
                {hook.matcher ? ` (${hook.matcher})` : ""}: {hook.command ?? hook.type}
              </code>
              {hook.sensitive && (
                <span className="ml-2 text-status-needs-you text-xs">
                  {t("pluginsUi.sensitiveHook")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {inventory.monitors.length > 0 && (
        <ul aria-label={t("pluginsUi.monitors")} className="flex flex-col gap-1 text-sm">
          {inventory.monitors.map((monitor) => (
            <li key={monitor.name}>
              <code>
                {monitor.name}: {monitor.command}
              </code>
            </li>
          ))}
        </ul>
      )}
      {names(t("pluginsUi.skills"), inventory.skills)}
      {names(t("pluginsUi.agents"), inventory.agents)}
      {names(t("pluginsUi.commands"), inventory.commands)}
      {inventory.mcpServers.length > 0 && (
        <p className="text-sm">
          {t("pluginsUi.mcp")}:{" "}
          {inventory.mcpServers.map((s) => `${s.name} (${s.transport}: ${s.target})`).join(", ")}
        </p>
      )}
      {inventory.problems.map((problem) => (
        <p key={problem} className="text-status-needs-you text-sm">
          {problem}
        </p>
      ))}
      <p className="text-muted-foreground text-xs">
        {t("pluginsUi.hash", { hash: inventory.hash.slice(0, 12) })}
      </p>
    </div>
  );
}

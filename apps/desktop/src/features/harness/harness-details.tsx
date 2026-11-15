import type { HarnessPreview } from "@flightdeck/protocol";
import type { AppStore } from "@/lib/app-store";
import { ActionButton } from "@/shared/feedback/index.ts";
import { Stack } from "@/shared/layout/index.ts";

type T = AppStore["i18n"]["t"];

/** One titled list in the dialog; nothing when the list is empty. */
export function Group(props: Readonly<{ title: string; items: string[]; note?: string | null }>) {
  if (props.items.length === 0) return null;
  return (
    <Stack gap={1} className="text-sm">
      <p className="font-medium">{props.title}</p>
      <Stack as="ul" gap={1} className="font-mono text-xs [overflow-wrap:anywhere]">
        {/* The same line twice says nothing more, and two rows would share a key. */}
        {[...new Set(props.items)].map((item) => (
          <li key={item}>{item}</li>
        ))}
      </Stack>
      {props.note && <p className="text-muted-foreground text-xs">{props.note}</p>}
    </Stack>
  );
}

/** The CLAUDE.md's draft step (#75, G1): offered, under way, its note, or its refusal. */
interface DraftStep {
  offered: boolean;
  busy: boolean;
  /** The template was replaced by the host's draft. */
  drafted: boolean;
  refusal: string | null;
  run(): void;
}

/** What the setup would add, with what each part does not promise. */
export function Details(
  props: Readonly<{ preview: HarnessPreview; trusted: boolean; t: T; draft: DraftStep }>,
) {
  const { preview, trusted, t, draft } = props;
  const hooks = preview.settings?.hooks ?? [];
  const deny = preview.settings?.denyRules ?? [];
  return (
    <Stack gap={3}>
      <Group
        title={t("projectPage.harness.setup.hooks")}
        items={hooks.map((hook) => t("projectPage.harness.setup.hookLine", { ...hook }))}
        note={t("projectPage.harness.setup.formatterNote")}
      />
      <Group
        title={t("projectPage.harness.setup.deny")}
        items={deny}
        note={t("projectPage.harness.setup.denyNote")}
      />
      {preview.files.length > 0 && (
        <Stack gap={1} className="text-sm">
          <p className="font-medium">{t("projectPage.harness.setup.files")}</p>
          {preview.files.map((file) => {
            const step = file.path === "CLAUDE.md" && draft.offered;
            return (
              <Stack key={file.path} gap={1}>
                {/* A drafted file opens, so what will be written is in front of the person. */}
                <details open={step && draft.drafted}>
                  <summary className="hit-24 cursor-pointer font-mono text-xs leading-6">
                    {file.path}
                  </summary>
                  <pre
                    className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-xs"
                    // biome-ignore lint/a11y/noNoninteractiveTabindex: a long file scrolls, and focus lets the keyboard do it
                    tabIndex={0} // NOSONAR: a region that scrolls must take focus, or the keyboard cannot scroll it (axe scrollable-region-focusable)
                  >
                    {file.content}
                  </pre>
                </details>
                {step &&
                  (draft.drafted ? (
                    <p className="text-sm text-status-needs-you">
                      {t("projectPage.harness.setup.drafted")}
                    </p>
                  ) : (
                    <div>
                      <ActionButton variant="outline" pending={draft.busy} onClick={draft.run}>
                        {t("projectPage.harness.setup.draft")}
                      </ActionButton>
                    </div>
                  ))}
                {step && draft.refusal && <p className="text-sm">{draft.refusal}</p>}
              </Stack>
            );
          })}
        </Stack>
      )}
      <Group
        title={t("projectPage.harness.setup.conflicts")}
        items={preview.settings?.conflicts ?? []}
      />
      <Group title={t("projectPage.harness.setup.unreadable")} items={preview.unreadable} />
      <Group
        title={t("projectPage.harness.setup.withheld")}
        items={(preview.withheld ?? []).map((file) =>
          t("projectPage.harness.setup.withheldLine", {
            path: file.path,
            why: t(`projectPage.harness.setup.withheldWhy.${file.reason}`),
          }),
        )}
      />
      {!trusted && hooks.length + deny.length > 0 && (
        <p className="text-sm text-status-needs-you">{t("projectPage.harness.setup.untrusted")}</p>
      )}
    </Stack>
  );
}

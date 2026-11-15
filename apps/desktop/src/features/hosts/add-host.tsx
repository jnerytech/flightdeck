import { useState } from "react";
import type { AppStore } from "@/lib/app-store.ts";
import type { Route } from "@/lib/router.ts";
import { Page } from "@/shared/layout/index.ts";
import { draftUrl } from "./domain/host-draft.ts";
import { FirstRun } from "./first-run.tsx";
import { type HostDraft, HostForm } from "./host-form.tsx";

/** Adding a host: by hand, or prefilled by a pairing link (saving still needs the click). */
export function AddHost(
  props: Readonly<{
    store: AppStore;
    draft?: HostDraft;
    empty: boolean;
    go(r: Route): void;
  }>,
) {
  const [error, setError] = useState<string | null>(null);
  const submit = async (draft: HostDraft) => {
    setError(null);
    const result = await props.store.roster.testAndAdd({
      name: draft.name,
      url: draftUrl(draft),
      token: draft.token,
    });
    // A new host opens its own page: that is where it is checked and its folders are chosen.
    if (result.ok) props.go({ name: "host", host: result.hostId });
    else setError(result.error);
  };
  const { t } = props.store.i18n;
  // A page: a title, and a body that scrolls from its top. A centered box that scrolled hid the
  // top of a screen taller than the window, out of reach (#728).
  return (
    <Page
      title={t(props.empty ? "welcome.title" : "welcome.titleMore")}
      {...(props.empty ? { subtitle: t("welcome.addHost") } : {})}
    >
      <div className="flex w-full max-w-xl flex-col gap-6">
        <FirstRun onCopy={(text) => void props.store.system.copyText(text)} />
        <HostForm
          {...(props.draft
            ? {
                initial: props.draft,
                notice: props.store.i18n.t("hostForm.fromLink"),
              }
            : {})}
          error={error}
          onSubmit={(draft) => submit(draft)}
        />
      </div>
    </Page>
  );
}

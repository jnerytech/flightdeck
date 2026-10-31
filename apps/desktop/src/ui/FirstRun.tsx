import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";

/** A command to type on the host, with its own copy button. */
function Command(props: { command: string; onCopy(text: string): void }) {
  const t = useT();
  return (
    <span className="mt-1 flex items-center gap-2">
      <code className="rounded-md bg-muted px-2 py-1 font-mono text-sm">{props.command}</code>
      <Button type="button" variant="outline" size="xs" onClick={() => props.onCopy(props.command)}>
        {t("welcome.copy", { command: props.command })}
      </Button>
    </span>
  );
}

/** What to do on the host before the app has one: install the daemon, copy the link, paste it. */
export function FirstRun(props: { onCopy(text: string): void }) {
  const t = useT();
  return (
    <div className="flex w-full max-w-md flex-col gap-3 text-sm">
      <ol aria-label={t("welcome.stepsLabel")} className="flex list-decimal flex-col gap-3 pl-5">
        <li>
          {t("welcome.step1")}
          <Command command="flightdeckd setup" onCopy={props.onCopy} />
        </li>
        <li>{t("welcome.step2")}</li>
        <li>{t("welcome.step3")}</li>
      </ol>
      <p className="text-muted-foreground">
        {t("welcome.trouble")}
        <Command command="flightdeckd doctor" onCopy={props.onCopy} />
      </p>
    </div>
  );
}

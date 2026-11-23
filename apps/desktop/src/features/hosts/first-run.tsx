import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { Inline, Stack } from "@/shared/layout/index.ts";

/** A command as it is typed, in a chip. */
function CommandText(props: Readonly<{ command: string }>) {
  return <code className="rounded-md bg-muted px-2 py-1 font-mono text-sm">{props.command}</code>;
}

/** A command to type on the host, with its own copy button. */
function Command(props: Readonly<{ command: string; onCopy(text: string): void }>) {
  const t = useT();
  return (
    <span className="mt-1 flex items-center gap-2">
      <CommandText command={props.command} />
      <Button type="button" variant="outline" size="xs" onClick={() => props.onCopy(props.command)}>
        {t("welcome.copy", { command: props.command })}
      </Button>
    </span>
  );
}

/** A command to type on the host, shown as plain code: it names a file that is not on the PATH, so no copy button. */
function FileCommand(props: Readonly<{ system: string; command: string }>) {
  return (
    <Inline>
      <span className="text-muted-foreground">{props.system}</span>
      <CommandText command={props.command} />
    </Inline>
  );
}

/** What to do on the host before the app has one: install the daemon, copy the link, paste it. */
export function FirstRun(props: Readonly<{ onCopy(text: string): void }>) {
  const t = useT();
  return (
    <div className="flex w-full max-w-md flex-col gap-3 text-sm">
      <ol aria-label={t("welcome.stepsLabel")} className="flex list-decimal flex-col gap-3 pl-5">
        <li>
          {t("welcome.step1")}
          <Stack gap={1}>
            <FileCommand system={t("welcome.step1Linux")} command="./flightdeckd-linux-x64 setup" />
            <FileCommand
              system={t("welcome.step1Windows")}
              command={".\\flightdeckd-windows-x64.exe setup"}
            />
            <p className="text-muted-foreground">{t("welcome.step1After")}</p>
          </Stack>
        </li>
        <li>{t("welcome.step2")}</li>
        <li>{t("welcome.step3")}</li>
        <li>{t("welcome.step4")}</li>
      </ol>
      <p className="text-muted-foreground">
        {t("welcome.lost")}
        <Command command="flightdeckd pair" onCopy={props.onCopy} />
      </p>
      <p className="text-muted-foreground">
        {t("welcome.trouble")}
        <Command command="flightdeckd doctor" onCopy={props.onCopy} />
      </p>
    </div>
  );
}

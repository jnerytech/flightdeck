/** What the daemon says when it refuses a cron expression, a time zone or an automation. */
export const automationRefusal = {
  cron_fields: "A cron expression has 5 fields: minute, hour, day of month, month, day of week.",
  cron_step: "The step in cron field {field} is not valid: {part}.",
  cron_value: "The value in cron field {field} is not valid: {part}.",
  cron_range: "Cron field {field} takes values from {min} to {max}: {part}.",
  automation_tz_unknown: "The time zone {tz} is not known. Use a name like America/Sao_Paulo.",
  automation_send_needs_card:
    "Sending to a card needs a trigger that has a card: a PR comment or a CI failure.",
  automation_create_needs_label: "Creating a card needs the issue label trigger.",
  automation_workflow_missing: "An automation that starts a workflow needs the workflow's name.",
  automation_label_missing: "The issue label trigger needs the label to watch for.",
  automation_name_required: "The automation needs a name.",
  automation_max_runs: "The daily limit is a whole number from 1 up.",
  automation_not_found: "The automation {id} does not exist.",
  automation_remove_confirm: "Removing an automation needs your confirmation.",
  automation_enable_confirm: "Turning an automation on needs your confirmation.",
};

/** O que o daemon diz ao recusar uma expressão cron, um fuso horário ou uma automação. */
export const automationRefusal = {
  cron_fields: "Uma expressão cron tem 5 campos: minuto, hora, dia do mês, mês e dia da semana.",
  cron_step: "O passo do campo {field} do cron não é válido: {part}.",
  cron_value: "O valor do campo {field} do cron não é válido: {part}.",
  cron_range: "O campo {field} do cron aceita valores de {min} a {max}: {part}.",
  automation_tz_unknown: "O fuso horário {tz} não é conhecido. Use um nome como America/Sao_Paulo.",
  automation_send_needs_card:
    "Mandar para um card pede um gatilho que tenha card: comentário de PR ou falha de CI.",
  automation_create_needs_label: "Criar um card pede o gatilho de rótulo de issue.",
  automation_workflow_missing: "Uma automação que inicia um workflow precisa do nome do workflow.",
  automation_label_missing: "O gatilho de rótulo de issue precisa do rótulo a observar.",
  automation_name_required: "A automação precisa de um nome.",
  automation_max_runs: "O limite por dia é um número inteiro de 1 em diante.",
  automation_not_found: "A automação {id} não existe.",
  automation_remove_confirm: "Remover uma automação pede a sua confirmação.",
  automation_enable_confirm: "Ligar uma automação pede a sua confirmação.",
};

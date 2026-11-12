/** What a refusal of the daemon, of the assistant and of the snippets says, one entry per code. */
export const refusals = {
  daemonRefusal: {
    account_refresh_too_soon: "A conta foi lida há pouco: tente de novo em {waitSeconds} s.",
    account_unavailable:
      "A conta do Claude deste host não pôde ser lida. Confira se o `claude` está instalado lá e tente de novo.",

    autoapprove_resume_confirm: "Reativar a aprovação automática pede a sua confirmação.",
    terminal_enable_confirm:
      "Ligar o terminal dá um shell completo neste host: confirme para seguir.",
    central_confirm: "Mexer no ~/.claude/settings.json do host pede a sua confirmação.",
    service_confirm: "Instalar o serviço no host pede a sua confirmação.",
    service_unsupported:
      "Este host não tem um gerenciador de serviços que inicie o flightdeckd com o computador ({platform}).",
    permission_request_closed: "O pedido de permissão {id} não está aberto.",
    hold_required: "Um pedido de risco alto só é aprovado segurando o botão.",
    input_changed: "Um pedido é aprovado como foi feito: a resposta muda o que ele executa.",
    update_needs_service:
      "O daemon não roda como serviço: atualize no host com flightdeckd update --from <binário novo>.",
    update_signature_failed: "Não foi possível verificar a atualização: {why}",
    messaging_session_missing: "A sessão {id} não existe.",
    messaging_plain_session:
      "Um claude puro, sem canal, só recebe pela troca nativa do Claude Code.",
    messaging_channel_down: "O canal do terminal não está conectado.",
    messaging_idle_other_host:
      "A sessão {address} é de outro host: o aviso de ocioso só vale para sessões deste host.",
    messaging_asker_unknown: "A sessão que pede não existe neste host: não sei quem está mandando.",
    messaging_target_not_found: "A sessão {address} não foi encontrada.",
    messaging_host_unknown: "O host {host} não é conhecido: o app descreve os hosts.",
    messaging_peer_not_found: "A sessão {address} não foi encontrada no host {host}.",
    messaging_self: "Uma sessão não manda mensagem para si mesma.",
    messaging_no_route:
      "As sessões não são do mesmo projeto nem do mesmo time, e nenhuma exceção em Configurações libera este par.",
    messaging_read_other_host: "A sessão é de outro host: o read_session só lê sessões deste host.",
    messaging_policy_invalid: "As regras de mensagens não valem: {errors}",
    project_no_issues:
      "Este projeto não tem integração de issues: configure nas definições do projeto.",
    card_contract_unmet: "Este card não está pronto para {column}: falta {needs}.",
    findings_missing:
      "A resposta da etapa {step} não traz uma lista de achados, então nenhum card foi criado.",
    findings_invalid:
      "A resposta da etapa {step} não é uma lista de achados válida ({where}), então nenhum card foi criado.",
    spec_path_invalid:
      "O caminho da especificação deve ser relativo, para um arquivo Markdown dentro do worktree, como specs/nome.md.",
    card_template_unknown:
      "Este projeto não oferece um modelo de card com esse nome: escolha outro ou crie um card em branco.",
    pinned_doc_invalid:
      "Um documento fixado deve ser um arquivo Markdown da pasta docs do projeto (decisions, adr, rfc, prd ou specs), e um card fixa no máximo 10.",
    card_moved_anyway: "Movido para {column} mesmo assim; faltava {needs}.",
    spec_template_failed:
      "Não deu para gravar o modelo de spec em {path} (um link ou arquivo está no caminho): a sessão começou sem ele.",
    spec_template_untrusted:
      "Este projeto tem um modelo de spec próprio, mas o projeto não é confiável, então foi usado o embutido. Confie no projeto para usar o dele.",
    spec_template_unsafe:
      "O modelo de spec do projeto não foi usado (é um link, tem um segundo nome ou não é um arquivo comum): foi usado o embutido.",
    spec_template_too_big:
      "O modelo de spec do projeto não foi usado (passa de 32 KiB): foi usado o embutido.",
    spec_template_empty:
      "O modelo de spec do projeto não foi usado (está vazio): foi usado o embutido.",
    contract_invalid: "O contrato de {column} não é válido.",
    project_no_origin: "Este projeto não tem o remoto origin.",
    remote_not_github: "O remoto {url} não é do GitHub.",
    remote_not_azure: "O remoto {url} não é do Azure DevOps.",
    issue_id_invalid: "{id} não é um id de issue válido: só dígitos.",
    issue_not_this_project: "{issue} não é uma issue do {provider} deste projeto.",
    issue_other_repo: "{issue} é de outro repositório que o do projeto.",
    issue_has_card: "A issue {ref} já tem o card {card}.",
    plugin_arg_refused: "O valor {value} foi recusado: seria lido como uma opção.",
    plugin_not_installed: "{id} não está instalado.",
    marketplace_missing: "O marketplace {marketplace} não existe.",
    plugin_not_in_marketplace: "{id} não está no marketplace.",
    marketplace_update_failed: "Não deu para atualizar o marketplace {marketplace}: {why}",
    plugin_preview_unavailable_update:
      "O conteúdo de {id} não pode ser mostrado antes de atualizar.",
    plugin_validate_refused: "O validador de plugins recusou: {errors}",
    plugin_preview_unavailable_install:
      "O conteúdo de {name} não pode ser mostrado antes de instalar.",
    plugin_pinned: "{id} está fixado na versão {version}: solte antes de atualizar.",
    plugin_remove_confirm: "Remover um plugin pede a sua confirmação.",
    marketplace_add_confirm: "Adicionar um marketplace pede a sua confirmação.",
    marketplace_remove_confirm: "Remover um marketplace pede a sua confirmação.",
    plugin_content_changed: "O conteúdo mudou desde que foi mostrado: veja a prévia de novo.",
    marketplace_catalog_unreadable: "O catálogo do marketplace {marketplace} não pôde ser lido.",
    plugin_command_mismatch: "Só se aceita o comando que foi mostrado: peça de novo para ver.",
    plugins_stopped: "O gerenciador de plugins foi parado.",
    plugin_cli_failed: "claude plugin {command} falhou: {why}",
    plugin_cli_not_json: "claude plugin {command} não devolveu JSON.",
    claude_not_found: "O claude não foi encontrado no PATH deste host.",
    plugin_dir_missing: "A pasta {dir} não existe.",
    plugin_too_many_files: "O plugin tem arquivos demais (mais de {max}).",
    team_quota_until:
      "A cota do plano está acima do limite até {until}: crie o time depois, senão ele nasce parado.",
    team_quota_over:
      "A cota do plano está acima do limite: crie o time depois, senão ele nasce parado.",
    name_blank: "O nome não pode ficar em branco.",
    session_unnamed: "A sessão {id} não tem nome.",
    terminal_disabled: "O terminal está desligado neste host: ligue nas configurações dele.",
    terminal_stopping: "O daemon deste host está parando: nenhum terminal abre agora.",
    terminal_missing: "O terminal {id} não existe.",
    terminal_ended: "O terminal {id} já terminou.",
    terminal_limit: "Este host permite {max} terminais: feche um para abrir outro.",
    claude_here_unavailable: '"Claude aqui" não está disponível neste host.',
    terminal_open_failed: "Não foi possível abrir o terminal: {why}",
    update_no_binary: "Não há binário do daemon para {platform}-{arch}.",
    update_confirm: "Atualizar o daemon pede a sua confirmação.",
    update_manifest_unchecked:
      "O daemon ainda não verificou se há atualização: tente de novo daqui a pouco.",
    update_manifest_no_binary: "A versão {version} não tem binário para {key}.",
    releases_unavailable:
      "Não foi possível ler as notas de versão no GitHub: tente de novo mais tarde.",
    perm_rule_other_tool: "Essa regra é de outra ferramenta ({tool}).",
    perm_rule_too_broad:
      "Essa regra também permitiria usos de {tool} de risco {level}, mais do que este pedido: estreite-a.",
    perm_rule_content_invalid: "O conteúdo da regra não vale: uma linha, até 500 caracteres.",
    perm_destination_denied: "O destino {destination} não é permitido para uma regra.",
    perm_mode_denied: "O modo {mode} não pode ser definido por uma resposta.",
    perm_tool_always_asks: "Esta ferramenta sempre pergunta: nenhuma regra a libera.",
    perm_not_suggested: "Isso não é uma das sugestões do pedido nem uma regra do projeto.",
    team_session_foreign: "Esta sessão não faz parte do time {team}.",
    team_report_not_coordinator: "Só a coordenadora do time {team} relata o resultado dele.",
    team_close_confirm: "Encerrar o time {name} pede a sua confirmação.",
    team_coordinator_stays: "A coordenadora não sai do time: encerre o time.",
    team_delete_open: "O time {name} ainda está aberto: encerre-o primeiro.",
    team_delete_live:
      "O time {name} ainda tem {members} membro(s) trabalhando: espere até que descansem e exclua depois.",
    team_closed: "O time {name} está encerrado.",
    agentcfg_file_missing: "{path} não existe neste projeto.",
    agentcfg_path_invalid: "{path} não é um caminho válido para este tipo de arquivo ({kind}).",
    agentcfg_confirm: "Gravar o arquivo pede a sua confirmação.",
    agentcfg_user_readonly: "A configuração do usuário (~/.claude) é só leitura aqui.",
    agentcfg_outside_project: "{path} ficaria fora do projeto: nada foi gravado.",
    agentcfg_exists: "{path} já existe: abra-o para alterar.",
    agentcfg_changed: "{path} mudou desde que você o abriu: abra de novo antes de salvar.",
    agentcfg_frontmatter_missing: "O arquivo precisa de um frontmatter YAML entre linhas ---.",
    agentcfg_field_required: "O frontmatter precisa do campo {field}.",
    agentcfg_tools_type: "No frontmatter, tools é um texto ou uma lista de textos.",
    agentcfg_model_type: "No frontmatter, model é um texto.",
    mcp_write_confirm: "Gravar no .mcp.json pede a sua confirmação.",
    mcp_remove_confirm: "Remover do .mcp.json pede a sua confirmação.",
    mcp_toggle_confirm: "Ligar ou desligar um servidor pede a sua confirmação.",
    mcp_masked_values:
      "Os valores de env e headers aparecem mascarados: digite o valor de novo para salvar.",
    mcp_server_missing: "O servidor MCP {name} não existe.",
    mcp_server_external: "O servidor {name} vem do ~/.claude.json, que o Flightdeck só lê.",
    mcp_timeout: "O servidor {name} não respondeu em {seconds} s.",
    rewind_nothing: "Não há volta para desfazer nesta sessão.",
    rewind_confirm: "Voltar os arquivos pede a sua confirmação.",
    rewind_turn_running: "A sessão está num turno: pare-a antes de voltar.",
    snapshot_missing: "O turno {n} não tem snapshot nesta sessão.",
    rewind_no_safety_snapshot:
      "Não deu para guardar o snapshot de segurança ({why}); nada foi voltado.",
    fork_unsupported: "Este runtime não bifurca sessões.",
    ssh_hostkey_exists:
      "Já há uma chave de servidor guardada para este destino: esqueça-a antes de trocar.",
    ssh_hostkey_mismatch: "Confirme o fingerprint que acabou de ser mostrado: verifique de novo.",
    ssh_target_unknown: "Não há um destino ssh chamado {name}.",
    ssh_target_ambiguous: "Mais de um destino ssh se chama {name}: renomeie um.",
    ssh_password_in_action:
      "{name} usa senha: uma ação ssh roda sem ninguém para digitá-la. Use um agent ou uma chave.",
    ssh_exec_off: "Este host não roda ações ssh.",
    card_blocked: "Este card está bloqueado por: {blockers}.",
    blocker_cycle: "Isso fecharia um ciclo: {cycle}.",
    blocker_limit: "Um card tem no máximo {max} bloqueios.",
    blocker_other_project: "O bloqueio precisa ser um card do mesmo projeto.",
    ssh_key_missing: "A chave do cofre não veio com o pedido: destrave o cofre e tente de novo.",
    ssh_key_not_for_auth: "Uma chave do cofre só vale para um destino que use uma.",
    ssh_askpass_off: "Senha pede o askpass, que não está disponível neste host.",
    ssh_jump_auth:
      "O jump {name} usa {auth}: um jump só pode usar o agent ou uma chave em arquivo.",
    ssh_key_unreachable:
      "Não deu para ler a chave do servidor de {name} daqui: a primeira conexão precisa alcançá-lo direto.",
    ssh_hostkey_unconfirmed:
      "{name}: confira o fingerprint {fingerprint} e confirme para conectar.",
    ssh_hostkey_changed:
      "{name}: a chave do servidor mudou (guardada {pinned}, agora {fingerprint}). Fale com quem cuida dele; se a mudança é esperada, esqueça a chave guardada e confirme a nova.",
    ssh_askpass_ticket_invalid: "O pedido de senha não vale mais. Conecte de novo.",
    ssh_askpass_no_app:
      "Nenhuma janela do Flightdeck está aberta para pedir a senha. Abra o app e conecte de novo.",
    ssh_askpass_timeout: "Ninguém respondeu ao pedido de senha a tempo. Conecte de novo.",
    ssh_askpass_request_unknown:
      "Esse pedido de senha não existe mais: já foi respondido ou expirou.",
    ssh_askpass_cancelled: "O pedido de senha foi cancelado.",
    ssh_askpass_cmd_path:
      "O caminho do daemon tem % ou aspas, que um .cmd do Windows não comporta. Mova o daemon para uma pasta sem eles.",
    ssh_key_perms:
      "Não foi possível restringir as permissões do arquivo da chave ao seu usuário, então a chave não foi usada.",
    ssh_agent_down: "O ssh-agent desta conexão não subiu. Confira se o ssh-agent está instalado.",
    ssh_add_refused:
      "O ssh-add recusou a chave. Confira se a chave é válida e não tem frase-senha.",
    ssh_import_cycle: "As entradas de ProxyJump levam umas às outras em círculo.",
    ssh_import_not_in_config: "Esse nome não está no seu ~/.ssh/config.",
    ssh_import_exists: "Já cadastrado.",
    ssh_import_multi_jump:
      "O ProxyJump {jump} lista vários jumps, o que não é suportado. Importe cada salto separado.",
    ssh_import_jump_unknown: "O ProxyJump {jump} não é um destino cadastrado. Importe-o antes.",
    ssh_import_jump_failed: "O jump {jump} não pôde ser criado, então este foi pulado.",
    ssh_test_auth: "O servidor recusou a autenticação. Confira o usuário e a chave.",
    ssh_test_refused: "O servidor recusou a conexão. Confira o host e a porta.",
    ssh_test_host_unknown: "O nome do host não foi encontrado. Confira a grafia e a sua rede.",
    ssh_test_timeout: "A conexão demorou demais. Confira o host, a porta e a sua rede.",
    ssh_test_hostkey:
      "A chave do servidor é diferente da guardada. Fale com quem cuida do servidor, depois esqueça a chave guardada e confirme a nova.",
    ssh_test_exit: "O ssh terminou com código {code} sem dizer nada.",
    ssh_test_no_password: "O teste não cobre senha. Conecte para testar.",
    action_param_unknown: "Parâmetro desconhecido: {param}.",
    action_param_missing: "A ação precisa do parâmetro {param}.",
    action_param_pattern: "O valor de {param} não casa com o padrão {pattern}.",
    action_secret_missing:
      "O segredo {secret} não veio com o pedido. Destrave o cofre e tente de novo.",
    action_ssh_unavailable: "A ação {action} roda por ssh, e este host não tem destinos ssh.",
    action_spawn_failed: "Não foi possível iniciar {command}. Confira se está instalado e no PATH.",
    action_request_gone: "Esse pedido não existe mais: venceu, foi recusado ou já terminou.",
    action_no_approval_needed: "Esse pedido não precisa de aprovação.",
    action_tray_refused: "A bandeja não aprova pedidos de prod ou de risco alto. Aprove no app.",
    action_hold_needed: "Segure o botão Aprovar por 2 segundos.",
    action_session_refused_risky:
      "Um pedido de prod ou de risco alto é aprovado um uso por vez, nunca para a sessão.",
    action_session_refused_rule:
      "A regra não permite aprovar para a sessão: este pedido pergunta a cada uso.",
    action_needs_approval: "O pedido precisa da sua aprovação antes de entregar o segredo.",
    usage_rules_unavailable: "As regras de uso não estão disponíveis neste host.",
    action_not_found: "A ação {action} não existe.",
    action_changed_review: "A ação {action} mudou. Revise de novo antes de confiar.",
    action_ssh_host_unsupported:
      "O host {host} é um destino ssh, e este daemon não roda comandos em destinos.",
    action_secret_name_invalid: "O nome de segredo {secret} não é válido.",
    action_not_trusted: "A ação {action} não está confiada. Revise e confie nela antes.",
    action_changed_since_trust:
      "A ação {action} mudou desde que foi confiada ({changes}). Revise e confie de novo.",
    action_requester_refused:
      "Só o Claude, uma automação ou um workflow podem pedir segredos ao app por este caminho.",
    action_use_denied: "Uso negado: {detail}",
    action_app_offline:
      "O app não está conectado. Ele precisa estar aberto para liberar o segredo.",
    action_secret_refused: "O app recusou o segredo {secret}.",
    action_secret_expired: "O pedido do segredo {secret} venceu sem resposta e foi negado.",
    action_ssh_env_name: "{name} não é um nome de variável válido para uma ação ssh.",
    cron_fields: "Uma expressão cron tem 5 campos: minuto, hora, dia do mês, mês e dia da semana.",
    cron_step: "O passo do campo {field} do cron não é válido: {part}.",
    cron_value: "O valor do campo {field} do cron não é válido: {part}.",
    cron_range: "O campo {field} do cron aceita valores de {min} a {max}: {part}.",
    automation_tz_unknown:
      "O fuso horário {tz} não é conhecido. Use um nome como America/Sao_Paulo.",
    automation_send_needs_card:
      "Mandar para um card pede um gatilho que tenha card: comentário de PR ou falha de CI.",
    automation_create_needs_label: "Criar um card pede o gatilho de rótulo de issue.",
    automation_name_required: "A automação precisa de um nome.",
    automation_max_runs: "O limite por dia é um número inteiro de 1 em diante.",
    automation_not_found: "A automação {id} não existe.",
    automation_remove_confirm: "Remover uma automação pede a sua confirmação.",
    automation_enable_confirm: "Ligar uma automação pede a sua confirmação.",
    workflow_changed_review:
      "O workflow {name} mudou. Revise os comandos de novo antes de confiar.",
    workflow_invalid: "O workflow {name} tem erros. Corrija antes de usar.",
    workflow_not_trusted:
      "O workflow {name} não é confiado. Confie nele na tela de Workflows antes.",
    run_resume_not_failed: "Só uma execução que falhou pode continuar de onde parou.",
    run_resume_card:
      "O card desta execução sumiu, está sem worktree ou tem outra execução em andamento, então ela não pode continuar.",
    run_resume_no_head:
      "Esta execução terminou antes de o Flightdeck guardar onde o código estava, então ela só roda de novo do começo.",
    run_resume_workflow_changed:
      "O workflow {name} mudou desde esta execução, então ela só roda de novo do começo.",
    run_card_gone: "O card desta execução sumiu, então ela parou quando o Flightdeck reiniciou.",
    run_resume_branch_moved:
      "O branch do card mudou desde que esta execução parou, então ela só roda de novo do começo.",
    check_loop_no_checks:
      "O projeto não tem checks para rodar: adicione-os antes nas configurações de Vigiar do projeto.",
    check_loop_untrusted:
      "O projeto não é confiável: confie nele antes que os checks rodem sozinhos.",
    check_loop_mode:
      "No modo de planejamento a sessão não corrige nada, então os checks não rodam.",
    check_loop_confirm:
      "Confirme antes: os checks vão rodar o código que este card escreve, sem perguntar a cada vez.",
    workflow_input_required: "O workflow precisa do input {input}.",
    workflow_input_unknown: "O workflow não tem o input {input}.",
    workflow_gate_closed: "O gate {step} (tentativa {attempt}) não está aberto.",
    workflow_run_not_found: "A execução {id} não existe.",
    workflow_not_on_branch: "O workflow {name} não está na branch {branch}.",
    action_invalid: "A ação tem problemas. Corrija e salve de novo.",
    action_ssh_env_value:
      "A variável {name} tem quebra de linha ou NUL, que uma ação ssh não envia.",
    review_path_outside: "O caminho {path} está fora do repositório.",
    review_target_invalid: "{target} não é uma sessão nem um card para revisar.",
    branch_invalid: "{name} não é um nome de branch válido.",
    watch_off: "O PR deste card não está sendo vigiado: ligue o Vigiar antes.",
    watch_extend_blocked: "Mais rodadas não resolveriam: {reason}",
    watch_round_not_held: "Essa rodada não está retida: não há nada para enviar ou descartar.",
    watch_pr_not_open: "O PR do card está {state}: nada é enviado a ele.",
    watch_held_moved:
      "O branch tem commits novos desde que a rodada foi retida: veja-os antes de enviar ou descartar.",
    review_file_missing: "O arquivo {path} não existe.",
    review_file_big: "O arquivo {path} passa de 1 MB: edite fora do Flightdeck.",
    review_file_binary: "O arquivo {path} não é texto.",
    review_text_big: "O texto passa de 1 MB: encurte-o ou edite o arquivo fora do Flightdeck.",
    review_file_changed:
      "O arquivo {path} mudou desde que foi aberto: recarregue e aplique a edição de novo.",
    knowledge_frontmatter:
      "O front matter de {path} não pode ser mudado com segurança por aqui: edite o arquivo à mão.",
    knowledge_title_invalid: "Dê ao documento um título com letras ou dígitos.",
    knowledge_folder_unsafe:
      "A pasta deste documento é um link ou fica fora do projeto: nada foi gravado.",
    knowledge_exists: "Já existe um documento chamado {path}: nada foi sobrescrito.",
    review_revert_confirm: "Confirme o revert para continuar.",
    review_undo_confirm: "Confirme o desfazer para continuar.",
    review_undo_nothing:
      "Não há nada para desfazer em {path}: o revert só pode ser desfeito por 30 segundos.",
    review_path_link: "O caminho {path} aponta para fora do repositório.",
    review_file_secret:
      "O arquivo {path} pode guardar uma credencial: o Flightdeck não o mostra nem o altera.",
    review_comment_empty: "O comentário está vazio: escreva algo.",
    review_side_missing: "O arquivo {path} não existe desse lado do diff.",
    review_lines_outside: "As linhas {start}–{end} estão fora de {path}.",
    review_comment_sent: "Esse comentário já foi enviado: não dá mais para editar.",
    review_no_drafts: "Não há comentário em rascunho para enviar.",
    review_comment_not_found: "O comentário {id} não existe.",
    memory_write_confirm: "Confirme a gravação para continuar.",
    memory_exists: "A memória {name} já existe: abra-a para editar.",
    memory_changed: "A memória {name} mudou desde que foi aberta: recarregue antes.",
    memory_delete_confirm: "Confirme a exclusão para continuar.",
    memory_not_found: "A memória {name} não existe.",
    memory_name_invalid:
      "{name} não é um nome válido de memória: use um nome de arquivo simples terminado em .md.",
    memory_is_link: "{name} é um link: o Flightdeck não o segue.",
    memory_dir_outside:
      "A pasta de memória fica fora da pasta do Claude: o Flightdeck não mexe nela.",
    run_config_missing: "O ramo-base não tem run.yaml: adicione um para rodar este projeto.",
    run_config_changed: "O run.yaml mudou: revise os comandos de novo antes de confiar.",
    run_config_invalid: "O run.yaml tem erros de validação: {errors}",
    run_config_untrusted: "O run.yaml ainda não é confiável: confie nele no card.",
    run_exclusive: "Outro card está rodando neste projeto, que roda um card por vez: pare-o antes.",
    plugin_too_big: "O plugin passa de 50 MB: o Flightdeck não o lê.",
    run_ports_exhausted: "Não há bloco de {size} portas livres: pare um card em execução.",
    ssh_target_not_found: "Esse destino ssh não foi encontrado.",
    ssh_name_invalid: "O nome tem de 1 a 100 caracteres.",
    ssh_host_invalid: "O host não é um nome ou endereço válido.",
    ssh_user_invalid: "O usuário não é válido.",
    ssh_port_invalid: "A porta tem de ser um número de 1 a 65535.",
    ssh_forward_agent_confirm:
      "ForwardAgent entrega o seu agent ao host remoto: confirme para continuar.",
    ssh_remove_confirm: "Remover um destino pede confirmação.",
    ssh_jump_in_use: "“{name}” passa por este destino (como jump): mude isso antes.",
    ssh_key_path_needed: "Informe o caminho do arquivo da chave.",
    ssh_vault_key_needed: "Escolha a chave do cofre.",
    ssh_secret_ref_invalid: "A referência do segredo não é válida.",
    ssh_jump_unknown: "O jump precisa ser um destino cadastrado.",
    ssh_jump_cycle: "O jump não pode formar um ciclo.",
    ssh_alive_range: "ServerAliveInterval vai de 1 a 3600 segundos.",
    ssh_forward_too_many: "LocalForward demais.",
    ssh_forward_invalid: "LocalForward inválido: {forward}",
    ssh_too_many_tags: "No máximo {max} tags.",
    ssh_tag_invalid: "Uma tag é inválida: até 40 caracteres, sem vírgula.",
    vault_rules_invalid: "Algumas regras não valem: corrija o que está marcado.",
    transport_refused:
      "Isto só funciona por uma conexão próxima: este computador (loopback) ou a Tailscale, que o WireGuard cifra. Para um host WSL, adicione-o como ws://localhost:<porta> (o WSL repassa a porta) ou pelo endereço da Tailscale.",
    trust_root_refused:
      "Esta pasta é uma pasta permitida com vários projetos, ou fica acima de uma: confie na pasta do próprio projeto.",
    harness_stale:
      "O projeto mudou desde a prévia, ou a prévia não era destas partes: faça a prévia de novo.",
    harness_confirm: "Mudar a configuração do Claude Code precisa da sua confirmação.",
    harness_reformat:
      "Gravar as configurações de volta mudaria o layout delas e pode reescrever alguns valores: confirme isso também, ou edite o arquivo à mão.",
    changes_commit_confirm: "Confirme o commit antes que ele seja feito.",
    changes_commit_target:
      "Só uma sessão iniciada à mão vira commit aqui: um cartão tem o seu próprio Abrir PR.",
    changes_commit_state:
      "O repositório está ocupado ({state}): termine ou desfaça isso num terminal e faça o commit de novo.",
    changes_commit_stale:
      "Os arquivos mudaram desde que você olhou: confira de novo e faça o commit.",
    changes_commit_secret:
      "{file} parece conter um segredo, então nada foi para o commit: tire-o antes.",
    changes_commit_message_secret:
      "A mensagem parece conter um segredo, então nada foi para o commit: tire-o antes.",
    changes_commit_too_large:
      "{file} é grande demais para procurar segredos: faça o commit você mesmo.",
    changes_commit_branch_taken: "Já existe um branch {branch}: escolha outro nome.",
    changes_commit_hook:
      "O commit foi recusado: {output}. Você está em {branch} com os arquivos como estavam; corrija e faça o commit de novo, ou volte com git checkout {base}.",
    changes_commit_timeout:
      "O commit passou do tempo (um hook ou um pedido de assinatura que não terminou). Você está em {branch} com os arquivos como estavam; volte com git checkout {base}.",
    changes_commit_hook_withheld:
      "O commit foi recusado, e o que o hook disse não aparece: parece conter um segredo. Você está em {branch} com os arquivos como estavam; volte com git checkout {base}.",
    changes_pr_confirm: "Confirme o PR antes que ele seja aberto.",
    changes_pr_target:
      "Só uma sessão iniciada à mão abre o seu PR aqui: um cartão tem o seu próprio Abrir PR.",
    changes_pr_on_base: "O checkout está no branch base: faça o commit num branch novo antes.",
    changes_pr_detached:
      "O checkout não está em nenhum branch: faça o commit num branch novo antes.",
    changes_pr_base:
      "Este branch não veio de um commit do app, então a base dele não é conhecida: abra o PR num terminal.",
    changes_pr_remote: "O destino do push mudou desde que você olhou: confira de novo e abra o PR.",
    changes_pr_ahead:
      "O branch base tem commits que ainda não estão no origin, e eles iriam junto com este PR: faça o push deles antes ou abra o PR num terminal.",
    changes_pr_moved:
      "O branch mudou desde o commit do app (outros commits ou outro ponto), então o PR dele só abre num terminal.",
    changes_commit_rewritten:
      "{files} mudou durante o commit (um hook que formata, ou a sessão ainda escrevendo), então o commit foi desfeito: confira as mudanças de novo e faça o commit.",
    changes_commit_git: "O git não conseguiu criar o branch ou o commit neste repositório.",
    harness_commit_stale:
      "Os arquivos não estão como a configuração os gravou: aplique a configuração de novo e faça o commit.",
    harness_commit_no_head: "O projeto ainda não tem commit de onde começar um branch.",
    harness_commit_identity:
      "O git não tem nome e e-mail para este repositório: defina user.name e user.email e faça o commit.",
    harness_commit_secret: "{file} contém um segredo, então não foi para o commit.",
    harness_commit_branch_taken: "O branch {branch} já existe: tente de novo em um minuto.",
    harness_commit_git:
      "O git não conseguiu fazer o commit ou o branch da configuração neste repositório.",
    harness_commit_ignored:
      "{file} é ignorado pelo git neste projeto, então não foi para o commit: faça o commit você mesmo se quiser.",
    harness_commit_withheld:
      "{file} poderia rodar um comando ou dar uma permissão ao carregar, então não foi para o commit: faça o commit você mesmo se quiser.",
    workflow_template_confirm: "Adicionar o modelo precisa da sua confirmação antes.",
    workflow_template_unknown: "Este host não tem o modelo {id}: abra os modelos de novo.",
    workflow_template_exists:
      "{path} já está em {base}: o projeto já tem este workflow. Veja na página de Workflows.",
    workflow_template_no_head:
      "O origin ainda não tem a branch base: envie a branch e adicione o modelo.",
    workflow_template_identity:
      "O git não tem nome e e-mail para este repositório: defina user.name e user.email e adicione o modelo.",
    workflow_template_branch_taken: "A branch {branch} já existe: tente de novo em um minuto.",
    workflow_template_git:
      "O git não conseguiu fazer o commit ou a branch do modelo neste repositório.",
    harness_draft_exists: "O projeto já tem um CLAUDE.md: um rascunho só cria um.",
    harness_draft_failed: "O modelo não respondeu com um CLAUDE.md: tente de novo.",
    harness_draft_secret: "O rascunho tinha um segredo, então foi descartado: tente de novo.",
    harness_template_id: "O id de um modelo usa letras minúsculas, dígitos e hífens, até 40.",
    harness_template_secret: "{file} contém um segredo, então nada foi compartilhado.",
    harness_template_empty: "O projeto não tem CLAUDE.md, agente ou skill para compartilhar.",
    harness_template_taken: "Já existe um modelo chamado {id} neste host: escolha outro nome.",
    harness_template_title_secret:
      "O título do modelo contém um segredo, então nada foi compartilhado.",
    harness_template_missing: "Não há mais um modelo {id} neste host: escolha outro.",
    secret_expired: "O prazo de uso do segredo passou: peça de novo.",
    vault_full:
      "O cofre do daemon está com segredos demais entregues: espere alguns serem usados ou vencerem.",
    vault_action_unknown: "A ação do cofre {action} não existe.",
    vault_action_failed: "A ação do cofre {action} falhou.",
    secret_wait_cancelled: "A espera pelo segredo foi cancelada.",
    secret_wait_timeout:
      "O segredo não foi entregue a tempo: o app está aberto, com o cofre destravado?",
    vault_closed: "O cofre foi encerrado.",
    secret_not_here:
      "O segredo não está com este daemon: o cofre é do app, que precisa estar aberto para entregá-lo.",
    secret_purpose_mismatch: "O segredo foi entregue para {held}, não para {purpose}.",
    budget_needs_project: "Um orçamento de projeto precisa de um projeto: escolha um.",
    budget_not_found: "Esse orçamento não existe mais.",
    telemetry_confirm: "Mexer no ~/.claude/settings.json pede a sua confirmação.",
    telemetry_owned_keys:
      "O settings.json já define {keys}: são suas, então nada foi mudado. Remova-as e tente de novo.",
    telemetry_port:
      "O receptor de telemetria não tem porta fixa: defina telemetry.port (ou hooks.port) na config do host.",
    bg_cli_failed: "O Claude Code recusou: {message}",
    bg_not_found: "A sessão em segundo plano {id} não aparece no claude agents.",
    bg_no_message_path:
      "Não dá para mandar mensagem a uma sessão em segundo plano que está rodando: trazer para o terminal, ou esperar ela terminar.",
    period_inverted: "O período está invertido: {from} é depois de {to}.",
    feature_off: "Este host não oferece {feature}: atualize o daemon ou confira as configurações.",
    cwd_missing: "A pasta {cwd} não existe neste host.",
    request_invalid: "O pedido tem um {field} errado ({command}): confira o que foi preenchido.",
    project_not_found: "O projeto {id} não está neste host: adicione-o antes.",
    persona_unknown: "A persona {persona} não existe neste host.",
    team_not_found: "O time {id} não existe neste host.",
    team_paused: "O time {name} está pausado: retome antes de acrescentar um membro.",
    team_member_unknown: "O time não tem o membro {member}.",
    persona_subagents_invalid: "As personas como subagentes devem ser all, project ou none.",
    column_unknown: "A coluna {column} não existe.",
    persona_id_invalid: "O id de persona não é válido.",
    repo_not_git: "{path} não é um repositório git.",
    search_busy: "Há buscas demais em andamento: tente de novo em instantes.",
    search_superseded: "Essa busca foi trocada por uma mais nova.",
    project_exists: "{path} já é um projeto.",
    card_not_found: "O card {id} não existe.",
    arena_variants: "Uma arena tem de 2 a 4 variantes.",
    arena_in_arena: "O card já está numa arena.",
    card_started: "O card já foi iniciado: a arena parte de um card novo.",
    arena_choose_confirm: "Escolher uma variante remove as outras: confirme antes.",
    arena_variant_unknown: "A variante {variant} não é desta arena.",
    arena_variant_running: "A variante ainda está rodando: espere terminar.",
    card_no_session: "O card ainda não tem sessão: inicie o card.",
    card_queued: "O card {id} já está na fila ou em execução.",
    card_workflow_running: "O card tem uma execução de workflow em andamento.",
    rule_remove_confirm: "Confirme a remoção da regra.",
    card_no_worktree: "O card ainda não tem worktree.",
    card_review_running: "O card está ocupado, ou a revisão dele já está rodando.",
    card_review_held:
      "Sem revisão agora: o host está pausado, no limite da cota, com pouca memória, ou o projeto está no orçamento.",
    card_review_no_diff: "O card não tem mudanças para revisar.",
    card_review_limit: "Este card já teve {max} revisões nas últimas 24 horas, o máximo por dia.",
    pr_secret: "A descrição parece ter um segredo ({found}): tire-o antes de abrir o PR.",
    pr_title_secret: "O título parece ter um segredo ({found}): tire-o antes de abrir o PR.",
    pr_push_timeout:
      "O push demorou demais e foi interrompido, então nenhum PR foi aberto: tente de novo ou faça o push num terminal.",
    pr_push_withheld:
      "O push falhou, e a saída dele parece ter um segredo ({found}), então ela não aparece: faça o push num terminal para vê-la.",
    merge_message_secret:
      "A mensagem do merge parece ter um segredo ({found}): tire-o antes de mesclar.",
    project_no_pr_provider:
      "O projeto não tem provedor de PR. Defina-o nas configurações do projeto (GitHub ou Azure DevOps), depois de adicionar um remote ao repositório se ele não tiver.",
    card_no_pr: "O card não tem PR.",
    card_pr_not_open: "O PR do card não está aberto.",
    card_pr_merge_unsupported:
      "Este host de PR não faz merge pelo Flightdeck: faça o merge do PR lá.",
    card_pr_checks_failing:
      "Os checks estão falhando ou ainda rodando: o PR ainda não pode ser mesclado.",
    card_pr_review_required: "O PR precisa de uma revisão antes de ser mesclado.",
    card_pr_conflict: "O PR tem conflito com a branch base: resolva o conflito antes.",
    card_pr_merge_failed: "Não foi possível fazer o merge do PR: {detail}",
    pr_no_comment: "Nenhum comentário foi escolhido.",
    card_running: "O card está em execução: espere o agente terminar.",
    merge_confirm: "Confirme o merge.",
    card_has_pr: "O card tem PR: ele é concluído pelo PR.",
    worktree_dirty: "O worktree do card tem mudanças não commitadas: {files}.",
    nothing_ahead: "Não há nada à frente de {base}.",
    complete_confirm: "Confirme a conclusão do card.",
    discard_confirm: "Confirme o descarte do card.",
    delete_confirm: "Confirme a exclusão do card.",
    card_delete_started:
      "O card já começou e não pode ser excluído: descarte-o para limpar o trabalho dele.",
    base_not_local: "A base {base} não é uma branch local.",
    rebase_conflict: "Atualizar com {base} dá conflito em: {files}.",
    merge_conflict: "Juntar com {base} dá conflito em: {files}.",
    base_checkout_dirty: "{base} está em checkout em {checkout} com mudanças: {files}.",
    tool_missing: "{name} não foi encontrado no PATH.",
    command_failed: "{what} falhou: {output}",
    pr_url_part_invalid: "O {what} na URL do PR não é válido: {value}",
    pr_url_invalid: "A URL de PR do {provider} não é válida: {url}",
    setup_failed: "A preparação do projeto falhou (código {code}): {output}",
    settings_invalid: "{file} não é um objeto JSON válido.",
    rule_not_found: "A regra {rule} não existe.",
    persona_not_object: "A persona precisa ser um objeto.",
    persona_field_unknown: "Campo desconhecido: {field}.",
    persona_id_format:
      "O id leva letras minúsculas, números e hífen, de 1 a 40 (vira nome de arquivo e de agente).",
    persona_field_required: "{field} é obrigatório.",
    persona_field_length: "{field}: de 1 a {max} caracteres.",
    persona_field_line: "{field}: de 1 a {max} caracteres, numa linha só.",
    persona_field_invalid: "{field} não é válido.",
    persona_effort: "effort deve ser um de: {values}.",
    persona_mode: "permissionMode deve ser um de: {values}.",
    persona_body_empty: "O corpo da persona não pode ser vazio.",
    persona_body_big: "O corpo passa de 8 KB.",
    persona_body_control: "O corpo tem caracteres de controle.",
    persona_has_secret: "A persona tem um segredo ({kinds}): instruções não levam segredo.",
    persona_tools_list: "tools: uma lista de até 50 nomes.",
    persona_tools_names:
      "tools: nomes de ferramenta simples, sem repetir e sem regras de permissão.",
    persona_frontmatter_missing: "A persona começa com um frontmatter entre linhas ---.",
    persona_frontmatter_invalid: "O frontmatter não é válido: {error}",
    persona_frontmatter_map: "O frontmatter precisa ser um mapa.",
    persona_id_filename: "O id ({id}) precisa ser o nome do arquivo ({file}).",
    scope_project_path: "O escopo project pede projectPath.",
    persona_not_found: "Essa persona não foi encontrada.",
    persona_publish_confirm: "Publicar como agente do projeto pede a sua confirmação.",
    persona_publisher_off: "O editor de agentes do projeto não está disponível.",
    persona_pack_only: "Só as personas do pacote voltam ao original.",
    persona_changed: "A persona mudou desde que foi mostrada: confira de novo.",
    persona_ref_needed: "Informe a persona por id ou por definição, uma das duas.",
    persona_project_path: "Uma persona de projeto pede projectPath.",
    persona_file_big: "O arquivo da persona é grande demais.",
    persona_untrusted_project:
      "A persona {id} vem do projeto e muda o comportamento do agente: confie nela antes de usar.",
    persona_not_applied: "Nenhuma persona foi aplicada a esta sessão.",
    session_target_needed: "Informe sessionId ou claudeSessionId, um dos dois.",
    terminal_sessions_off: "Sessões de terminal não estão disponíveis neste host.",
    snippet_scope_fixed: "Para mudar o escopo de um snippet, crie outro.",
    snippet_place_fixed: "Para mudar um snippet entre o arquivo e o host, crie outro.",
    snippet_file_missing: "O projeto não tem .flightdeck/snippets.yaml.",
    snippet_file_changed: "O arquivo mudou desde que foi mostrado: confira de novo.",
    snippet_file_errors: "O .flightdeck/snippets.yaml tem erros: corrija antes de salvar.",
    snippet_project_path: "Um snippet de projeto pede projectPath.",
    snippet_is_command: "Um comando é colado ou rodado, não enviado.",
    snippet_is_prompt: "Um prompt é enviado, não colado nem rodado.",
    snippet_untrusted_run:
      "Este comando vem do .flightdeck/snippets.yaml do projeto: confie no arquivo para rodá-lo, ou cole sem Enter.",
    snippet_terminal_needed: "Colar pede o terminal onde colar.",
    snippet_cwd_needed: "Rodar pede a pasta onde rodar.",
    terminals_off: "Terminais não estão disponíveis neste host.",
    clone_url_invalid: "O endereço não pode ser usado: sem espaços e sem começar com traço.",
    clone_url_scheme: "Só endereços https:// e ssh são clonados.",
    clone_name_invalid:
      "O nome da pasta não serve: use letras, números, ponto, traço e sublinhado.",
    clone_exists: "A pasta {path} já existe.",
    clone_failed: "O git não conseguiu clonar: {detail}",
    gh_missing: "O gh (a CLI do GitHub) não está instalado neste host.",
    gh_logged_out: "Este host não tem login no GitHub. Entre antes, na página do host.",
    gh_scope_missing: "O login do GitHub não tem a permissão {scope}: entre de novo.",
    repo_invalid: "{repo} não é um repositório no formato dono/nome.",
    repo_not_found: "O GitHub não conhece {repo}, ou este login não consegue vê-lo.",
    issue_invalid: "{id} não é um número de issue.",
    issue_not_found: "A issue {id} de {repo} não existe.",
    query_invalid: "O texto da busca é longo demais ou tem caractere de controle.",
    login_timeout: "O gh não deu o código de uso único a tempo. Tente de novo.",
    login_failed: "O gh não conseguiu iniciar o login: {detail}",
    logout_failed: "O gh não conseguiu sair: {detail}",
    login_from_env: "O login vem de uma variável de ambiente do daemon: remova-a de lá.",
    repos_failed: "O gh não conseguiu listar os repositórios: {detail}",
    issues_failed: "O gh não conseguiu ler as issues: {detail}",
    board_not_found: "O quadro não foi encontrado, ou este login não consegue vê-lo.",
    board_sync_scope_missing:
      "O login do GitHub não tem a permissão {scope}: entre de novo com ela.",
    board_sync_field_not_found: "O quadro não tem o campo {field}.",
    board_sync_option_not_found: "O quadro não tem a opção de status {option}.",
    board_sync_push_off: "O envio para este quadro está desligado.",
    board_sync_rate_limited:
      "O limite do GitHub foi atingido; o quadro sincroniza de novo depois de {resetAt}.",
    board_sync_already_linked: "Este projeto já está ligado a um quadro.",
    board_sync_not_linked: "Este projeto não está ligado a um quadro.",
    board_sync_map_invalid: "O mapa tem uma coluna ou um status que o quadro não tem: {option}.",
    board_sync_confirm: "Enviar mudanças ao quadro precisa da sua confirmação.",
    board_sync_failed: "Não deu para falar com o quadro: {detail}",
    roi_period_invalid: "O período precisa ser de dias reais, de no máximo um ano.",
    root_confirm: "Adicionar uma pasta permitida precisa da sua confirmação.",
    root_missing: "A pasta {path} não existe neste host.",
    root_system:
      "A pasta {path} é uma pasta do sistema: ela não pode ser uma pasta permitida. Escolha uma pasta de projeto.",
    cwd_outside_roots:
      "A pasta {cwd} está fora das pastas permitidas do host. Adicione-a com flightdeckd setup ou em allowedRoots, em ~/.flightdeck/config.json.",
    session_not_found: "A sessão {id} não existe neste host.",
    teleport_busy:
      "Esta sessão está trabalhando ou espera uma resposta. Mova-a quando estiver parada.",
    teleport_team:
      "Uma sessão de time ainda não pode mudar de host: mova uma sessão de cada vez, fora de um time.",
    teleport_runtime: "Só uma sessão do Claude Code pode mudar de host.",
    teleport_no_transcript: "Este host não tem a transcrição da sessão para mover.",
    teleport_unsafe_transcript:
      "A transcrição da sessão não é um arquivo comum dentro do histórico do Claude Code, por isso não é lida.",
    teleport_too_large: "A transcrição passa de {max} bytes, o máximo que uma mudança leva.",
    teleport_not_found:
      "Esta mudança não está mais no host: foi cancelada ou o tempo acabou. Comece de novo.",
    teleport_too_many: "Este host já está movendo duas sessões. Espere uma terminar, ou cancele-a.",
    teleport_no_git:
      "A pasta da sessão não é um repositório git com um commit: o código dela não pode mudar de host.",
    teleport_no_remote:
      "O repositório da sessão não tem uma branch do origin para partir: o outro host não conseguiria buscar o código.",
    teleport_git:
      "O git não conseguiu empacotar o código da sessão. Tente de novo; se falhar outra vez, confira o repositório.",
    teleport_stopped:
      "O host está parando, por isso a sessão não mudou de host. Tente de novo quando ele voltar.",
    teleport_incomplete:
      "Parte da sessão ainda não chegou a este host, por isso ela não pode começar aqui. Tente mudar de novo.",
    teleport_corrupt:
      "O que chegou a este host não bate com o que o outro host mandou, por isso foi descartado. Tente mudar de novo.",
    teleport_no_project:
      "Este repositório não é o projeto da sessão: ele não tem o commit de onde a sessão parte. Escolha o repositório do mesmo projeto.",
    teleport_exists:
      "Este host já tem essa sessão do Claude, com turnos que a movida não tem ou ainda em uso aqui, por isso ela não foi movida por cima. Abra a que está aqui, ou feche-a aqui e mova de novo.",
    runtime_unavailable: "O OpenCode não está disponível neste host.",
    runtime_unsupported: "Uma sessão do OpenCode não oferece {feature}.",
    opencode_unsafe_global:
      "O OpenCode {version} não pode rodar aqui: a configuração global ou do sistema carrega código ou servidores que o Flightdeck não permite ({found}).",
    opencode_config_outranks:
      "OpenCode {version}: {what} passaria por cima das perguntas do Flightdeck, então a sessão não foi iniciada.",
    opencode_saved_rules:
      'O OpenCode {version} tem regras "sempre" salvas para esta pasta, que pulariam as perguntas do Flightdeck: {rules}. Remova com: {commands}',
    opencode_preflight_failed:
      "O OpenCode {version} não conseguiu verificar esta pasta. Tente de novo ou rode flightdeckd doctor.",
    opencode_changed:
      "O OpenCode mudou desde que o daemon o verificou. Reinicie o daemon, ou rode flightdeckd doctor, para verificar de novo.",
    opencode_permissions_overridden:
      "Algo fora do Flightdeck mudou as regras do OpenCode durante a sessão ({detail}), então a sessão foi parada.",
    opencode_auth_required:
      "O OpenCode não tem login neste provedor: rode opencode auth login no host.",
    opencode_disabled: "O OpenCode está desligado na configuração deste host.",
    opencode_missing: "O OpenCode não está instalado neste host.",
    opencode_version_failed: "O OpenCode não informou a versão.",
    opencode_v1: "Este host tem o OpenCode 1; o Flightdeck precisa do OpenCode 2.",
    opencode_project_config_not_disabled:
      "O OpenCode {version} não desligou a configuração do projeto, então o Flightdeck não pode usá-lo com segurança.",
    opencode_canary_failed: "Não foi possível verificar o OpenCode neste host.",
    opencode_scope_mismatch:
      "O OpenCode lê a configuração global de outra pasta, não da que o Flightdeck verificou.",
    session_ended:
      "A sessão não está rodando (terminou ou deu erro): retome-a para mandar uma mensagem.",
    session_not_ended: "A sessão ainda está rodando: não há o que retomar.",
    personas_off: "Personas não estão disponíveis neste host.",
    session_not_running: "A sessão não tem um processo rodando: retome-a antes.",
    mcp_set_not_live: "A sessão não está rodando, então os servidores MCP não podem ser mudados.",
    mcp_query_not_live: "A sessão não está rodando, então não dá para consultar os servidores MCP.",
    external_no_channel:
      "Esta sessão não tem canal: só sessões abertas com flightdeckd claude recebem mensagens.",
    bypass_not_allowed:
      "Este host não permite sessões sem pedidos de permissão. Ative antes nas configurações do host.",
    bypass_confirm: "Ativar sessões sem pedidos de permissão precisa da sua confirmação.",
    card_scope_unknown:
      "Esta sessão não roda em um projeto deste host, então não pode gerenciar cards.",
    card_id_needed: "Esta sessão não está em um card: diga qual card.",
    card_other_project: "Esse card é de outro projeto que não o desta sessão.",
    card_manage_args: "Falta algo que essa ação no card precisa.",
    transcript_not_indexed: "O transcript {id} não está indexado neste host.",
    session_maybe_active:
      "A sessão pode estar em uso em outro lugar: retome mesmo assim só se tiver certeza de que não está.",
  },
  assistantRefusal: {
    assistant_not_configured: "Escolha antes um provedor de IA em Configurações, Assistente.",
    assistant_empty_input: "Escreva algo primeiro.",
    assistant_too_long: "O texto é longo demais para o assistente (no máximo {max} caracteres).",
    assistant_secret_found:
      "Nada foi enviado: o texto parece conter um segredo ({labels}). Remova-o e tente de novo.",
    assistant_vault_value:
      "Nada foi enviado: o texto contém o valor de um segredo do cofre ({names}). Remova-o e tente de novo.",
    assistant_quota_blocked:
      "O plano do Claude no host está no limite até {until}. Tente depois disso, ou escolha outro provedor.",
    assistant_host_unavailable: "O Claude Code no host não consegue responder: {detail}",
    assistant_auth: "O provedor recusou a chave. Confira em Configurações, Assistente.",
    assistant_credits: "O provedor diz que não há mais crédito nesta chave.",
    assistant_rate_limited: "Pedidos demais agora. Espere um pouco e tente de novo.",
    assistant_repo_other_host:
      "O host do assistente não é o host deste cartão e não lê o repositório dele. Escolha o host do cartão ou uma chave de API.",
    assistant_overloaded: "O provedor está sobrecarregado. Tente de novo em instantes.",
    assistant_routing_unavailable:
      "Nenhum provedor deste modelo no OpenRouter aceita o pedido sem coletar dados. Desligue a opção de dados em Configurações, ou escolha outro modelo.",
    assistant_model_unavailable:
      "O provedor não oferece este modelo. Escolha outro em Configurações.",
    assistant_truncated:
      "A resposta foi cortada antes do fim. Tente de novo, ou use um texto mais curto.",
    assistant_refused: "O modelo se recusou a responder a este texto.",
    assistant_bad_output: "O modelo deu uma resposta que não dá para usar. Tente de novo.",
    assistant_placeholders_changed:
      "A sugestão mudou as variáveis do snippet, então não é oferecida. Tente de novo.",
    assistant_timeout: "O provedor demorou demais para responder.",
    assistant_cancelled: "Cancelado.",
    assistant_offline: "Não foi possível alcançar o provedor. Confira a conexão.",
    assistant_no_changes: "Não há alterações para descrever.",
    assistant_not_a_repo: "Esta pasta não é um repositório git.",
    assistant_request_id: "Id do pedido: {id}",
    assistant_key_invalid: "Essa chave não pode ser usada: {why}.",
    assistant_key_store:
      "Não deu para acessar o cofre de credenciais do sistema. Tente de novo ou veja se ele está desbloqueado.",
  },
  snippetRefusal: {
    name_invalid: "Nome de 1 a 64 caracteres: letras, números, espaço, . _ -",
    needs_run: "Um comando precisa de algo para rodar.",
    needs_text: "Um prompt precisa de texto.",
    no_text: "Um comando não leva texto: use só o campo do comando.",
    no_run: "Um prompt não leva comando: use só o campo do texto.",
    too_big: "O snippet é grande demais.",
    control_command: "Um comando é uma linha, sem caracteres de controle.",
    control_prompt: "O texto tem caracteres de controle.",
    var_name:
      "{name} não é um nome de variável válido: use letras, dígitos e _, sem começar por dígito.",
    var_special: "{name} é uma variável especial: vem do contexto, então não a declare.",
    var_unused: "A variável {name} não é usada no texto.",
    too_many_tags: "No máximo {max} tags.",
    tag_invalid: "Uma tag é inválida: até 30 caracteres, sem vírgula.",
    too_many_options: "Opções demais em {name}.",
    options_plain: "As opções de {name} são texto simples, sem repetir.",
    default_control: "O padrão de {name} tem caracteres de controle.",
    default_not_option: "O padrão de {name} precisa estar entre as opções.",
    value_control: "O valor de {name} tem quebra de linha ou caracteres de controle.",
    value_not_option: "{name}: o valor está fora das opções ({options}).",
    missing_values: "Faltam valores: {names}.",
    name_taken: "Já existe um snippet chamado {name}.",
    not_found: "Esse snippet não foi encontrado.",
    secret: "O snippet tem um segredo ({kinds}): guarde-o no cofre, ou transforme em ação.",
  },
} as const;

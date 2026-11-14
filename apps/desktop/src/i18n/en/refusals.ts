/** What a refusal of the daemon, of the assistant and of the snippets says, one entry per code. */
export const refusals = {
  daemonRefusal: {
    account_refresh_too_soon: "The account was read a moment ago: try again in {waitSeconds} s.",
    account_unavailable:
      "This host's Claude account could not be read. Check that `claude` is installed there, then try again.",

    autoapprove_resume_confirm: "Resuming auto-approval needs your confirmation.",
    terminal_enable_confirm:
      "Turning the terminal on gives a full shell on this host: confirm it to go on.",
    central_confirm: "Changing the host's ~/.claude/settings.json needs your confirmation.",
    service_confirm: "Installing the service on the host needs your confirmation.",
    service_unsupported:
      "This host has no service manager that can start flightdeckd at boot ({platform}).",
    permission_request_closed: "The permission request {id} is not open.",
    hold_required: "A high-risk request is approved only by holding the button.",
    input_changed: "A request is approved as it was asked: the answer changes what it runs.",
    update_needs_service:
      "The daemon does not run as a service: update on the host with flightdeckd update --from <new binary>.",
    update_signature_failed: "The update could not be verified: {why}",
    messaging_session_missing: "The session {id} does not exist.",
    messaging_plain_session:
      "A plain claude with no channel only receives through Claude Code's own exchange.",
    messaging_channel_down: "The terminal's channel is not connected.",
    messaging_idle_other_host:
      "The session {address} is on another host: the idle notice only covers sessions of this host.",
    messaging_asker_unknown:
      "The session that is asking does not exist on this host: it is not known who is sending.",
    messaging_target_not_found: "The session {address} was not found.",
    messaging_host_unknown: "The host {host} is not known: the app describes the hosts.",
    messaging_peer_not_found: "The session {address} was not found on the host {host}.",
    messaging_self: "A session does not message itself.",
    messaging_no_route:
      "The sessions are not in the same project or team, and no exception in Settings frees this pair.",
    messaging_read_other_host:
      "The session is on another host: read_session only reads sessions of this host.",
    messaging_policy_invalid: "The messaging rules are not valid: {errors}",
    project_no_issues: "This project has no issue integration: set it in the project's settings.",
    card_contract_unmet: "This card isn't ready for {column}: it lacks {needs}.",
    findings_missing: "The reply of step {step} has no list of findings, so no card was created.",
    findings_invalid:
      "The reply of step {step} is not a valid list of findings ({where}), so no card was created.",
    spec_path_invalid:
      "The spec path must be a relative path to a Markdown file inside the worktree, like specs/name.md.",
    card_template_unknown:
      "This project offers no card template with that name: pick another or make a blank card.",
    pinned_doc_invalid:
      "A pinned document must be a Markdown file in the project's docs (decisions, adr, rfc, prd or specs), and a card pins at most 10.",
    card_moved_anyway: "Moved to {column} anyway; it lacked {needs}.",
    spec_template_failed:
      "The spec template could not be written at {path} (a link or a file is in the way): the session started without it.",
    spec_template_untrusted:
      "This project has its own spec template, but the project is not trusted, so the built-in one was used. Trust the project to use it.",
    spec_template_unsafe:
      "The project's spec template was not used (it is a link, has a second name or is not a plain file): the built-in one was.",
    spec_template_too_big:
      "The project's spec template was not used (it is over 32 KiB): the built-in one was.",
    spec_template_empty:
      "The project's spec template was not used (it is empty): the built-in one was.",
    contract_invalid: "The contract for {column} is not valid.",
    project_no_origin: "This project has no origin remote.",
    remote_not_github: "The remote {url} is not a GitHub one.",
    remote_not_azure: "The remote {url} is not an Azure DevOps one.",
    issue_id_invalid: "{id} is not a valid issue id: it is digits only.",
    issue_not_this_project: "{issue} is not an issue of this project's {provider}.",
    issue_other_repo: "{issue} belongs to another repository than the project's.",
    issue_has_card: "The issue {ref} already has the card {card}.",
    plugin_arg_refused: "The value {value} is refused: it would read as an option.",
    plugin_not_installed: "{id} is not installed.",
    marketplace_missing: "The marketplace {marketplace} does not exist.",
    plugin_not_in_marketplace: "{id} is not in the marketplace.",
    marketplace_update_failed: "The marketplace {marketplace} could not be refreshed: {why}",
    plugin_preview_unavailable_update: "The content of {id} cannot be shown before updating.",
    plugin_validate_refused: "The plugin validator refused it: {errors}",
    plugin_preview_unavailable_install: "The content of {name} cannot be shown before installing.",
    plugin_pinned: "{id} is pinned at version {version}: release it before updating.",
    plugin_remove_confirm: "Removing a plugin needs your confirmation.",
    marketplace_add_confirm: "Adding a marketplace needs your confirmation.",
    marketplace_remove_confirm: "Removing a marketplace needs your confirmation.",
    plugin_content_changed: "The content changed since it was shown: look at the preview again.",
    marketplace_catalog_unreadable:
      "The catalog of the marketplace {marketplace} could not be read.",
    plugin_command_mismatch:
      "Only the command that was shown can be accepted: ask to see it again.",
    plugins_stopped: "The plugin manager was stopped.",
    plugin_cli_failed: "claude plugin {command} failed: {why}",
    plugin_cli_not_json: "claude plugin {command} did not answer JSON.",
    claude_not_found: "claude was not found on this host's PATH.",
    plugin_dir_missing: "The folder {dir} does not exist.",
    plugin_too_many_files: "The plugin has too many files (more than {max}).",
    team_quota_until:
      "The plan quota is over its limit until {until}: create the team later, or it would start paused.",
    team_quota_over:
      "The plan quota is over its limit: create the team later, or it would start paused.",
    name_blank: "The name cannot be blank.",
    session_unnamed: "The session {id} has no name.",
    terminal_disabled: "The terminal is off on this host: turn it on in the host's settings.",
    terminal_stopping: "The daemon on this host is stopping: no terminal opens now.",
    terminal_missing: "The terminal {id} does not exist.",
    terminal_ended: "The terminal {id} has already ended.",
    terminal_limit: "This host allows {max} terminals: close one to open another.",
    claude_here_unavailable: '"Claude here" is not available on this host.',
    terminal_open_failed: "The terminal could not be opened: {why}",
    update_no_binary: "There is no daemon binary for {platform}-{arch}.",
    update_confirm: "Updating the daemon needs your confirmation.",
    update_manifest_unchecked:
      "The daemon has not checked for an update yet: try again in a moment.",
    update_manifest_no_binary: "The release {version} has no binary for {key}.",
    releases_unavailable: "The release notes could not be read from GitHub: try again later.",
    perm_rule_other_tool: "That rule belongs to another tool ({tool}).",
    perm_rule_too_broad:
      "That rule would also allow {tool} uses of {level} risk, more than this request: narrow it.",
    perm_rule_content_invalid: "The rule's content is not valid: one line, up to 500 characters.",
    perm_destination_denied: "The destination {destination} is not allowed for a rule.",
    perm_mode_denied: "The mode {mode} cannot be set from an answer.",
    perm_tool_always_asks: "This tool always asks: no rule can allow it.",
    perm_not_suggested: "That is neither one of the request's suggestions nor a project rule.",
    team_session_foreign: "This session is not part of the team {team}.",
    team_report_not_coordinator: "Only the coordinator of the team {team} reports its outcome.",
    team_manage_not_coordinator:
      "Only the coordinator of the team {team} adds or removes its members.",
    team_full: "The team {name} already has {workers} workers: remove one before adding another.",
    team_close_confirm: "Closing the team {name} needs your confirmation.",
    team_coordinator_stays: "The coordinator does not leave the team: close the team instead.",
    team_closed: "The team {name} is closed.",
    team_delete_open: "The team {name} is still open: close it first.",
    team_delete_live:
      "The team {name} still has {members} member(s) at work: wait until they rest, then delete it.",
    agentcfg_file_missing: "{path} does not exist in this project.",
    agentcfg_path_invalid: "{path} is not a valid path for this kind of file ({kind}).",
    agentcfg_confirm: "Writing the file needs your confirmation.",
    agentcfg_user_readonly: "The user's configuration (~/.claude) is read-only here.",
    agentcfg_outside_project: "{path} would end up outside the project: nothing was written.",
    agentcfg_exists: "{path} already exists: open it to change it.",
    agentcfg_changed: "{path} changed since you opened it: open it again before saving.",
    agentcfg_frontmatter_missing: "The file needs a YAML frontmatter between --- lines.",
    agentcfg_field_required: "The frontmatter needs the field {field}.",
    agentcfg_tools_type: "In the frontmatter, tools is a text or a list of texts.",
    agentcfg_model_type: "In the frontmatter, model is a text.",
    mcp_write_confirm: "Saving to .mcp.json needs your confirmation.",
    mcp_remove_confirm: "Removing from .mcp.json needs your confirmation.",
    mcp_toggle_confirm: "Turning a server on or off needs your confirmation.",
    mcp_masked_values: "The env and header values show masked: type the value again to save.",
    mcp_server_missing: "The MCP server {name} does not exist.",
    mcp_server_external:
      "The server {name} comes from ~/.claude.json, which Flightdeck only reads.",
    mcp_timeout: "The server {name} did not answer in {seconds} s.",
    rewind_nothing: "There is no rewind to undo in this session.",
    rewind_confirm: "Rewinding files needs your confirmation.",
    rewind_turn_running: "The session is in a turn: stop it before rewinding.",
    snapshot_missing: "Turn {n} has no snapshot in this session.",
    rewind_no_safety_snapshot:
      "The safety snapshot could not be taken ({why}), so nothing was rewound.",
    fork_unsupported: "This runtime cannot fork sessions.",
    ssh_hostkey_exists:
      "A server key is already saved for this destination: forget it before replacing it.",
    ssh_hostkey_mismatch: "Confirm the fingerprint that was just shown: check it again.",
    ssh_target_unknown: "There is no ssh destination named {name}.",
    ssh_target_ambiguous: "More than one ssh destination is named {name}: rename one.",
    ssh_password_in_action:
      "{name} uses a password: an ssh action runs with nobody to type it. Use an agent or a key.",
    ssh_exec_off: "This host does not run ssh actions.",
    card_blocked: "This card is blocked by: {blockers}.",
    blocker_cycle: "That would close a cycle: {cycle}.",
    blocker_limit: "A card has at most {max} blockers.",
    blocker_other_project: "A blocker must be a card of the same project.",
    ssh_key_missing: "The vault key did not come with the request: unlock the vault and try again.",
    ssh_key_not_for_auth: "A vault key only applies to a destination that uses one.",
    ssh_askpass_off: "A password needs askpass, which is not available on this host.",
    ssh_jump_auth: "The jump {name} uses {auth}: a jump can only use the agent or a key file.",
    ssh_key_unreachable:
      "Could not read the server key of {name} from here: the first connection has to reach it directly.",
    ssh_hostkey_unconfirmed:
      "{name}: check the fingerprint {fingerprint}, then confirm it to connect.",
    ssh_hostkey_changed:
      "{name}: the server key changed (saved {pinned}, now {fingerprint}). Check with whoever runs it; if the change is expected, forget the saved key and confirm the new one.",
    ssh_askpass_ticket_invalid: "The password request is no longer valid. Connect again.",
    ssh_askpass_no_app:
      "No Flightdeck window is open to ask for the password. Open the app and connect again.",
    ssh_askpass_timeout: "Nobody answered the password request in time. Connect again.",
    ssh_askpass_request_unknown: "That password request is gone: it was answered or timed out.",
    ssh_askpass_cancelled: "The password request was cancelled.",
    ssh_askpass_cmd_path:
      "The daemon's path has a % or a quote, which a Windows .cmd cannot hold. Move the daemon to a folder without them.",
    ssh_key_perms:
      "The key file's permissions could not be restricted to your user, so the key was not used.",
    ssh_agent_down:
      "The ssh-agent for this connection did not start. Check that ssh-agent is installed.",
    ssh_add_refused: "ssh-add refused the key. Check that the key is valid and has no passphrase.",
    ssh_import_cycle: "The ProxyJump entries loop back on each other.",
    ssh_import_not_in_config: "That name is not in your ~/.ssh/config.",
    ssh_import_exists: "Already saved.",
    ssh_import_multi_jump:
      "ProxyJump {jump} lists several jumps, which are not supported. Import each hop on its own.",
    ssh_import_jump_unknown: "ProxyJump {jump} is not a saved destination. Import it first.",
    ssh_import_jump_failed: "The jump {jump} could not be created, so this one was skipped.",
    ssh_test_auth: "The server refused the authentication. Check the user and the key.",
    ssh_test_refused: "The server refused the connection. Check the host and the port.",
    ssh_test_host_unknown: "The host name was not found. Check the spelling and your network.",
    ssh_test_timeout: "The connection timed out. Check the host, the port and your network.",
    ssh_test_hostkey:
      "The server key differs from the saved one. Check with whoever runs the server, then forget the saved key and confirm the new one.",
    ssh_test_exit: "ssh ended with code {code} and said nothing.",
    ssh_test_no_password: "The test does not cover passwords. Connect to test.",
    action_param_unknown: "Unknown parameter: {param}.",
    action_param_missing: "The action needs the parameter {param}.",
    action_param_pattern: "The value of {param} does not match the pattern {pattern}.",
    action_secret_missing:
      "The secret {secret} did not come with the request. Unlock the vault and try again.",
    action_ssh_unavailable:
      "The action {action} runs over ssh, and this host has no ssh destinations.",
    action_spawn_failed: "Could not start {command}. Check that it is installed and on the PATH.",
    action_request_gone: "That request is gone: it expired, was refused or already finished.",
    action_no_approval_needed: "That request needs no approval.",
    action_tray_refused:
      "The tray does not approve prod or high-risk requests. Approve it in the app.",
    action_hold_needed: "Hold the Approve button for 2 seconds.",
    action_session_refused_risky:
      "A prod or high-risk request is approved one use at a time, never for the session.",
    action_session_refused_rule:
      "The rule does not allow approving for the session: this request asks on every use.",
    action_needs_approval: "The request needs your approval before the secret is delivered.",
    usage_rules_unavailable: "Usage rules are not available on this host.",
    action_not_found: "The action {action} does not exist.",
    action_changed_review: "The action {action} changed. Review it again before trusting it.",
    action_ssh_host_unsupported:
      "The host {host} is an ssh destination, and this daemon runs no commands on destinations.",
    action_secret_name_invalid: "The secret name {secret} is not valid.",
    action_not_trusted: "The action {action} is not trusted. Review it and trust it first.",
    action_changed_since_trust:
      "The action {action} changed since it was trusted ({changes}). Review it and trust it again.",
    action_requester_refused:
      "Only Claude, an automation or a workflow can ask the app for secrets this way.",
    action_use_denied: "Use denied: {detail}",
    action_app_offline: "The app is not connected. It has to be open to release the secret.",
    action_secret_refused: "The app refused the secret {secret}.",
    action_secret_expired: "The request for the secret {secret} expired unanswered and was denied.",
    action_ssh_env_name: "{name} is not a valid variable name for an ssh action.",
    cron_fields: "A cron expression has 5 fields: minute, hour, day of month, month, day of week.",
    cron_step: "The step in cron field {field} is not valid: {part}.",
    cron_value: "The value in cron field {field} is not valid: {part}.",
    cron_range: "Cron field {field} takes values from {min} to {max}: {part}.",
    automation_tz_unknown: "The time zone {tz} is not known. Use a name like America/Sao_Paulo.",
    automation_send_needs_card:
      "Sending to a card needs a trigger that has a card: a PR comment or a CI failure.",
    automation_create_needs_label: "Creating a card needs the issue label trigger.",
    automation_name_required: "The automation needs a name.",
    automation_max_runs: "The daily limit is a whole number from 1 up.",
    automation_not_found: "The automation {id} does not exist.",
    automation_remove_confirm: "Removing an automation needs your confirmation.",
    automation_enable_confirm: "Turning an automation on needs your confirmation.",
    workflow_changed_review:
      "The workflow {name} changed. Review its commands again before trusting it.",
    workflow_invalid: "The workflow {name} has errors. Fix them before using it.",
    workflow_not_trusted:
      "The workflow {name} is not trusted. Trust it on the Workflows screen first.",
    run_resume_not_failed: "Only a run that failed can go on from where it stopped.",
    run_resume_card:
      "The run's card is gone, has no worktree or has another run going, so this run cannot go on.",
    run_resume_no_head:
      "This run ended before Flightdeck kept where the code was, so it can only run again from the start.",
    run_resume_workflow_changed:
      "The workflow {name} changed since this run, so it can only run again from the start.",
    run_card_gone: "The run's card is gone, so the run stopped when Flightdeck started again.",
    run_resume_branch_moved:
      "The card's branch changed since this run stopped, so it can only run again from the start.",
    check_loop_no_checks:
      "The project has no checks to run: add them in the project's Watch settings first.",
    check_loop_untrusted:
      "The project is not trusted: trust it before its checks run on their own.",
    check_loop_mode: "In plan mode the session cannot fix anything, so the checks do not run.",
    check_loop_confirm:
      "Confirm first: the checks will run the code this card writes, without asking you each time.",
    workflow_input_required: "The workflow needs the input {input}.",
    workflow_input_unknown: "The workflow has no input {input}.",
    workflow_gate_closed: "The gate {step} (attempt {attempt}) is not open.",
    workflow_run_not_found: "The run {id} does not exist.",
    workflow_not_on_branch: "The workflow {name} is not on the branch {branch}.",
    action_invalid: "The action has problems. Fix them and save again.",
    action_ssh_env_value:
      "The variable {name} has a line break or NUL, which an ssh action does not send.",
    review_path_outside: "The path {path} is outside the repository.",
    review_target_invalid: "{target} is not a session or a card to review.",
    branch_invalid: "{name} is not a valid branch name.",
    watch_off: "This card's PR is not watched: turn the watch on first.",
    watch_extend_blocked: "More rounds would not help: {reason}",
    watch_round_not_held: "That round is not held: there is nothing to push or drop.",
    watch_pr_not_open: "The card's PR is {state}: nothing is pushed to it.",
    watch_held_moved:
      "The branch has new commits since the round was held: look at them before you push or drop.",
    review_file_missing: "The file {path} does not exist.",
    review_file_big: "The file {path} is over 1 MB: edit it outside Flightdeck.",
    review_file_binary: "The file {path} is not text.",
    review_text_big: "The text is over 1 MB: shorten it or edit the file outside Flightdeck.",
    review_file_changed:
      "The file {path} changed since it was opened: reload it and apply your edit again.",
    knowledge_frontmatter:
      "The front matter of {path} cannot be changed safely from here: edit the file by hand.",
    knowledge_title_invalid: "Give the document a title with letters or digits.",
    knowledge_folder_unsafe:
      "The folder for this document is a link or lies outside the project: nothing was written.",
    knowledge_exists: "A document named {path} already exists: nothing was overwritten.",
    review_revert_confirm: "Confirm the revert to go on.",
    review_undo_confirm: "Confirm the undo to go on.",
    review_undo_nothing:
      "There is nothing to undo in {path}: the revert can be undone for 30 seconds only.",
    review_path_link: "The path {path} points outside the repository.",
    review_file_secret:
      "The file {path} may hold a credential: Flightdeck does not show or change it.",
    review_comment_empty: "The comment is empty: write something.",
    review_side_missing: "The file {path} does not exist on that side of the diff.",
    review_lines_outside: "The lines {start}–{end} are outside {path}.",
    review_comment_sent: "That comment was already sent: it can no longer be edited.",
    review_no_drafts: "There is no draft comment to send.",
    review_comment_not_found: "The comment {id} does not exist.",
    memory_write_confirm: "Confirm the write to go on.",
    memory_exists: "The memory {name} already exists: open it to edit.",
    memory_changed: "The memory {name} changed since it was opened: reload it first.",
    memory_delete_confirm: "Confirm the delete to go on.",
    memory_not_found: "The memory {name} does not exist.",
    memory_name_invalid: "{name} is not a valid memory name: use a plain file name ending in .md.",
    memory_is_link: "{name} is a link: Flightdeck does not follow it.",
    memory_dir_outside:
      "The memory folder is outside the Claude folder: Flightdeck does not touch it.",
    run_config_missing: "The base branch has no run.yaml: add one to run this project.",
    run_config_changed: "The run.yaml changed: review the commands again before trusting it.",
    run_config_invalid: "The run.yaml has validation errors: {errors}",
    run_config_untrusted: "The run.yaml is not trusted yet: trust it on the card.",
    run_exclusive:
      "Another card is running in this project, which runs one card at a time: stop it first.",
    plugin_too_big: "The plugin is over 50 MB: Flightdeck does not read it.",
    run_ports_exhausted: "No free block of {size} ports is left: stop a running card.",
    ssh_target_not_found: "That ssh destination was not found.",
    ssh_name_invalid: "The name takes 1 to 100 characters.",
    ssh_host_invalid: "The host is not a valid name or address.",
    ssh_user_invalid: "The user is not valid.",
    ssh_port_invalid: "The port must be a number from 1 to 65535.",
    ssh_forward_agent_confirm:
      "ForwardAgent hands your agent to the remote host: confirm it to go on.",
    ssh_remove_confirm: "Removing a destination needs confirmation.",
    ssh_jump_in_use: "“{name}” goes through this destination (as its jump): change that first.",
    ssh_key_path_needed: "Give the path of the key file.",
    ssh_vault_key_needed: "Choose the key from the vault.",
    ssh_secret_ref_invalid: "The secret reference is not valid.",
    ssh_jump_unknown: "The jump must be a registered destination.",
    ssh_jump_cycle: "The jump cannot make a cycle.",
    ssh_alive_range: "ServerAliveInterval takes 1 to 3600 seconds.",
    ssh_forward_too_many: "Too many LocalForward entries.",
    ssh_forward_invalid: "LocalForward is not valid: {forward}",
    ssh_too_many_tags: "At most {max} tags.",
    ssh_tag_invalid: "A tag is invalid: up to 40 characters, no commas.",
    vault_rules_invalid: "Some rules are not valid: fix what is marked.",
    transport_refused:
      "This only works over a near connection: this computer (loopback) or Tailscale, which WireGuard encrypts. For a WSL host, add it as ws://localhost:<port> (WSL forwards the port) or by its Tailscale address.",
    trust_root_refused:
      "This folder is an allowed folder that holds several projects, or a folder above one: trust the project's own folder instead.",
    harness_stale:
      "The project changed since the preview, or the preview was not of these parts: preview again.",
    harness_confirm: "Changing the Claude Code setup needs your confirmation.",
    harness_reformat:
      "Writing the settings back would change their layout, and may rewrite some values: confirm that too, or edit the file by hand.",
    changes_commit_confirm: "Confirm the commit before it is made.",
    changes_commit_target:
      "Only a session started by hand is committed here: a card has its own Open PR.",
    changes_commit_state:
      "The repository is busy ({state}): finish or undo it in a terminal, then commit again.",
    changes_commit_stale: "The files changed since you looked: check them again, then commit.",
    changes_commit_secret:
      "{file} looks like it holds a secret, so nothing was committed: take it out first.",
    changes_commit_message_secret:
      "The message looks like it holds a secret, so nothing was committed: take it out first.",
    changes_commit_too_large: "{file} is too large to check for secrets: commit it yourself.",
    changes_commit_branch_taken: "There is already a branch {branch}: pick another name.",
    changes_commit_hook:
      "The commit was refused: {output}. You are on {branch} with your files as they were; fix it and commit again, or go back with git checkout {base}.",
    changes_commit_timeout:
      "The commit ran out of time (a hook or a signing prompt that never ended). You are on {branch} with your files as they were; go back with git checkout {base}.",
    changes_commit_hook_withheld:
      "The commit was refused, and what the hook said is not shown: it looks like it holds a secret. You are on {branch} with your files as they were; go back with git checkout {base}.",
    changes_pr_confirm: "Confirm the PR before it is opened.",
    changes_pr_target:
      "Only a session started by hand opens its PR here: a card has its own Open PR.",
    changes_pr_on_base: "The checkout is on the base branch: commit on a new branch first.",
    changes_pr_detached: "The checkout is on no branch: commit on a new branch first.",
    changes_pr_base:
      "This branch was not made by a commit from the app, so its base is not known: open its PR from a terminal.",
    changes_pr_remote:
      "Where the push goes changed since you looked: check it again, then open the PR.",
    changes_pr_ahead:
      "The base branch has commits that are not on origin yet, and they would go out with this PR: push them first, or open the PR from a terminal.",
    changes_pr_moved:
      "The branch moved since the app's commit (other commits, or another point), so only a terminal opens its PR.",
    changes_commit_rewritten:
      "{files} changed while being committed (a hook that formats, or the session still writing), so the commit was undone: look at the changes again, then commit.",
    changes_commit_git: "Git could not make the branch or the commit in this repository.",
    harness_commit_stale:
      "The files are not as the setup wrote them: apply the setup again, then commit.",
    harness_commit_no_head: "The project has no commit yet to start a branch from.",
    harness_commit_identity:
      "Git has no name and email for this repository: set user.name and user.email, then commit.",
    harness_commit_secret: "{file} holds a secret, so it was not committed.",
    harness_commit_branch_taken: "The branch {branch} is already there: try again in a minute.",
    harness_commit_git: "Git could not make the setup's commit or branch in this repository.",
    harness_commit_ignored:
      "{file} is ignored by git in this project, so it was not committed: commit it yourself if you mean to.",
    harness_commit_withheld:
      "{file} could run a command or grant a permission when it loads, so it was not committed: commit it yourself if you mean to.",
    workflow_template_confirm: "Adding the template needs your confirmation first.",
    workflow_template_unknown: "This host has no template {id}: open the templates again.",
    workflow_template_exists:
      "{path} is already on {base}: the project has this workflow. Find it on the Workflows page.",
    workflow_template_no_head:
      "origin has no copy of the base branch yet: push it, then add the template.",
    workflow_template_identity:
      "Git has no name and email for this repository: set user.name and user.email, then add the template.",
    workflow_template_branch_taken: "The branch {branch} is already there: try again in a minute.",
    workflow_template_git: "Git could not make the template's commit or branch in this repository.",
    harness_draft_exists: "The project already has a CLAUDE.md: a draft only creates one.",
    harness_draft_failed: "The model did not answer with a CLAUDE.md: try again.",
    harness_draft_secret: "The draft held a secret, so it was dropped: try again.",
    harness_template_id: "A template's id is lower case letters, digits and dashes, up to 40.",
    harness_template_secret: "{file} holds a secret, so nothing was shared.",
    harness_template_empty: "The project has no CLAUDE.md, agent or skill to share.",
    harness_template_taken: "A template named {id} is already on this host: pick another name.",
    harness_template_title_secret: "The template's title holds a secret, so nothing was shared.",
    harness_template_missing: "There is no template {id} on this host any more: pick another.",
    secret_expired: "The time to use that secret has passed: ask for it again.",
    vault_full:
      "The daemon's vault holds too many delivered secrets: wait for some to be used or to expire.",
    vault_action_unknown: "The vault action {action} does not exist.",
    vault_action_failed: "The vault action {action} failed.",
    secret_wait_cancelled: "The wait for the secret was cancelled.",
    secret_wait_timeout:
      "The secret was not delivered in time: is the app open, with the vault unlocked?",
    vault_closed: "The vault was closed.",
    secret_not_here:
      "The secret is not with this daemon: the vault belongs to the app, which must be open to deliver it.",
    secret_purpose_mismatch: "The secret was delivered for {held}, not for {purpose}.",
    budget_needs_project: "A project budget needs a project: choose one.",
    budget_not_found: "That budget no longer exists.",
    telemetry_confirm: "Changing ~/.claude/settings.json asks for your confirmation.",
    telemetry_owned_keys:
      "settings.json already sets {keys}: those are yours, so nothing was changed. Remove them and try again.",
    telemetry_port:
      "The telemetry receiver has no fixed port: set telemetry.port (or hooks.port) in the host's config.",
    bg_cli_failed: "Claude Code refused: {message}",
    bg_not_found: "The background session {id} is not listed by claude agents.",
    bg_no_message_path:
      "A message cannot be sent to a background session that is running: attach to it in a terminal, or wait until it is done.",
    period_inverted: "The period is backwards: {from} is after {to}.",
    feature_off: "This host does not offer {feature}: update the daemon, or check its settings.",
    cwd_missing: "The folder {cwd} does not exist on this host.",
    request_invalid: "The request has a wrong {field} ({command}): check what was filled in.",
    project_not_found: "The project {id} is not on this host: add it first.",
    persona_unknown: "The persona {persona} does not exist on this host.",
    team_not_found: "The team {id} does not exist on this host.",
    team_paused: "The team {name} is paused: resume it before adding a member.",
    team_member_unknown: "The team has no member {member}.",
    persona_subagents_invalid: "Subagent personas must be all, project or none.",
    column_unknown: "The column {column} does not exist.",
    persona_id_invalid: "A persona id is not valid.",
    repo_not_git: "{path} is not a git repository.",
    search_busy: "Too many searches are running: try again in a moment.",
    search_superseded: "That search was replaced by a newer one.",
    project_exists: "{path} is already a project.",
    card_not_found: "The card {id} does not exist.",
    arena_variants: "An arena has 2 to 4 variants.",
    arena_in_arena: "The card is already in an arena.",
    card_started: "The card was already started: an arena starts from a new card.",
    arena_choose_confirm: "Choosing a variant removes the others: confirm first.",
    arena_variant_unknown: "The variant {variant} is not in this arena.",
    arena_variant_running: "The variant is still running: wait for it to finish.",
    card_no_session: "The card has no session yet: start the card.",
    card_queued: "The card {id} is already queued or running.",
    card_workflow_running: "The card has a workflow run in progress.",
    rule_remove_confirm: "Confirm removing the rule.",
    card_no_worktree: "The card has no worktree yet.",
    card_review_running: "The card is busy, or its review is already running.",
    card_review_held:
      "No review now: the host is paused, at its quota guard, short of memory, or the project is at its budget.",
    card_review_no_diff: "The card has no changes to review.",
    card_review_limit: "This card has had {max} reviews in the last 24 hours, the most a day.",
    pr_secret:
      "The description looks like it has a secret ({found}): take it out before opening the PR.",
    pr_title_secret:
      "The title looks like it has a secret ({found}): take it out before opening the PR.",
    pr_push_timeout:
      "The push took too long and was stopped, so no PR was opened: try again, or push from a terminal.",
    pr_push_withheld:
      "The push failed, and its output looks like it has a secret ({found}), so it is not shown: push from a terminal to see it.",
    merge_message_secret:
      "The merge message looks like it has a secret ({found}): take it out before merging.",
    project_no_pr_provider:
      "The project has no PR provider. Set it in the project's settings (GitHub or Azure DevOps), after adding a remote to the repository if it has none.",
    card_no_pr: "The card has no PR.",
    card_pr_not_open: "The card's PR is not open.",
    card_pr_merge_unsupported: "This PR host cannot merge from Flightdeck: merge the PR there.",
    card_pr_checks_failing: "Checks are failing or still running: the PR cannot be merged yet.",
    card_pr_review_required: "The PR needs a review before it can be merged.",
    card_pr_conflict: "The PR conflicts with its base branch: resolve the conflict first.",
    card_pr_merge_failed: "The PR could not be merged: {detail}",
    pr_no_comment: "No comment was chosen.",
    card_running: "The card is running: wait for the agent to finish.",
    merge_confirm: "Confirm the merge.",
    card_has_pr: "The card has a PR: the PR completes it.",
    worktree_dirty: "The card's worktree has uncommitted changes: {files}.",
    nothing_ahead: "There is nothing ahead of {base}.",
    complete_confirm: "Confirm completing the card.",
    discard_confirm: "Confirm discarding the card.",
    delete_confirm: "Confirm deleting the card.",
    card_delete_started:
      "The card already started, so it cannot be deleted: discard it to clean up its work.",
    base_not_local: "The base {base} is not a local branch.",
    rebase_conflict: "Updating with {base} conflicts in: {files}.",
    merge_conflict: "Merging with {base} conflicts in: {files}.",
    base_checkout_dirty: "{base} is checked out at {checkout} with changes: {files}.",
    tool_missing: "{name} was not found on the PATH.",
    command_failed: "{what} failed: {output}",
    pr_url_part_invalid: "The {what} in the PR URL is not valid: {value}",
    pr_url_invalid: "The {provider} PR URL is not valid: {url}",
    setup_failed: "The project's setup script failed (exit {code}): {output}",
    settings_invalid: "{file} is not a valid JSON object.",
    rule_not_found: "The rule {rule} does not exist.",
    persona_not_object: "A persona must be an object.",
    persona_field_unknown: "Unknown field: {field}.",
    persona_id_format:
      "The id takes lowercase letters, digits and hyphens, 1 to 40 (it becomes a file and agent name).",
    persona_field_required: "{field} is required.",
    persona_field_length: "{field}: 1 to {max} characters.",
    persona_field_line: "{field}: 1 to {max} characters, on a single line.",
    persona_field_invalid: "{field} is not valid.",
    persona_effort: "effort must be one of: {values}.",
    persona_mode: "permissionMode must be one of: {values}.",
    persona_body_empty: "The persona's body cannot be empty.",
    persona_body_big: "The body is over 8 KB.",
    persona_body_control: "The body has control characters.",
    persona_has_secret: "The persona has a secret ({kinds}): instructions carry no secrets.",
    persona_tools_list: "tools: a list of up to 50 names.",
    persona_tools_names: "tools: plain tool names, with no repeats and no permission rules.",
    persona_frontmatter_missing: "A persona starts with a frontmatter between --- lines.",
    persona_frontmatter_invalid: "The frontmatter is not valid: {error}",
    persona_frontmatter_map: "The frontmatter must be a map.",
    persona_id_filename: "The id ({id}) must be the file name ({file}).",
    scope_project_path: "The project scope needs projectPath.",
    persona_not_found: "That persona was not found.",
    persona_publish_confirm: "Publishing as a project agent needs your confirmation.",
    persona_publisher_off: "The project's agent editor is not available.",
    persona_pack_only: "Only the pack's personas go back to the original.",
    persona_changed: "The persona changed since it was shown: check again.",
    persona_ref_needed: "Give the persona by id or by definition, one of the two.",
    persona_project_path: "A project persona needs projectPath.",
    persona_file_big: "The persona file is too big.",
    persona_untrusted_project:
      "The persona {id} comes from the project and changes the agent's behavior: trust it before using it.",
    persona_not_applied: "No persona was applied to this session.",
    session_target_needed: "Give sessionId or claudeSessionId, one of the two.",
    terminal_sessions_off: "Terminal sessions are not available on this host.",
    snippet_scope_fixed: "To change a snippet's scope, create another one.",
    snippet_place_fixed: "To move a snippet between the file and the host, create another one.",
    snippet_file_missing: "The project has no .flightdeck/snippets.yaml.",
    snippet_file_changed: "The file changed since it was shown: check again.",
    snippet_file_errors: "The .flightdeck/snippets.yaml has errors: fix them before saving.",
    snippet_project_path: "A project snippet needs projectPath.",
    snippet_is_command: "A command is pasted or run, not sent.",
    snippet_is_prompt: "A prompt is sent, not pasted or run.",
    snippet_untrusted_run:
      "This command comes from the project's .flightdeck/snippets.yaml: trust the file to run it, or paste without Enter.",
    snippet_terminal_needed: "Pasting needs the terminal to paste into.",
    snippet_cwd_needed: "Running needs the folder to run in.",
    terminals_off: "Terminals are not available on this host.",
    clone_url_invalid: "The address cannot be used: no spaces, and it cannot start with a dash.",
    clone_url_scheme: "Only https:// and ssh addresses are cloned.",
    clone_name_invalid:
      "The folder name is not usable: use letters, digits, dots, dashes and underscores.",
    clone_exists: "The folder {path} already exists.",
    clone_failed: "git could not clone: {detail}",
    gh_missing: "gh (the GitHub CLI) is not installed on this host.",
    gh_logged_out: "This host is not signed in to GitHub. Sign in on the host's page first.",
    gh_scope_missing: "The GitHub login lacks the {scope} permission: sign in again.",
    repo_invalid: "{repo} is not a repository in the owner/name form.",
    repo_not_found: "GitHub does not know {repo}, or this login cannot see it.",
    issue_invalid: "{id} is not an issue number.",
    issue_not_found: "Issue {id} of {repo} does not exist.",
    query_invalid: "The search text is too long or has a control character.",
    login_timeout: "gh did not give a one-time code in time. Try again.",
    login_failed: "gh could not start the sign-in: {detail}",
    logout_failed: "gh could not sign out: {detail}",
    login_from_env: "The login comes from an environment variable of the daemon: remove it there.",
    repos_failed: "gh could not list the repositories: {detail}",
    issues_failed: "gh could not read the issues: {detail}",
    board_not_found: "The board was not found, or this login cannot see it.",
    board_sync_scope_missing:
      "The GitHub login lacks the {scope} permission: sign in again with it.",
    board_sync_field_not_found: "The board has no {field} field.",
    board_sync_option_not_found: "The board has no status option {option}.",
    board_sync_push_off: "Pushing to this board is off.",
    board_sync_rate_limited:
      "GitHub's rate limit was reached; the board syncs again after {resetAt}.",
    board_sync_already_linked: "This project is already linked to a board.",
    board_sync_not_linked: "This project is not linked to a board.",
    board_sync_map_invalid:
      "The mapping has a column or a status the board does not have: {option}.",
    board_sync_confirm: "Pushing changes to the board needs your confirmation.",
    board_sync_failed: "The board could not be reached: {detail}",
    roi_period_invalid: "The period must be real days, at most a year long.",
    root_confirm: "Adding an allowed folder needs your confirmation.",
    root_missing: "The folder {path} does not exist on this host.",
    root_system:
      "The folder {path} is a system folder: it cannot be an allowed folder. Pick a project folder.",
    cwd_outside_roots:
      "The folder {cwd} is outside the host's allowed folders. Add it with flightdeckd setup, or in allowedRoots in ~/.flightdeck/config.json.",
    session_not_found: "Session {id} does not exist on this host.",
    teleport_busy: "This session is working or waits for an answer. Move it once it is idle.",
    teleport_team:
      "A session of a team cannot move yet: move one session at a time, outside a team.",
    teleport_runtime: "Only a Claude Code session can move to another host.",
    teleport_no_transcript: "This host has no transcript of the session to move.",
    teleport_unsafe_transcript:
      "The session's transcript is not a regular file inside Claude Code's history, so it is not read.",
    teleport_too_large: "The transcript is larger than {max} bytes, the most a move takes.",
    teleport_not_found:
      "This move is no longer on the host: it was cancelled or its time ran out. Start it again.",
    teleport_too_many:
      "This host is already moving two sessions. Wait for one to finish, or cancel it.",
    teleport_no_git:
      "The session's folder is not a git repository with a commit: its code cannot move.",
    teleport_no_remote:
      "The session's repository has no origin branch to start from: the other host could not fetch the code.",
    teleport_git:
      "Git could not pack the session's code. Try again; if it fails again, check the repository.",
    teleport_stopped:
      "The host is stopping, so the session did not move. Try again once it is back.",
    teleport_incomplete:
      "Part of the session has not arrived on this host yet, so it cannot start here. Try the move again.",
    teleport_corrupt:
      "What arrived on this host does not match what the other host sent, so it was thrown away. Try the move again.",
    teleport_no_project:
      "This repository is not the session's project: it does not have the commit the session starts from. Pick the repository of the same project.",
    teleport_exists:
      "This host already has that Claude session, with turns the moved one does not have or still in use here, so it was not moved over it. Open the one here instead, or close it here and move again.",
    runtime_unavailable: "OpenCode is not available on this host.",
    runtime_unsupported: "An OpenCode session does not offer {feature}.",
    opencode_unsafe_global:
      "OpenCode {version} cannot run here: its global or system config loads code or servers Flightdeck does not allow ({found}).",
    opencode_config_outranks:
      "OpenCode {version}: {what} would outrank Flightdeck's questions, so the session was not started.",
    opencode_saved_rules:
      'OpenCode {version} has saved "always" rules for this folder, which would skip Flightdeck\'s questions: {rules}. Remove them with: {commands}',
    opencode_preflight_failed:
      "OpenCode {version} could not check this folder. Try again, or run flightdeckd doctor.",
    opencode_changed:
      "OpenCode changed since the daemon checked it. Restart the daemon, or run flightdeckd doctor, to check it again.",
    opencode_permissions_overridden:
      "Something outside Flightdeck changed OpenCode's rules during the session ({detail}), so the session was stopped.",
    opencode_auth_required:
      "OpenCode has no login for this provider: run opencode auth login on the host.",
    opencode_disabled: "OpenCode is turned off in this host's config.",
    opencode_missing: "OpenCode is not installed on this host.",
    opencode_version_failed: "OpenCode did not tell its version.",
    opencode_v1: "This host has OpenCode 1; Flightdeck needs OpenCode 2.",
    opencode_project_config_not_disabled:
      "OpenCode {version} did not turn the project config off, so Flightdeck cannot use it safely.",
    opencode_canary_failed: "OpenCode could not be checked on this host.",
    opencode_scope_mismatch:
      "OpenCode reads its global config from another folder than the one Flightdeck checked.",
    session_ended: "The session is not running (it ended or failed): resume it to send a message.",
    session_not_ended: "The session is still running: there is nothing to resume.",
    personas_off: "Personas are not available on this host.",
    session_not_running: "The session has no running process: resume it first.",
    mcp_set_not_live: "The session is not running, so its MCP servers cannot be changed.",
    mcp_query_not_live: "The session is not running, so its MCP servers cannot be queried.",
    external_no_channel:
      "This session has no channel: only sessions opened with flightdeckd claude receive messages.",
    bypass_not_allowed:
      "This host does not allow sessions without permission prompts. Turn it on in the host's settings first.",
    bypass_confirm: "Turning on sessions without permission prompts needs your confirmation.",
    card_scope_unknown:
      "This session does not run in a project of this host, so it cannot manage cards.",
    card_id_needed: "This session is not in a card: name which card.",
    card_other_project: "That card belongs to another project than this session's.",
    card_manage_args: "That card action is missing something it needs.",
    transcript_not_indexed: "The transcript {id} is not indexed on this host.",
    session_maybe_active:
      "The session may be in use elsewhere: resume it anyway only if you are sure it is not.",
  },
  assistantRefusal: {
    assistant_not_configured: "Choose an AI provider in Settings, Assistant, first.",
    assistant_empty_input: "Write something first.",
    assistant_too_long: "The text is too long for the assistant (at most {max} characters).",
    assistant_secret_found:
      "Nothing was sent: the text looks like it holds a secret ({labels}). Remove it and try again.",
    assistant_vault_value:
      "Nothing was sent: the text holds the value of a vault secret ({names}). Remove it and try again.",
    assistant_quota_blocked:
      "The host's Claude plan is at its limit until {until}. Try again then, or choose another provider.",
    assistant_host_unavailable: "Claude Code on the host cannot answer: {detail}",
    assistant_auth: "The provider refused the key. Check it in Settings, Assistant.",
    assistant_credits: "The provider says there is no credit left on this key.",
    assistant_rate_limited: "Too many requests right now. Wait a moment and try again.",
    assistant_repo_other_host:
      "The assistant host is not this card's host and cannot read its repository. Choose the card's host or an API key.",
    assistant_overloaded: "The provider is overloaded. Try again in a moment.",
    assistant_routing_unavailable:
      "No provider of this model on OpenRouter takes the request without collecting data. Turn off the data switch in Settings, or pick another model.",
    assistant_model_unavailable:
      "The provider does not offer this model. Pick another one in Settings.",
    assistant_truncated:
      "The answer was cut short before it ended. Try again, or use a shorter text.",
    assistant_refused: "The model declined to answer this text.",
    assistant_bad_output: "The model gave an answer that cannot be used. Try again.",
    assistant_placeholders_changed:
      "The suggestion changed the snippet's variables, so it is not offered. Try again.",
    assistant_timeout: "The provider took too long to answer.",
    assistant_cancelled: "Cancelled.",
    assistant_offline: "The provider cannot be reached. Check the connection.",
    assistant_no_changes: "There are no changes to describe.",
    assistant_not_a_repo: "This folder is not a git repository.",
    assistant_request_id: "Request id: {id}",
    assistant_key_invalid: "That is not a usable key: {why}.",
    assistant_key_store:
      "The system's credential store could not be reached. Try again, or check that it is unlocked.",
  },
  snippetRefusal: {
    name_invalid: "Name must be 1 to 64 characters: letters, numbers, space, . _ -",
    needs_run: "A command needs something to run.",
    needs_text: "A prompt needs text.",
    no_text: "A command has no text: use the command field only.",
    no_run: "A prompt has no command: use the text field only.",
    too_big: "The snippet is too big.",
    control_command: "A command is one line, without control characters.",
    control_prompt: "The text has control characters.",
    var_name:
      "{name} is not a valid variable name: use letters, digits and _, and do not start with a digit.",
    var_special: "{name} is a special variable: it comes from the context, so do not declare it.",
    var_unused: "The variable {name} is not used in the text.",
    too_many_tags: "At most {max} tags.",
    tag_invalid: "A tag is invalid: up to 30 characters, no commas.",
    too_many_options: "Too many options in {name}.",
    options_plain: "The options of {name} are plain text, without repeats.",
    default_control: "The default of {name} has control characters.",
    default_not_option: "The default of {name} must be one of its options.",
    value_control: "The value of {name} has a line break or control characters.",
    value_not_option: "{name}: the value is outside the options ({options}).",
    missing_values: "Missing values: {names}.",
    name_taken: "A snippet named {name} already exists.",
    not_found: "That snippet was not found.",
    secret: "The snippet has a secret ({kinds}): keep it in the vault, or turn it into an action.",
  },
};

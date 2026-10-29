# Flightdeck — Spec da Fase 15 (Hosts SSH)

## Objetivo e escopo

O usuário usa um cliente SSH com cofre, no estilo do Termius, para os servidores do dia a dia. A Fase 15 traz isso para o Flightdeck: **destinos SSH** cadastrados no app, abertos numa aba de terminal (Fase 14), inclusive em máquinas **sem o daemon do Flightdeck**.

Pré-requisito: Fase 14 (abas e terminal embutido). As chaves e senhas ficam no cofre da Fase 16. Esta fase usa só a referência a elas, e funciona sem o cofre com o `~/.ssh` do próprio host.

**Fora da Fase 15**

- Cliente SSH próprio. O Flightdeck usa o `ssh` do OpenSSH do host.
- SFTP e transferência de arquivos pela interface.
- Port forwarding pela interface. Ele continua possível pelas opções do destino, numa versão futura.
- Sincronizar entre dispositivos: o produto é desktop. O backup cifrado fica na Fase 16.

## Fatos levantados pelo orquestrador (29/10/2026)

- **OpenSSH:** o Windows do usuário tem o OpenSSH 10.6 (`ssh`, `ssh-keygen` e `ssh-agent`). No Linux ele é padrão.
- **Ponto de partida:** o usuário tem um `~/.ssh/config` com 10 hosts e uma chave `id_ed25519`. Importar o `~/.ssh/config` é o caminho natural de entrada.

## Design

### Destino SSH

- **Tabela:**
  ```sql
  CREATE TABLE ssh_targets (id TEXT PRIMARY KEY, name TEXT, host TEXT, port INTEGER, user TEXT,
                            via_host TEXT, auth TEXT, secret_ref TEXT, jump TEXT, options TEXT,
                            tags TEXT, host_key TEXT, created_at TEXT, updated_at TEXT);
  ```
- **Campos:**
  - `via_host`: o host do Flightdeck que abre a conexão. O padrão é o host local; pode ser, por exemplo, a VPS, para alcançar uma rede interna dela.
  - `auth`:
    - `agent`, o ssh-agent do host;
    - `key-file`, uma chave no disco do host, pelo caminho;
    - `vault-key`, uma chave do cofre (Fase 16);
    - `password`, uma senha do cofre ou digitada.
  - `jump`: o `ProxyJump`, apontando para outro destino.
  - `options`: uma lista curta e fixa do OpenSSH: `ServerAliveInterval`, `Compression`, `LocalForward` só como texto, e `ForwardAgent`, que é desligado por padrão e pede confirmação para ligar.
  - `tags`: para filtrar e agrupar, por exemplo "prod", "staging" ou "cliente X".
- **Onde fica:** o cadastro vive no daemon do host local (o do PC), e só a referência do segredo é guardada. Nenhum segredo fica na tabela.

### Importar do `~/.ssh/config`

- **"Importar do SSH config"** lê o arquivo do host escolhido, **só para leitura**: `Host`, `HostName`, `User`, `Port`, `IdentityFile`, `ProxyJump` e os `Include`.
- **Prévia:** mostra os destinos que seriam criados, com os já existentes marcados. Você escolhe quais entram.
- **Curingas:** entradas com `*` ou `?` não viram destino. Os valores delas são aplicados como padrão aos destinos que casam.
- **Sem escrita:** nada é escrito no `~/.ssh/config`.

### Abrir

- **"Conectar":** abre uma aba de terminal (Fase 14) no `via_host` com `ssh` e os argumentos montados em lista:
  ```
  ssh -o BatchMode=no -o IdentitiesOnly=yes [-i <chave>] [-J <jump>] -p <porta> <user>@<host>
  ```
  Nada passa por shell.
- **Chave do cofre (`vault-key`):** o app entrega a chave ao daemon do `via_host` só no momento da conexão (Fase 16).
  - O daemon a grava num arquivo temporário com permissão só do dono (ACL no Windows, 0600 fora dele), passa o caminho em `-i` e **apaga o arquivo assim que a autenticação termina**, ou em 60 s no máximo.
  - Se a chave tiver senha, ela é pedida pelo `SSH_ASKPASS` (abaixo).
- **Senha (`password`):** vai pelo `SSH_ASKPASS`, que aponta para `flightdeckd askpass`.
  - Esse helper pede a senha ao app pelo daemon, e o app a lê do cofre, ou pergunta a você se ela não estiver lá.
  - A senha nunca aparece na linha de comando nem no ambiente do ssh.
- **Chave do servidor:**
  - na primeira conexão, o fingerprint (SHA256) aparece no app para você confirmar e fica guardado em `host_key`;
  - nas seguintes, a conexão usa um `known_hosts` próprio do Flightdeck, gerado a partir de `host_key`, com `StrictHostKeyChecking=yes`;
  - um fingerprint diferente bloqueia a conexão e mostra o antigo e o novo.
- **"Claude aqui" via SSH:** se o destino também tiver o `flightdeckd`, o app oferece pareá-lo como host. Para os outros, o "Claude aqui" roda o `claude` direto pelo terminal SSH. Essa sessão não fica controlável, porque o host remoto não tem daemon, e o app avisa.

### App

- **Tela "Conexões"** no menu lateral:
  - lista e busca dos destinos, com filtro por tag e por `via_host`;
  - por destino: Conectar, Editar, Duplicar e Remover (com confirmação);
  - na paleta Ctrl+K: "Conectar a <nome>".
- **Formulário do destino:**
  - autenticação com seletor de segredo do cofre;
  - fingerprint guardado, com "Esquecer chave do servidor";
  - teste de conexão (`ssh -o BatchMode=yes … exit 0`), que mostra o erro do ssh traduzido.
- **Aba do terminal SSH:** traz o selo do destino e da tag. As tags `prod` e `produção` deixam a aba com borda vermelha.

## Protocolo (só adições)

| Item | Tipo | Conteúdo |
| --- | --- | --- |
| `ssh.list` / `ssh.save` / `ssh.remove` | comando | destinos; `remove` com `confirm` |
| `ssh.import.preview` / `ssh.import.apply` | comando | `host`; prévia e aplicação do `~/.ssh/config` |
| `ssh.connect` | comando | `targetId`; devolve o `terminalId` (Fase 14) |
| `ssh.test` | comando | `targetId`; ok ou erro traduzido |
| `ssh.hostkey.confirm` / `ssh.hostkey.forget` | comando | fingerprint |
| `askpass.request` / `askpass.answer` | frame / comando | pedido de senha do helper e a resposta do app |

## Testes e critérios

| Área | O que precisa passar |
| --- | --- |
| `ssh-destinos` | salvar, listar, remover com confirmação; tags; jump aponta para destino existente; nenhum segredo na tabela |
| `ssh-import` | lê `Host`, `HostName`, `User`, `Port`, `IdentityFile`, `ProxyJump` e `Include` de fixtures; curingas viram padrão; prévia marca os existentes; nada é escrito no config |
| `ssh-connect` | argv montado em lista para cada `auth` (ssh falso); chave temporária com permissão do dono e apagada depois da autenticação ou em 60 s; `IdentitiesOnly`; known_hosts próprio com `StrictHostKeyChecking=yes` |
| `ssh-hostkey` | primeira conexão pede confirmação; diferente bloqueia mostrando os dois; esquecer limpa |
| `askpass` | `flightdeckd askpass` pede ao app e devolve a senha pelo stdout; sem app, falha rápido; a senha nunca aparece em argv nem no ambiente |
| `conexoes-ui` | tela, formulário, teste traduzido, paleta "Conectar a…", borda vermelha em `prod` |

**Smoke (`bun run smoke:ssh`)**

- Usa um `ssh` falso no PATH, que registra o argv, imprime o fingerprint e exige o arquivo de chave.
- Importa um config de fixture, conecta com `vault-key`, confirma o fingerprint e confere que a chave temporária sumiu.
- Uma conexão com fingerprint diferente é bloqueada.
- Imprime `SMOKE SSH OK`.

**Critérios de aceite:**
- [ ] Os de sempre: TDD por área, auditoria, cobertura de 100%, todos os smokes, builds, CI verde, prints, versões em `0.15.0`, README e DECISIONS.
- [ ] Conferência real com o usuário: importar o `~/.ssh/config` dele, conectar a um destino real e confirmar o fingerprint.

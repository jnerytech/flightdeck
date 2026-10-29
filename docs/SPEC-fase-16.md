# Flightdeck — Spec da Fase 16 (Cofre de segredos)

## Objetivo e escopo

Um **cofre** para os segredos do dia a dia: chaves SSH, tokens de API, senhas e variáveis de ambiente de deploy. Eles ficam no **cofre do sistema operacional** do PC do usuário, onde o app já guarda os tokens dos hosts, e nunca em arquivo nem no banco.

As Fases 15, 17 e 19 usam o cofre: para conectar, para o Claude usar um segredo sem vê-lo, e para as regras de uso.

Pré-requisito: Fase 10 (Interface). Independe das Fases 11 a 15.

**Fora da Fase 16**

- Sincronizar o cofre entre dispositivos e compartilhar segredos com outras pessoas. O backup cifrado cobre a cópia de segurança.
- Gerenciadores de senha externos (1Password, Bitwarden), que podem ser uma fonte numa versão futura.
- Gerar certificados. Gerar chaves SSH entra.

## Onde os segredos vivem

- **Valor:** no **cofre do sistema** da máquina onde o app roda, pela casca Rust (crate `keyring`, que o app já usa):
  - Windows: Credential Manager;
  - Linux: Secret Service;
  - macOS: Keychain.
  - O nome de serviço é `flightdeck-vault` e a conta é o id do segredo.
- **Metadados:** no armazenamento do app, sem o valor: id, nome, tipo, descrição, tags, criação, último uso, fingerprint público quando houver e para quais hosts o segredo pode ser entregue.
- **Entrega a um daemon:** o valor sai do cofre só no momento do uso, pelo WebSocket autenticado do host, que é loopback ou Tailscale (WireGuard), numa mensagem `vault.deliver` com prazo de uso.
  - O daemon guarda o valor só em memória e o descarta depois do uso, ou em no máximo 60 s.
  - O valor nunca vai para disco nem para log, com uma exceção: o arquivo temporário de chave SSH da Fase 15, que é apagado.
- **Consequência:** sem o app aberto, nenhum segredo do cofre pode ser usado, e o pedido falha dizendo isso. Fica registrado como decisão: o cofre é do usuário, na máquina dele.

## Tipos de segredo

| Tipo | Valor | Extras |
| --- | --- | --- |
| `ssh-key` | chave privada OpenSSH, com senha opcional, também guardada | fingerprint e chave pública visíveis; "Copiar chave pública" |
| `password` | senha | — |
| `token` | token de API | prefixo visível, por exemplo `ghp_…abcd`, para reconhecer |
| `env` | conjunto `NOME=valor` | os nomes visíveis e os valores ocultos |

- **Gerar chave SSH:** cria um par `ed25519` com o `ssh-keygen` do host local, guarda o privado no cofre, apaga o arquivo e mostra a chave pública para copiar.
- **Importar chave do disco:** "Importar arquivo de chave" lê um arquivo que você escolhe pelo diálogo do sistema e oferece apagar o original. O padrão é não apagar.

## Uso e auditoria

- **Registro de uso:** cada entrega gera uma linha no `vault_usage` do app, com segredo, host, finalidade (ssh, ação da Fase 17 ou snippet), quem pediu (você, uma sessão ou uma automação) e hora. **O valor nunca entra.**
- **Hosts permitidos:** cada segredo tem a lista de hosts para os quais pode ser entregue. O padrão é só o host local. Entregar para um host fora da lista é recusado.
- **"Revelar":** mostra o valor por 10 s, só depois de uma confirmação do Windows Hello ou da senha do sistema, quando disponível. Sem isso, pede para digitar "revelar". "Copiar" limpa a área de transferência depois de 30 s.

## Backup cifrado

- **"Exportar cofre":** gera um arquivo `.fdvault`, com os metadados e os valores cifrados por uma frase-senha sua.
  - Formato: `age` com passphrase (scrypt), pelo pacote `age-encryption` em JS.
  - A frase-senha precisa ter pelo menos 12 caracteres e é confirmada duas vezes.
- **"Importar cofre":** lê um `.fdvault` com a frase-senha, mostra uma prévia (novos, iguais e conflitantes) e aplica.

## Protocolo e plataforma

- O cofre é do app. A plataforma ganha `vault.get(id)`, `vault.set(id, value)` e `vault.delete(id)` na casca Rust, mais o diálogo de importar e exportar.
- **Protocolo (só adições):**

  | Item | Tipo | Conteúdo |
  | --- | --- | --- |
  | `vault.deliver` | comando app → daemon | `{ secretId, value, purpose, expiresAt }`; o daemon confirma o recebimento e guarda só em memória |
  | `vault.request` | frame daemon → app | um uso que precisa de um segredo (Fases 15, 17 e 18); o app decide e entrega |
  | `vault.used` | comando daemon → app | confirma o uso, para o registro |

## App

- **Tela "Cofre":**
  - lista com tipo, nome, tags, último uso e hosts permitidos;
  - criar, editar, gerar chave SSH, importar arquivo, revelar e copiar;
  - remover, com confirmação que digita o nome;
  - aba "Uso", com o registro e filtros;
  - Exportar e Importar.
- **Seletor de segredo:** usado nas Fases 15, 17 e 18, com filtro por tipo.

## Testes e critérios

| Área | O que precisa passar |
| --- | --- |
| `cofre-armazenamento` | valor só no keyring (plataforma falsa); metadados sem valor; remover apaga dos dois |
| `cofre-tipos` | os quatro tipos; fingerprint e pública de `ssh-key`; prefixo de `token`; nomes de `env` |
| `cofre-gerar-importar` | `ssh-keygen` falso gera e o arquivo some; importar arquivo com opção de apagar |
| `cofre-entrega` | `vault.deliver` só para host permitido; o daemon guarda em memória e descarta no uso ou em 60 s; nunca em log (o teste procura o valor nos logs e no banco); sem app, o pedido falha com o motivo |
| `cofre-uso` | registro de cada entrega com finalidade e solicitante e sem valor; filtros |
| `cofre-backup` | exportar e importar com `age` e frase-senha; frase curta recusada; prévia de conflitos; arquivo adulterado recusado |
| `cofre-ui` | tela, revelar com confirmação e prazo, copiar com limpeza, remover digitando o nome |

**Travas:**
- O keyring real nunca é usado nos testes; a plataforma falsa guarda em memória.
- Um teste varre os logs, o banco e as saídas dos smokes atrás dos valores de teste, e reprova se encontrar algum.

**Smoke (`bun run smoke:vault`)**

- Um app de teste com cofre em memória entrega um `token` a um daemon `--runtime fake`, que o usa numa ação de eco.
- O valor some da memória dentro do prazo.
- Os logs e o banco não contêm o valor.
- Imprime `SMOKE VAULT OK`.

**Critérios de aceite:**
- [ ] Os de sempre: TDD por área, auditoria, cobertura de 100%, todos os smokes, builds, CI verde, prints, versões em `0.16.0`, README e DECISIONS.
- [ ] Conferência real com o usuário, no app instalado: gerar uma chave SSH, copiar a pública, exportar e importar o cofre.

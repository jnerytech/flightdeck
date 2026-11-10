# Resumo da sessão e webhooks

[Voltar ao manual](../pt-BR.md) · [English](../en/session-summary-and-webhooks.md)

A página de uma sessão de terminal mostra um **resumo** curto, e o app pode mandar uma mensagem ao
**Slack, ao Discord ou a qualquer endereço HTTPS** quando algo precisar de você.

## O resumo

- O host monta do transcript da sessão, **sem chamar modelo**, então não custa nada: o que foi
  **pedido** (seu primeiro pedido de verdade), o que foi **feito** (o último texto do Claude), os
  **arquivos** que ele editou ou escreveu (no máximo 12, depois "e mais N"), o **custo** (do uso que
  o host já indexou) e a **pergunta em aberto** quando há um pedido esperando.
- Cada campo é cortado num tamanho fixo. Um campo que tenha um segredo (um token, uma chave, uma
  senha digitada na linha, um valor do cofre) é trocado por `[secret hidden]`, no app e em toda
  mensagem.
- **Copiar resumo** põe as linhas na área de transferência. Um host sem o recurso não mostra o painel.
- É um cartão no cabeçalho da sessão: **aberto na primeira vez** que você vê a sessão, depois
  **recolhido numa linha** (o texto do que foi feito, cortado) até você abrir com a seta. Empurra a conversa para baixo e nunca passa por cima dela.
- Aparece nas sessões de terminal e nas que o Flightdeck inicia (depois que o Claude Code dá nome à sessão).

## Webhooks

Abra **Configurações → Webhooks**.

- **Adicionar um webhook:** um nome, um tipo, o endereço, os hosts e os eventos.
  - **Slack:** um incoming webhook (`https://hooks.slack.com/services/...`).
  - **Discord:** um webhook de canal (`https://discord.com/api/webhooks/...`). O título de uma
    sessão não marca ninguém.
  - **JSON genérico:** seu próprio endereço, com um **segredo de assinatura**.
  - **ntfy (avisos no celular):** o endereço de um tópico (`https://ntfy.sh/seu-topico`, ou o do
    seu servidor) e, para um tópico protegido, um **token de acesso** (`tk_...`), guardado no
    cofre. Instale o app do ntfy no celular e assine o mesmo tópico. *Precisa de você* chega com
    prioridade alta, o resto com a padrão. Os avisos vão num sentido só: tocar neles não abre nada
    no Flightdeck. O servidor precisa estar acessível pela internet; um que só existe na sua rede
    de casa é recusado, como para todo webhook. Escolha um nome de tópico difícil de adivinhar, ou
    proteja-o com um token: quem souber um tópico público consegue lê-lo.
- **Eventos:** *precisa de você* (uma permissão ou uma pergunta), *sessão terminou*, *sessão
  falhou*, *alerta de orçamento* e *vigia do PR* (um PR vigiado precisa de você). Cada webhook
  escolhe os que quer.
- **Hosts:** *todos os hosts* ou um. Um evento de um host vai aos webhooks de todos os hosts e aos
  desse host.
- **O endereço é um segredo.** Fica no cofre, nunca nas configurações, num log, numa exportação ou
  num print. A lista mostra só o host para onde envia (`hooks.slack.com`). Em *Editar*, deixar o
  campo do endereço vazio mantém o atual. Remover um webhook apaga o segredo dele.
- **Testar** envia uma mensagem de exemplo uma vez e mostra o status HTTP e a hora, nunca o corpo da
  resposta. Um teste bom também dá um recomeço a um webhook parado.
- **Só com o app aberto.** Quem envia é o app, porque o cofre é do app. Com o app fechado nada é
  enviado, e a tela avisa. Também é preciso um host online: o app entrega o endereço a ele só para
  aquele envio, pelo transporte do cofre (loopback ou Tailscale), e o host nunca o guarda nem o
  registra.

**Como envia.** Uma mensagem por vez por webhook, no máximo uma por segundo. Vários eventos do mesmo
tipo que esperam juntos viram uma mensagem ("3 × precisa de você"). Um erro de rede, um tempo
esgotado, um `5xx` ou um `429` é tentado de novo após 2 s, 8 s e 32 s (mais, se o destino mandou
`Retry-After`), até quatro tentativas. Qualquer outro `4xx` ou um redirecionamento para o webhook na
hora e o marca como *falhando*, com o status: conserte o endereço, ou use Testar ou Editar, para
recomeçar. No máximo 100 mensagens esperam por webhook; as mais antigas são descartadas.

**O que o host recusa.** O host só envia para endereços `https://` (`http://` só para `localhost`,
`127.0.0.1` ou `[::1]`), sem usuário e senha no endereço, sem seguir redirecionamento, com limite de
10 segundos, e **nunca para um endereço privado, de loopback, link-local, compartilhado (100.64/10)
ou reservado** depois de resolver o nome. Um pedido assim conta como falha permanente (aparece como
HTTP 400). Só saem os cabeçalhos `Content-Type` e `X-Flightdeck-*`, e o corpo tem no máximo 100 KB.
Um limite: o nome é verificado e depois conectado; um destino que muda a resposta do DNS entre uma
coisa e outra não é pego.

**A mensagem genérica.** Um `POST` de JSON: `id`, `kind`, `host`, `project`, `title`, `at`, `detail`
e `summary`. Os cabeçalhos trazem o evento (`X-Flightdeck-Event`), um id único para ignorar
repetições (`X-Flightdeck-Delivery`), a hora em segundos Unix (`X-Flightdeck-Timestamp`) e a
assinatura `X-Flightdeck-Signature: sha256=<hex>`, o HMAC-SHA256 de `<hora>.<corpo>` com o seu
segredo. Para verificar: recalcule a partir do corpo bruto, compare em tempo constante e recuse uma
hora com mais de cinco minutos (assim uma mensagem capturada não pode ser repetida).

```js
const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
const ok = fresh && timingSafeEqual(Buffer.from(signature), Buffer.from(`sha256=${expected}`));
```

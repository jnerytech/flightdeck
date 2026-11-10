# Pareamento

[Voltar ao manual](../pt-BR.md) · [English](../en/pairing.md)

```sh
flightdeckd pair            # imprime flightdeck://<ip>:<porta>?name=…&token=… e o QR
flightdeckd pair --rotate   # gera token novo; o daemon em execução derruba quem usava o antigo
```

O endereço é o que o daemon escuta: o `bind`, ou o IP da Tailscale (`tailscale ip -4`) quando o
daemon escuta em todas as interfaces. Um daemon no loopback recebe um link `127.0.0.1` e uma
dica de como abri-lo para a Tailscale, porque um link com o IP da Tailscale não conectaria. No app, cole o
link em **Adicionar host** ou abra-o direto (`flightdeck://` está registrado no sistema); o app
preenche o formulário, testa a conexão com `hello` e `host.info` e só salva depois que você
confirma.

# Instalação

[Voltar ao manual](../pt-BR.md) · [English](../en/installation.md)

## Pelos binários da release

Cada versão sai na página de [Releases](https://github.com/jnerytech/flightdeck/releases) com:

| Arquivo | O que é |
| --- | --- |
| `Flightdeck_<versão>_x64-setup.exe` | instalador do app desktop para Windows (NSIS) |
| `Flightdeck_<versão>_x64_en-US.msi` | o mesmo app, em MSI |
| `flightdeckd-windows-x64.exe` | daemon para Windows |
| `flightdeckd-linux-x64` | daemon para Linux e WSL (x64) |
| `flightdeckd-linux-arm64` | daemon para Linux arm64 (Orange Pi, Raspberry Pi) |
| `SHA256SUMS` | o SHA-256 de cada arquivo |

A release traz também as assinaturas (`.sig`) do instalador NSIS e dos daemons e os manifestos
`latest.json` e `daemon-latest.json`, usados pela [atualização automática](host-operations.md#atualização-automática-assinada).

1. **Confira o download** antes de executar:
   - Linux: `sha256sum -c SHA256SUMS --ignore-missing`.
   - Windows (PowerShell): `(Get-FileHash .\<arquivo>).Hash.ToLower()`, e compare com a linha do
     arquivo no `SHA256SUMS`.
2. **App:** rode o instalador. Ele **não tem assinatura de código do Windows (Authenticode)**, então
   o SmartScreen mostra "O Windows protegeu o computador". Com o hash conferido, clique em **Mais
   informações** e depois em **Executar assim mesmo**. (A assinatura minisign das atualizações é
   outra coisa: veja [Atualização automática assinada](host-operations.md#atualização-automática-assinada).)
3. **Daemon:** em cada host, com o Claude Code instalado e logado:
   - no Linux, `chmod +x` no binário antes de usar;
   - rode `<binário> setup` (no Windows, `.\flightdeckd-windows-x64.exe setup` na pasta do
     download, depois do `Unblock-File` se o Windows bloquear; em seguida `flightdeckd` funciona
     em um novo terminal): ele copia o binário para `~/.flightdeck/bin`, pergunta as pastas
     dos projetos, instala e **inicia** o serviço e imprime o link de pareamento (veja
     [Primeira execução: flightdeckd setup](service.md#primeira-execução-flightdeckd-setup)).

## A partir do código-fonte

Pré-requisitos:

- [Bun](https://bun.sh) 1.4 ou mais novo.
- O Claude Code (`claude`) instalado e logado na máquina que roda o daemon. O daemon usa a
  assinatura do próprio host e nunca repassa `ANTHROPIC_API_KEY` ao Claude, a não ser que
  `allowApiKey` esteja ligado.
- Só para o app desktop: Rust estável e os
  [pré-requisitos do Tauri 2](https://v2.tauri.app/start/prerequisites/). No Windows isso inclui
  o MSVC Build Tools e o WebView2.

```sh
bun install
```

O app desktop, em desenvolvimento ou como instalável:

```sh
cd apps/desktop
bun run tauri dev      # desenvolvimento
bun run tauri build    # instalável
```

# Visão geral

[Voltar ao manual](../pt-BR.md) · [English](../en/overview.md)

O Flightdeck é uma central de comando pessoal para o Claude Code. O daemon `flightdeckd` hospeda
sessões do Claude Code pelo Agent SDK oficial, guarda cada evento em SQLite e expõe um protocolo
WebSocket. O app desktop (Tauri 2 + React) conecta em um ou mais daemons, mostra o chat em
streaming, aprova ou nega ferramentas e reúne, num lugar só, as sessões de todos os hosts.

```text
packages/protocol   schemas zod + tipos de comandos e eventos (compartilhado)
apps/daemon         flightdeckd (Bun + TypeScript)
apps/desktop        app Tauri 2 + React
scripts/            smoke, build dos binários e verificação de cobertura
```

Cada fase entregue tem a sua spec (`docs/SPEC-fase-<n>.md`); a Fase 1 e o roadmap estão em
[`docs/SPEC.md`](../../SPEC.md). As primeiras: Fase 2, multi-host
([`SPEC-fase-2.md`](../../SPEC-fase-2.md)); Fase 3, histórico ([`SPEC-fase-3.md`](../../SPEC-fase-3.md));
Fase 4, board ([`SPEC-fase-4.md`](../../SPEC-fase-4.md)); Fase 5, central de sessões
([`SPEC-fase-5.md`](../../SPEC-fase-5.md)); Fase 6, workflows ([`SPEC-fase-6.md`](../../SPEC-fase-6.md)).

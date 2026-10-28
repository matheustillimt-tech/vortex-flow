# CLAUDE.md — Vórtex Flow

Guia para o Claude Code mexer neste template. Fale com a pessoa em português simples: ela é dona de
negócio, não programadora.

## O que é

Sistema de gestão de uma empresa: projetos com quadro de tarefas (Kanban), tarefas com checklist,
anexos e prazos, cofre de senhas das ferramentas (criptografadas), chat interno, cadastro de
colaboradores, perfis de permissão, notificações, e-mail (Resend), avisos no WhatsApp (Vórtex CRM, Z-API ou webhook) e
conector MCP para o Claude. **Uma instalação = uma empresa** (um projeto Supabase + um projeto Vercel).

Stack: Next.js 14 (App Router) + TypeScript + Tailwind, Supabase (Postgres, Auth com 2FA, Storage,
Realtime, pg_net, Vault), Vitest + PGlite nos testes.

## Onde está cada coisa

| Caminho | O que tem |
|---|---|
| `app/(app)/` | Telas depois do login (dashboard, projetos, tarefas, ferramentas, chat, colaboradores, configurações...) |
| `app/api/` | Rotas do servidor. `usuarios/` (convite, reset, 2FA), `admin/` (perfis, acessos, webhook), `tools/` (cofre), `mcp/[token]` (conector), `webhooks/despachar` (chamado pelo banco) |
| `components/` | Peças das telas, por área |
| `lib/permissions.ts` | Catálogo de permissões (menus e ações); `lib/permissions-server.ts` aplica no servidor |
| `lib/brand.ts` | Nome do sistema (`NEXT_PUBLIC_APP_NAME`) |
| `lib/app-url.ts` | Endereço público usado em e-mails e no webhook |
| `lib/email.ts` | Envio e modelos de e-mail |
| `lib/crypto.ts` | Criptografia das senhas das ferramentas e do token do webhook (`TOOLS_ENC_KEY`) |
| `lib/webhooks/` | Montagem, envio e fila dos avisos no WhatsApp; `canais/` tem os 3 canais (Vórtex CRM, Z-API, webhook) |
| `lib/avisos/template.ts` | Eventos dos avisos, textos padrão e os campos `{nome}`, `{tarefa}`... |
| `lib/mcp/` | Ferramentas e autenticação do Conector do Claude |
| `lib/supabase/` | Clientes do Supabase (navegador, servidor, admin) e o middleware de login/2FA |
| `supabase/migrations/` | Banco inteiro, em ordem (`000_schema_base.sql` → `051_...`) |
| `supabase/seed.sql` | Setores de exemplo (opcional) |
| `tests/` | Testes (Vitest). Os `*-db.test.ts` rodam o SQL das migrações num Postgres em memória (PGlite) |

## Como rodar

```bash
npm install
cp .env.example .env.local   # preencher (ver INSTALACAO.md)
npm run dev                   # http://localhost:3000
npm test                      # testes (não precisam de internet nem de banco)
npm run typecheck
npm run build                 # exige NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Em máquina com pouca memória: `npx vitest run --maxWorkers=1 --no-file-parallelism`.

## Personalizar marca e textos

- Nome: variável `NEXT_PUBLIC_APP_NAME` (não precisa mexer no código).
- Cores: tokens `brand` em `tailwind.config.ts` e `app/globals.css`.
- Logo: SVG em `components/layout/sidebar.tsx` e nas páginas `app/login`, `app/forgot-password`,
  `app/auth/reset-password`. Modelo do e-mail em `lib/email.ts`.
- Colunas padrão do quadro de um projeto novo: gatilho criado nas migrações `023`/`025` (mude com uma migração nova) e
  `lib/mcp/tools.ts` (criar_projeto).
- Textos das telas ficam direto nos componentes, em português.

## Regras

- **Nunca** versionar `.env`, `.env.local` ou qualquer chave. Só o `.env.example` (com marcadores).
- **Nunca** pedir para a pessoa colar chave ou senha no chat: abra o `.env.local` para ela ou use
  `vercel env add` / `supabase secrets set` no terminal.
- **Migração nova sempre no fim da fila**, seguindo a numeração: `052_nome.sql`, `053_...`.
  Nunca edite uma migração que já foi aplicada no banco; crie outra que corrija. Não use
  `supabase migration new` (ele cria nomes com data, que bagunçam a ordem com os números).
  Aplique com `supabase db push`.
- Toda variável nova lida no código (`process.env.X`) entra no `.env.example` com comentário. As
  variáveis de `tests/env.test.ts` devem ser lidas com `cleanEnv(process.env.X)`.
- Regra nova de acesso: proteja no banco (RLS) **e** na rota (`requirePermission`), e cubra com teste.
- Antes de entregar: `npm test`, `npm run typecheck` e `npm run build`.
- Se a Vercel estiver ligada ao repositório, **todo push na `main` publica em produção**. Use outra
  branch para testar (a Vercel cria um endereço de prévia).

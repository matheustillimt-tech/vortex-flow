# Vórtex Flow

Sistema para organizar a operação da sua empresa: projetos, tarefas em quadro, cofre com as senhas
das ferramentas da equipe, chat interno e avisos no WhatsApp (tarefa nova, prazo, atraso e comentário).

> **Cada instalação é de uma empresa só.** Você cria um projeto no Supabase e um na Vercel para a
> sua empresa. Para atender outra empresa, faça outra instalação, com outro banco.

## O que ele faz

- **Projetos** com quadro de tarefas (estilo Kanban: colunas como "Demandas", "Em andamento",
  "Em revisão", "Concluídas"), também em lista; funis e produtos por projeto.
- **Tarefas** com responsáveis, prazo (com ou sem hora), prioridade, checklist, comentários, links,
  anexos (imagem e vídeo, com compressão automática), dependências e modelos de tarefa reutilizáveis.
- **Minhas tarefas** e **Todas as tarefas**, com filtros de hoje, semana, atrasadas e urgentes.
- **Dashboard** com o que está atrasado, urgente e em andamento.
- **Ferramentas da empresa**: links, logins e senhas das contas que a equipe usa. As senhas ficam
  **criptografadas** no banco; cada ferramenta pode ser liberada só para alguns setores ou pessoas, e
  toda vez que alguém vê uma senha fica registrado (quem, quando, IP e, se a pessoa permitir, local).
- **Chat interno** com canais, menção de pessoas (@) e de tarefas (#), fotos e vídeos.
- **Colaboradores**: ficha de cadastro de cada pessoa (dados, endereço com busca por CEP, Pix,
  WhatsApp e foto).
- **Setores**, **Time** e **Perfis de permissão**: você decide, menu por menu, o que cada perfil pode
  ver, criar, editar e apagar.
- **Avisos no WhatsApp**: a equipe recebe mensagem em 4 momentos, cada um você liga ou desliga:
  **tarefa nova** (na hora), **prazo chegando** (às 08:00 do dia do prazo e nos horários extras que
  você marcar dentro da tarefa), **tarefa atrasada** (todo dia às 08:00 até concluir) e **novo
  comentário** (para os responsáveis e para quem foi marcado com @Nome). O texto de cada aviso é
  editável, com campos como `{nome}`, `{tarefa}` e `{prazo}`, e a tela mostra uma prévia.
  Você escolhe por onde a mensagem sai:
  - **Vórtex CRM**: pelo WhatsApp conectado no seu Vórtex CRM (o CRM aberto do Grupo Vórtex);
  - **Z-API**: direto por uma instância sua da Z-API (serviço pago de WhatsApp por API);
  - **Webhook**: o sistema entrega os dados e o texto pronto para outra ferramenta mandar.
  Cada pessoa cadastra o próprio número no card **Seu WhatsApp para avisos**.
- **Notificações** dentro do sistema e **e-mails** (convite, código para trocar a senha, tarefa nova).
- **Segurança**: senha temporária no convite, troca obrigatória no primeiro acesso e **verificação em
  duas etapas (2FA)** obrigatória, com app autenticador (Google Authenticator, Authy etc.).
- **Conector do Claude**: cada pessoa gera um endereço pessoal e conversa com o Claude para criar,
  listar e atualizar tarefas ("cria a tarefa X no projeto Y para sexta"), comentar numa tarefa
  marcando alguém, montar o checklist, ver as tarefas atrasadas da equipe e marcar um lembrete no
  WhatsApp ("me lembra da tarefa X amanhã às 14:00"). Tudo que o Claude faz aparece no Registro de
  atividades como "Ação pelo Claude", em nome da pessoa.

## Como funciona (em poucas palavras)

O sistema é um site. As telas e as regras ficam na **Vercel** (o serviço que deixa o site no ar).
Os dados, o login e os arquivos ficam no **Supabase** (banco de dados na nuvem). O próprio banco
garante quem pode ver o quê, pelas permissões de cada perfil. Quando uma tarefa ganha um
responsável ou um comentário, o banco coloca o aviso numa fila e chama o sistema, que manda a
mensagem pelo canal escolhido e guarda o histórico de cada envio. A cada 5 minutos o próprio banco
confere prazos e atrasos e põe os lembretes na fila.

## Com o que é feito

- **Next.js 14** (React) + TypeScript + Tailwind CSS
- **Supabase**: Postgres, login (Auth) com 2FA, Storage (arquivos), Realtime (atualização ao vivo),
  `pg_net`, `pg_cron` e Vault (para os avisos no WhatsApp)
- **Resend** para e-mail (opcional)
- **MCP** (Model Context Protocol) para o Conector do Claude
- Testes com **Vitest** (inclusive testes do banco com PGlite)

## De quais contas você precisa

| Conta | Para quê | Custa? |
|---|---|---|
| **GitHub** | Guardar a sua cópia do código | Grátis |
| **Supabase** | Banco de dados, login e arquivos | Tem plano grátis (o projeto pausa após 1 semana sem uso; o plano pago evita isso) |
| **Vercel** | Deixar o sistema no ar | Plano grátis (Hobby) para testar; para uso comercial a Vercel pede o plano Pro |
| **Resend** (opcional) | Mandar e-mails | Tem plano grátis |
| Canal de WhatsApp (opcional) | Mandar os avisos: Vórtex CRM, uma instância da **Z-API** ou outra ferramenta que receba webhook | O Vórtex CRM também é código aberto, instalado por você; a Z-API cobra por instância |
| **Claude** (opcional) | Usar o Conector do Claude | Plano que aceite conectores personalizados |

## Instalar com o Claude Code

Abra o **Claude Code** (aba **Code**) numa **pasta vazia** e cole o prompt abaixo. Ele confere o que
falta no seu computador, baixa o código e te guia em cada conta, uma de cada vez.

```text
Você vai instalar o Vórtex Flow para a minha empresa, comigo, passo a passo.
O Vórtex Flow é um sistema de gestão de projetos e tarefas (Next.js + Supabase),
publicado na Vercel. Código: https://github.com/matheustillimt-tech/vortex-flow
Cada instalação é de UMA empresa: um projeto no Supabase e um projeto na Vercel só nossos.

REGRAS (siga sempre):
- Fale comigo em português simples. Eu não sou programador: explique cada termo técnico
  na primeira vez que aparecer.
- NUNCA me peça para colar chave, senha ou token aqui no chat. Quando precisar de uma chave,
  abra o arquivo .env.local para mim (comando `open .env.local` no Mac, `notepad .env.local`
  no Windows) e me diga em qual linha colar. Quando precisar levar a chave para a Vercel,
  use `vercel env add NOME production` no terminal, que pede o valor sem mostrar no chat.
- Chaves que VOCÊ gerar (como a TOOLS_ENC_KEY), grave direto no .env.local com um comando,
  sem mostrar o valor na conversa.
- Faça UMA etapa por vez. Quando eu precisar criar conta ou clicar em algo num site,
  me diga exatamente onde clicar e ESPERE eu responder "pronto" antes de seguir.
- Nunca rode comando que apague dados sem me perguntar antes.
- Siga o arquivo INSTALACAO.md do repositório como roteiro oficial.

ETAPAS:
1. Pré-requisitos: confira se tenho Node.js 20 ou mais novo, Git, a CLI do Supabase e a CLI
   da Vercel (`node -v`, `git --version`, `supabase --version`, `vercel --version`).
   Instale o que faltar (no Mac, com Homebrew; no Windows, me guie pelo instalador oficial).
2. Baixe o código nesta pasta:
   `git clone https://github.com/matheustillimt-tech/vortex-flow.git .`
   e rode `npm install`.
3. Contas, uma de cada vez, esperando eu confirmar cada uma:
   a) GitHub (para guardar a sua cópia do código);
   b) Supabase (banco de dados e login): crie um projeto novo, região São Paulo,
      e me lembre de guardar a senha do banco num lugar seguro;
   c) Vercel (onde o sistema fica no ar): entre com a conta do GitHub.
4. Banco de dados: rode `supabase login`, depois `supabase link --project-ref <ref do meu projeto>`
   (me mostre onde achar o "project ref" na URL do painel) e `supabase db push` para criar
   todas as tabelas. Confirme que terminou sem erro.
5. Variáveis: copie .env.example para .env.local. Gere a TOOLS_ENC_KEY com
   `openssl rand -base64 32` direto no arquivo. Abra o .env.local para eu colar a URL e as
   chaves do Supabase (Project Settings → API). Pergunte se eu quero e-mail (Resend) e aviso
   no WhatsApp agora ou depois.
6. Teste rápido no meu computador: `npm run dev` e me peça para abrir http://localhost:3000.
7. Minha cópia no GitHub: me ajude a criar um repositório PRIVADO na minha conta e a enviar
   o código para ele (troque o "origin" para o meu repositório).
8. Publicar: importe o meu repositório na Vercel (ou `vercel link` + `vercel --prod`),
   cadastre as variáveis com `vercel env add` e publique. Depois, no Supabase, em
   Authentication → URL Configuration, coloque o endereço da Vercel como Site URL.
9. Primeiro administrador: me guie para criar o meu usuário em Supabase → Authentication →
   Users → Add user (com "Auto Confirm User") e depois rode no SQL Editor o comando de
   promoção do INSTALACAO.md com o meu e-mail. Recomende desligar o cadastro aberto
   (Authentication → Sign In / Providers → "Allow new users to sign up").
10. Integrações opcionais (pergunte quais eu quero): e-mail pelo Resend; avisos no WhatsApp
    (siga a seção "Avisos no WhatsApp" do INSTALACAO.md: ligar as extensões pg_net e pg_cron,
    guardar webhook_app_url e webhook_dispatch_secret no Vault, cadastrar WEBHOOK_DISPATCH_SECRET
    na Vercel e publicar de novo; depois me guie em Configurações → Avisos no WhatsApp para
    escolher o canal entre Vórtex CRM, Z-API ou webhook, salvar e clicar em Mandar teste);
    Conector do Claude.
11. Rode comigo o checklist de teste do INSTALACAO.md e me entregue um resumo final:
    endereço do sistema, o que ficou ligado, o que ficou para depois e onde estão as chaves.
```

O mesmo prompt está em [PROMPT-DE-INSTALACAO.md](PROMPT-DE-INSTALACAO.md).

## Instalar na mão

O passo a passo completo, com todas as variáveis e os problemas comuns, está em
**[INSTALACAO.md](INSTALACAO.md)**.

## Personalizar

- **Nome do sistema**: variável `NEXT_PUBLIC_APP_NAME` (aparece nas telas, nos e-mails e no app de 2FA).
- **Cores**: `tailwind.config.ts` e `app/globals.css` (cor principal = tokens `brand`).
- **Logo**: o desenho fica em `components/layout/sidebar.tsx` e nas telas de `app/login`,
  `app/forgot-password` e `app/auth/reset-password`.
- **Setores de exemplo**: `supabase/seed.sql` (opcional, rode uma vez no SQL Editor).

## Cuidados

- O cadastro de colaboradores guarda **dados pessoais** (CPF, endereço, Pix, WhatsApp) e o cofre
  de ferramentas registra **IP e local** de quem abre uma senha. Avise a equipe e trate esses dados
  conforme a LGPD.
- Guarde a `TOOLS_ENC_KEY` em lugar seguro: sem ela, as senhas salvas nas Ferramentas não abrem mais.
- A chave `service_role` do Supabase dá acesso total ao banco: só na Vercel e no `.env.local`, nunca
  no código nem no chat.

## Estrutura de pastas

```
app/                 telas e rotas da API (Next.js)
  (app)/             telas depois do login: dashboard, projetos, tarefas, ferramentas, chat...
  api/               rotas do servidor: usuários, ferramentas, webhook, conector MCP...
components/          peças das telas (quadro, painel da tarefa, configurações...)
lib/                 regras: permissões, e-mail, webhook, criptografia, conector MCP
  brand.ts           nome do sistema
supabase/
  migrations/        banco de dados, em ordem (000 → 051)
  seed.sql           setores de exemplo (opcional)
tests/               testes automáticos (npm test)
```

## Comandos

```bash
npm install        # instala as dependências
npm run dev        # roda no seu computador (http://localhost:3000)
npm run build      # gera a versão de produção
npm test           # roda os testes
npm run typecheck  # confere os tipos do TypeScript
```

## Licença

MIT. Veja [LICENSE](LICENSE).

---

Feito pelo Grupo Vórtex · entregue na Plataforma Vórtex IA

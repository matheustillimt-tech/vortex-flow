# Instalação do Vórtex Flow (passo a passo manual)

Este guia instala o sistema do zero para **uma empresa**. Cada empresa tem a sua instalação:
um projeto no Supabase e um projeto na Vercel. Prefere que o Claude faça com você? Use o
[PROMPT-DE-INSTALACAO.md](PROMPT-DE-INSTALACAO.md).

Tempo estimado: 40 a 60 minutos.

---

## 1. Contas

Crie (ou entre) nestas contas, nesta ordem:

1. **GitHub**: [github.com](https://github.com). Guarda a sua cópia do código. Grátis.
2. **Supabase**: [supabase.com](https://supabase.com). Banco de dados, login e arquivos.
   Tem plano grátis (o projeto grátis pausa depois de 1 semana sem uso).
3. **Vercel**: [vercel.com](https://vercel.com). Deixa o sistema no ar. Entre com a conta do GitHub.
   O plano grátis (Hobby) serve para testar; para uso comercial a Vercel pede o plano Pro.
4. *(Opcional)* **Resend**: [resend.com](https://resend.com). Para o sistema mandar e-mails. Tem plano grátis.

E instale no seu computador:

- **Node.js 20** ou mais novo: [nodejs.org](https://nodejs.org)
- **Git**: [git-scm.com](https://git-scm.com)
- **CLI do Supabase** (programa de linha de comando): no Mac: `brew install supabase/tap/supabase`;
  no Windows: veja [o guia oficial](https://supabase.com/docs/guides/local-development/cli/getting-started)
- **CLI da Vercel**: `npm install -g vercel`

Confira com `node -v`, `git --version`, `supabase --version` e `vercel --version`.

## 2. Baixar o código

```bash
git clone https://github.com/matheustillimt-tech/vortex-flow.git
cd vortex-flow
npm install
```

## 3. Criar o banco no Supabase

1. No Supabase, clique em **New project**. Dê um nome (ex.: `flow-minha-empresa`), escolha a região
   **South America (São Paulo)** e crie uma **senha do banco** forte. Guarde essa senha.
2. Espere o projeto ficar pronto (1 a 2 minutos). O **project ref** é o código que aparece no endereço
   do painel: `supabase.com/dashboard/project/`**`SEU-PROJECT-REF`**.
3. No terminal, dentro da pasta do código:

   ```bash
   supabase login
   supabase link --project-ref SEU-PROJECT-REF
   supabase db push
   ```

   O `db push` aplica as **migrações** (os arquivos de `supabase/migrations/`, que criam as tabelas,
   as regras de acesso e os gatilhos) na ordem, de `000` até `051`. Ele pede a senha do banco.
   No fim deve aparecer `Finished supabase db push`.

   > As migrações `029` a `032` não fazem nada de propósito (só mantêm a numeração). As de
   > `008`/`026`–`028`/`034` criam a antiga área de "Processos", que a `048` remove. É normal.

4. *(Opcional)* **Setores de exemplo**: no painel do Supabase, abra **SQL Editor**, cole o conteúdo de
   `supabase/seed.sql` e clique em **Run**. Cria setores como "Comercial", "Design" e "Tráfego Pago",
   que você pode editar ou apagar depois.

5. **Login**: em **Authentication → Sign In / Providers**, desligue **"Allow new users to sign up"**.
   Assim só entra quem você convidar (o convite pelo sistema continua funcionando).
   A verificação em duas etapas (2FA por app autenticador) já vem ligada no Supabase.

Não precisa criar "buckets" de arquivos nem ligar o Realtime: as migrações já fazem isso.

## 4. Variáveis de ambiente

Variáveis de ambiente são as "configurações secretas" do sistema (endereços e chaves). Copie o modelo:

```bash
cp .env.example .env.local
openssl rand -base64 32   # gera a TOOLS_ENC_KEY: copie o resultado para o .env.local
```

Abra o `.env.local` e preencha. As chaves do Supabase ficam em **Project Settings → API Keys**
(aba **Legacy API Keys**: `anon` e `service_role`) e o endereço em **Project Settings → Data API**
(**Project URL**). Se o seu projeto só mostrar as chaves novas, use a *publishable* no lugar da
`anon` e a *secret* no lugar da `service_role`.

| Variável | Para que serve | Onde pegar | Obrigatória? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Endereço do seu banco | Supabase → Project Settings → Data API → Project URL | Sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública do banco (usada no navegador) | Supabase → Project Settings → API Keys → `anon` | Sim |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave secreta do servidor (convites, reset de senha, webhook) | Supabase → Project Settings → API Keys → `service_role` | Sim |
| `TOOLS_ENC_KEY` | Criptografa as senhas da tela Ferramentas e os tokens dos avisos no WhatsApp | Gere com `openssl rand -base64 32` (guarde uma cópia!) | Sim |
| `NEXT_PUBLIC_APP_URL` | Endereço do sistema, usado nos links de e-mail e WhatsApp | O endereço da Vercel ou o seu domínio (ex.: `https://flow.suaempresa.com.br`) | Não (na Vercel, usa o domínio de produção sozinho; recomendada com domínio próprio) |
| `APP_URL` | Alternativa antiga à de cima | (não precisa) | Não |
| `NEXT_PUBLIC_APP_NAME` | Nome que aparece nas telas, e-mails e no app de 2FA | Você escolhe (padrão: "Vórtex Flow") | Não |
| `RESEND_API_KEY` | Envio de e-mails (convite, código de senha, tarefa nova) | Resend → API Keys | Não (sem ela, não sai e-mail; o resto funciona) |
| `EMAIL_FROM` | Remetente dos e-mails | Um endereço do seu domínio verificado no Resend (ex.: `Sua Empresa <nao-responda@seu-dominio.com.br>`) | Não (sem domínio verificado, o Resend só entrega para o seu próprio e-mail) |
| `WEBHOOK_DISPATCH_SECRET` | Senha que o banco usa para chamar o sistema e disparar os avisos no WhatsApp (o mesmo valor vai no Vault como `webhook_dispatch_secret`) | Gere com `openssl rand -hex 32` | Só para os avisos no WhatsApp |

A Vercel também preenche sozinha `VERCEL_PROJECT_PRODUCTION_URL` e `VERCEL_URL`; não cadastre.

**Teste no seu computador** (opcional): `npm run dev` e abra [http://localhost:3000](http://localhost:3000).
Para entrar, faça antes o passo 6 (primeiro administrador).

## 5. Publicar na Vercel

1. **Sua cópia no GitHub**: crie um repositório **privado** vazio na sua conta (ex.: `flow-minha-empresa`) e envie o código:

   ```bash
   git remote set-url origin https://github.com/SEU-USUARIO/flow-minha-empresa.git
   git push -u origin main
   ```

2. Na Vercel: **Add New → Project → Import** o seu repositório. A Vercel reconhece o Next.js sozinha.
3. Antes de clicar em **Deploy**, abra **Environment Variables** e cadastre as variáveis da tabela acima
   (as obrigatórias e as opcionais que for usar). Pelo terminal também dá:
   `vercel env add NOME_DA_VARIAVEL production` (ele pede o valor sem mostrar).
4. Clique em **Deploy**. Ao terminar, anote o endereço (ex.: `https://flow-minha-empresa.vercel.app`).
5. No Supabase, em **Authentication → URL Configuration**, coloque esse endereço em **Site URL** e
   também em **Redirect URLs**.

Este projeto **não usa crons** (tarefas agendadas) da Vercel.
Daqui em diante, todo `git push` na `main` publica uma versão nova automaticamente.

## 6. Criar o primeiro administrador

1. No Supabase: **Authentication → Users → Add user → Create new user**. Coloque o seu e-mail e uma
   senha, marque **Auto Confirm User** e crie.
2. Abra o **SQL Editor**, cole o comando abaixo trocando o e-mail pelo seu e clique em **Run**:

   ```sql
   update public.users
   set permission_profile_id = (
         select id from public.permission_profiles where nome = 'Super Admin'
       ),
       password_changed = true
   where email = 'seu-email@exemplo.com';
   ```

   Deve aparecer `Success. 1 row affected` (se der 0, confira o e-mail).
3. Entre no sistema com esse e-mail e senha. Na primeira vez ele pede para configurar a **verificação
   em duas etapas**: leia o QR code com um app autenticador (Google Authenticator, Authy, 1Password...).
4. Em **Configurações**: crie os setores, monte os **Perfis de permissão** (o que cada função pode ver e
   fazer) e convide a equipe em **Time & Permissões → Adicionar membro**. Cada pessoa recebe uma senha
   temporária (por e-mail, se o Resend estiver ligado, e na tela para você copiar), troca no primeiro
   acesso e configura o 2FA.

## 7. Ligar as integrações

### E-mail (Resend)

1. No Resend, em **Domains**, adicione o seu domínio e siga as instruções de DNS até ficar "Verified".
2. Em **API Keys**, crie uma chave.
3. Na Vercel, cadastre `RESEND_API_KEY` e `EMAIL_FROM` e faça um novo deploy (**Deployments → Redeploy**).

### Avisos no WhatsApp

O sistema avisa a equipe no WhatsApp em 4 momentos. Cada um você liga ou desliga na tela:

| Aviso | Quem recebe | Quando |
|---|---|---|
| Nova tarefa | quem virou responsável | na hora |
| Prazo chegando | os responsáveis | às 08:00 (horário de Brasília) do dia do prazo, mais os horários extras marcados dentro da tarefa |
| Tarefa atrasada | os responsáveis; no primeiro dia, também quem criou a tarefa | todo dia às 08:00 até concluir |
| Novo comentário | os responsáveis (menos quem comentou) e quem foi marcado com `@Nome` | na hora |

Como funciona por dentro: o banco coloca o aviso numa fila e chama o endereço `/api/webhooks/despachar`
do sistema, que manda a mensagem pelo canal que você escolher. A cada 5 minutos o próprio banco confere
prazos e atrasos. Para isso ele usa duas extensões do Supabase: **pg_net** (deixa o banco chamar
endereços da internet) e **pg_cron** (agenda tarefas repetidas, como um despertador do banco).

**Passo 1. Gere o segredo do despacho.** No terminal: `openssl rand -hex 32`. Esse texto é a senha
que o banco usa para chamar o sistema. Cadastre na Vercel como `WEBHOOK_DISPATCH_SECRET`
(**Settings → Environment Variables**) e faça um novo deploy (**Deployments → Redeploy**). Confira
também se a `TOOLS_ENC_KEY` está lá: é ela que guarda criptografados os tokens do canal.

**Passo 2. Ligue as extensões.** No Supabase, em **Database → Extensions**, procure e ative **pg_net**
e **pg_cron**. O **Vault** (cofre de segredos do Supabase) já vem ativo.

**Passo 3. Guarde os dois segredos no Vault.** No **SQL Editor** do Supabase, rode trocando os valores
(o endereço é o do seu sistema na Vercel ou o seu domínio, sem barra no fim; o segredo é o mesmo do
passo 1):

```sql
select vault.create_secret('https://SEU-SISTEMA.vercel.app', 'webhook_app_url');
select vault.create_secret('COLE-AQUI-O-MESMO-WEBHOOK_DISPATCH_SECRET', 'webhook_dispatch_secret');
```

Para trocar um valor depois:
`select vault.update_secret((select id from vault.secrets where name = 'webhook_app_url'), 'novo-valor');`

**Passo 4. Confira o agendamento.** Se o `pg_cron` já estava ligado quando você rodou o
`supabase db push`, a migração `052_avisos_whatsapp_canais.sql` agendou sozinha o job
`avisos-whatsapp` (a cada 5 minutos). Se você ligou o `pg_cron` depois, rode uma vez no SQL Editor:

```sql
select cron.schedule('avisos-whatsapp', '*/5 * * * *', 'select public.avisos_cron()');
```

Para conferir: `select jobname, schedule from cron.job;` tem que mostrar `avisos-whatsapp`.

**Passo 5. Cada pessoa cadastra o próprio WhatsApp.** Aparece um aviso no topo pedindo o número, e
dá para trocar a qualquer hora no card **Seu WhatsApp para avisos**, na tela **Conector do Claude**
(menu do perfil). O administrador também vê o número na ficha de **Colaboradores**.

**Passo 6. Escolha o canal.** Em **Configurações → Avisos no WhatsApp**, escolha por onde as mensagens
saem e preencha:

- **Vórtex CRM**: o endereço do conector do seu Vórtex CRM (fica na tela do conector do CRM e termina
  em `/functions/v1/mcp`) e uma chave do conector criada no CRM **com permissão de envio de
  mensagens**. A mensagem sai pelo WhatsApp conectado no CRM.
- **Z-API**: o **ID da instância** e o **Token da instância** (os dois ficam na página da instância,
  no painel da Z-API). O campo **Client-Token** é opcional: só preencha se você ligou o token de
  segurança da conta na Z-API. O **Endereço da API** também é opcional: deixe em branco para usar
  `https://api.z-api.io`.
- **Webhook**: a URL da ferramenta que vai mandar a mensagem (precisa começar com `https://`) e, se ela
  pedir, um token (vai no cabeçalho `Authorization: Bearer ...`).

Os tokens e chaves ficam criptografados no banco; a tela mostra só os 4 últimos caracteres.

**Passo 7. Escolha os avisos e os textos.** Em **Quando avisar**, ligue os avisos que quiser. Em
**Mensagens**, edite o texto de cada um usando os campos entre chaves: `{nome}`, `{tarefa}`,
`{prazo}`, `{prioridade}`, `{projeto}`, `{link}`, `{quem_criou}`, `{comentario}` e `{dias_atraso}`. A
**Prévia** mostra como vai chegar. Marque **Avisos ligados**, clique em **Salvar** e depois em
**Mandar teste**: a mensagem de teste chega no seu WhatsApp.

**Lembretes por tarefa.** Dentro de cada tarefa, no painel lateral, dá para marcar horários extras de
lembrete no WhatsApp para os responsáveis (além do aviso das 08:00 do dia do prazo).

No canal **Webhook**, a sua ferramenta recebe um `POST` assim (o texto pronto vai em `mensagem`):

```json
{
  "evento": "tarefa.atribuida",
  "entrega_id": "id-do-envio",
  "enviado_em": "2026-09-18T14:32:00-03:00",
  "responsavel": { "id": "...", "nome": "Ana Souza", "whatsapp": "55DDDNUMERO" },
  "tarefa": {
    "id": "...", "titulo": "Criar criativos", "descricao": "Três peças para o feed",
    "prioridade": "alta", "prioridade_label": "Alta",
    "prazo": "2026-09-25", "prazo_formatado": "25/09/2026 às 18:00",
    "link": "https://SEU-SISTEMA/minha-area?task=...",
    "link_projeto": "https://SEU-SISTEMA/projetos/..."
  },
  "projeto": { "id": "...", "nome": "Lançamento Setembro" },
  "atribuido_por": { "nome": "Bruno Costa" },
  "comentario": null,
  "dias_atraso": null,
  "mensagem": "Olá, Ana! Você tem uma nova tarefa..."
}
```

O campo `evento` pode ser `tarefa.atribuida`, `tarefa.prazo`, `tarefa.atrasada`, `tarefa.comentario` ou
`teste`. O histórico de cada envio (Enviado, Erro, Sem WhatsApp) aparece em **Últimos envios**, na
mesma tela, com botão de reenviar. Não sai aviso de tarefa nova quando a pessoa atribui a tarefa a si
mesma ou quando ela mesma criou a tarefa.

**Já usava o aviso por webhook de uma versão anterior?** Ao aplicar a migração 052 você continua no
canal Webhook, só com o aviso de tarefa nova ligado. Os avisos novos ficam desligados até você ligar
na tela, porque a ferramenta antiga não conhece os eventos novos.

### Conector do Claude

Cada pessoa abre **Conector do Claude** no menu, gera o endereço pessoal e, no Claude, vai em
**Configurações → Conectores → Adicionar conector personalizado**, cola o endereço e dá um nome.
O endereço funciona como uma senha: quem tiver ele age no sistema em nome da pessoa (dá para revogar
na mesma tela). Precisa de um plano do Claude que aceite conectores personalizados.

## 8. Checklist de teste

- [ ] `supabase db push` terminou sem erro.
- [ ] O sistema abre no endereço da Vercel e mostra a tela de login com o nome certo.
- [ ] O administrador entra, configura o 2FA e vê todos os menus.
- [ ] Criar um setor, um projeto e uma tarefa; arrastar a tarefa entre as colunas do quadro.
- [ ] Convidar um membro: a senha temporária aparece; ele entra, troca a senha e configura o 2FA.
- [ ] Perfil de permissão: o membro só vê o que o perfil dele permite.
- [ ] Ferramentas: cadastrar uma ferramenta com senha, abrir a senha e ver o registro em
      **Configurações → Registro de atividades**.
- [ ] Chat: mandar uma mensagem e uma imagem.
- [ ] Anexar uma imagem numa tarefa.
- [ ] *(Se ligou o e-mail)* "Esqueci minha senha" manda o código.
- [ ] *(Se ligou o WhatsApp)* **Mandar teste** em Configurações → Avisos no WhatsApp chega no seu
      WhatsApp; atribuir uma tarefa a outra pessoa gera um envio "Enviado" em Últimos envios; um
      comentário com @Nome avisa a pessoa marcada.

## 9. Problemas comuns

- **`supabase db push` pede senha e falha**: é a senha do banco criada no passo 3 (não a da sua conta).
  Esqueceu? Troque em **Project Settings → Database → Reset database password**.
- **"Invalid API key" ou a tela não atualiza sozinha**: confira se as chaves foram coladas inteiras, sem
  espaço, e se a `anon` não foi trocada pela `service_role`.
- **Fico preso na tela de trocar senha ou de 2FA**: é o fluxo de segurança: primeiro troca a senha,
  depois configura o 2FA. Se a pessoa perdeu o celular do 2FA, um administrador usa **Resetar senha** em
  Time & Permissões (gera uma senha temporária nova e remove o 2FA).
- **"TOOLS_ENC_KEY ausente" ao salvar uma ferramenta**: falta a variável na Vercel (ou no `.env.local`).
  Depois de cadastrar, faça um novo deploy.
- **Senhas das ferramentas pararam de abrir**: a `TOOLS_ENC_KEY` foi trocada. Volte a chave antiga.
- **E-mail não chega**: confira `RESEND_API_KEY`, o domínio verificado no Resend e o `EMAIL_FROM`
  com esse domínio. Sem domínio verificado, o Resend só entrega para o e-mail da sua própria conta.
- **Link do e-mail aponta para o endereço errado**: preencha `NEXT_PUBLIC_APP_URL` e confira a
  **Site URL** no Supabase.
- **"Criar conta" na tela de login dá erro**: esperado se você desligou o cadastro aberto. Novas pessoas
  entram pelo convite (Adicionar membro).
- **O aviso de WhatsApp não sai**: veja **Últimos envios** em Configurações → Avisos no WhatsApp.
  "Sem WhatsApp" = a pessoa não cadastrou o número. Nada aparece = avisos desligados, aquele aviso
  desligado em Quando avisar, ou a pessoa atribuiu a tarefa a si mesma. "Na fila" parado = falta o
  `pg_net`, os segredos do Vault, ou o `WEBHOOK_DISPATCH_SECRET` da Vercel está diferente do valor
  guardado no Vault. "Erro" = o canal recusou (veja o detalhe: no Z-API, confira ID e token da
  instância e, se ligou o token de segurança, o Client-Token; no Vórtex CRM, confira se a chave tem
  permissão de envio e se o WhatsApp do CRM está conectado).
- **Aviso de prazo ou atraso não chega, mas o de tarefa nova chega**: falta o `pg_cron` ou o job
  `avisos-whatsapp` (veja o passo 4 de "Avisos no WhatsApp").

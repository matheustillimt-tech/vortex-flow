# Instalação do Vórtex Flow (passo a passo manual)

Este guia instala o sistema do zero para **uma empresa**. Cada empresa tem a sua instalação:
um projeto no Supabase e um projeto na Vercel. Prefere que o Claude faça com você? Use o
[PROMPT-DE-INSTALACAO.md](PROMPT-DE-INSTALACAO.md).

Tempo estimado: 40 a 60 minutos.

---

## 1. Contas

Crie (ou entre) nestas contas, nesta ordem:

1. **GitHub** — [github.com](https://github.com). Guarda a sua cópia do código. Grátis.
2. **Supabase** — [supabase.com](https://supabase.com). Banco de dados, login e arquivos.
   Tem plano grátis (o projeto grátis pausa depois de 1 semana sem uso).
3. **Vercel** — [vercel.com](https://vercel.com). Deixa o sistema no ar. Entre com a conta do GitHub.
   O plano grátis (Hobby) serve para testar; para uso comercial a Vercel pede o plano Pro.
4. *(Opcional)* **Resend** — [resend.com](https://resend.com). Para o sistema mandar e-mails. Tem plano grátis.

E instale no seu computador:

- **Node.js 20** ou mais novo — [nodejs.org](https://nodejs.org)
- **Git** — [git-scm.com](https://git-scm.com)
- **CLI do Supabase** (programa de linha de comando) — no Mac: `brew install supabase/tap/supabase`;
  no Windows: veja [o guia oficial](https://supabase.com/docs/guides/local-development/cli/getting-started)
- **CLI da Vercel** — `npm install -g vercel`

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
| `TOOLS_ENC_KEY` | Criptografa as senhas da tela Ferramentas e o token do webhook | Gere com `openssl rand -base64 32` (guarde uma cópia!) | Sim |
| `NEXT_PUBLIC_APP_URL` | Endereço do sistema, usado nos links de e-mail e WhatsApp | O endereço da Vercel ou o seu domínio (ex.: `https://flow.suaempresa.com.br`) | Não (na Vercel, usa o domínio de produção sozinho; recomendada com domínio próprio) |
| `APP_URL` | Alternativa antiga à de cima | — | Não |
| `NEXT_PUBLIC_APP_NAME` | Nome que aparece nas telas, e-mails e no app de 2FA | Você escolhe (padrão: "Vórtex Flow") | Não |
| `RESEND_API_KEY` | Envio de e-mails (convite, código de senha, tarefa nova) | Resend → API Keys | Não (sem ela, não sai e-mail; o resto funciona) |
| `EMAIL_FROM` | Remetente dos e-mails | Um endereço do seu domínio verificado no Resend (ex.: `Sua Empresa <nao-responda@seu-dominio.com.br>`) | Não (sem domínio verificado, o Resend só entrega para o seu próprio e-mail) |
| `WEBHOOK_DISPATCH_SECRET` | Senha que o banco usa para chamar o sistema e disparar o aviso no WhatsApp | Gere com `openssl rand -hex 32` | Só para o aviso no WhatsApp |

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

### Aviso no WhatsApp quando uma tarefa é atribuída

O sistema não manda WhatsApp sozinho: ele avisa **a sua ferramenta de disparo** (qualquer serviço de
WhatsApp ou automação que receba webhook) e ela manda a mensagem. Funciona assim: alguém vira responsável
→ o banco registra o envio → o banco chama `/api/webhooks/despachar` → o sistema faz um `POST` com os
dados da tarefa para o endereço que você configurar.

1. Gere o segredo: `openssl rand -hex 32`. Cadastre como `WEBHOOK_DISPATCH_SECRET` na Vercel e faça
   um novo deploy.
2. No Supabase, em **Database → Extensions**, ative **pg_net** (a extensão que deixa o banco chamar
   endereços da internet). O **Vault** (cofre de segredos do Supabase) já vem ativo.
3. No **SQL Editor**, guarde no Vault o endereço do sistema e o mesmo segredo do passo 1:

   ```sql
   select vault.create_secret('https://SEU-SISTEMA.vercel.app', 'webhook_app_url');
   select vault.create_secret('COLE-AQUI-O-MESMO-WEBHOOK_DISPATCH_SECRET', 'webhook_dispatch_secret');
   ```

   Para trocar um valor depois:
   `select vault.update_secret((select id from vault.secrets where name = 'webhook_app_url'), 'novo-valor');`
4. Cada pessoa cadastra o próprio WhatsApp em **Colaboradores** (aparece um aviso no topo pedindo).
5. Em **Configurações → Webhooks**: cole o endereço que a sua ferramenta deu para receber webhooks
   (precisa começar com `https://`), um token se ela pedir (vai no cabeçalho
   `Authorization: Bearer ...`), marque **Ativo**, **Salvar** e **Enviar teste**.

Exemplo do que a sua ferramenta recebe:

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
  "atribuido_por": { "nome": "Bruno Costa" }
}
```

O histórico de cada envio (Enviado, Erro, Sem WhatsApp) aparece na mesma tela, com botão de reenviar.
Não sai aviso quando a pessoa atribui a tarefa a si mesma ou quando ela mesma criou a tarefa.

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
- [ ] *(Se ligou o WhatsApp)* **Enviar teste** em Configurações → Webhooks chega na sua ferramenta; atribuir
      uma tarefa criada por você a outra pessoa gera um envio "Enviado" no histórico.

## 9. Problemas comuns

- **`supabase db push` pede senha e falha** — é a senha do banco criada no passo 3 (não a da sua conta).
  Esqueceu? Troque em **Project Settings → Database → Reset database password**.
- **"Invalid API key" ou a tela não atualiza sozinha** — confira se as chaves foram coladas inteiras, sem
  espaço, e se a `anon` não foi trocada pela `service_role`.
- **Fico preso na tela de trocar senha ou de 2FA** — é o fluxo de segurança: primeiro troca a senha,
  depois configura o 2FA. Se a pessoa perdeu o celular do 2FA, um administrador usa **Resetar senha** em
  Time & Permissões (gera uma senha temporária nova e remove o 2FA).
- **"TOOLS_ENC_KEY ausente" ao salvar uma ferramenta** — falta a variável na Vercel (ou no `.env.local`).
  Depois de cadastrar, faça um novo deploy.
- **Senhas das ferramentas pararam de abrir** — a `TOOLS_ENC_KEY` foi trocada. Volte a chave antiga.
- **E-mail não chega** — confira `RESEND_API_KEY`, o domínio verificado no Resend e o `EMAIL_FROM`
  com esse domínio. Sem domínio verificado, o Resend só entrega para o e-mail da sua própria conta.
- **Link do e-mail aponta para o endereço errado** — preencha `NEXT_PUBLIC_APP_URL` e confira a
  **Site URL** no Supabase.
- **"Criar conta" na tela de login dá erro** — esperado se você desligou o cadastro aberto. Novas pessoas
  entram pelo convite (Adicionar membro).
- **O aviso de WhatsApp não sai** — veja o histórico em Configurações → Webhooks:
  "Sem WhatsApp" = a pessoa não cadastrou o número; nada aparece = webhook inativo, ou a pessoa
  atribuiu a si mesma; "Pendente" parado = falta o `pg_net`, os segredos do Vault ou o
  `WEBHOOK_DISPATCH_SECRET` está diferente do valor guardado no Vault; "Erro" = a sua ferramenta recusou (veja a resposta).

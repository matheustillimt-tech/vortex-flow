# Prompt de instalação do Vórtex Flow

Abra o **Claude Code** (aba **Code**), escolha uma **pasta vazia** no seu computador e cole o prompt
abaixo inteiro. O Claude vai instalar tudo com você, um passo de cada vez.

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

Se algo der errado no meio, diga ao Claude o que apareceu na tela. A seção "Problemas comuns"
do [INSTALACAO.md](INSTALACAO.md) também ajuda.

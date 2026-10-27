-- Opcional: setores de exemplo para começar (dá para editar ou apagar na tela).
-- Rode uma vez no SQL Editor do Supabase, depois das migrações.
insert into public.sectors (nome, descricao, cor) values
  ('Tráfego Pago', 'Gestão de mídia paga, campanhas e otimização', '#3b82f6'),
  ('Automação', 'Funis, integrações e fluxos automatizados', '#8b5cf6'),
  ('Comercial', 'Vendas, SDRs e fechamento', '#10b981'),
  ('Design', 'Identidade, criativos e páginas', '#ec4899'),
  ('Edição de Vídeo', 'Produção e edição audiovisual', '#f97316'),
  ('Copywriting', 'Textos, copys e roteiros', '#eab308'),
  ('Estratégia', 'Planejamento e direção de projetos', '#6366f1'),
  ('Atendimento/CS', 'Suporte e sucesso do cliente', '#06b6d4'),
  ('Gestão de Projetos', 'Coordenação e acompanhamento', '#64748b')
on conflict do nothing;

-- ============================================================
-- Migration: funis e produtos por projeto
-- ============================================================

create type ticket_tier as enum ('low', 'medio', 'high');

-- ----------- FUNNELS -----------
create table public.funnels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  nome text not null,
  tier ticket_tier,
  cor text not null default '#6366f1',
  descricao text,
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index funnels_project_idx on public.funnels(project_id);
create index funnels_tier_idx on public.funnels(tier);

create trigger trg_funnels_updated
  before update on public.funnels
  for each row execute function set_updated_at();

-- ----------- PRODUCTS -----------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  funnel_id uuid references public.funnels(id) on delete set null,
  nome text not null,
  descricao text,
  tier ticket_tier not null,
  cor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_project_idx on public.products(project_id);
create index products_funnel_idx on public.products(funnel_id);
create index products_tier_idx on public.products(tier);

create trigger trg_products_updated
  before update on public.products
  for each row execute function set_updated_at();

-- ----------- Colunas em tasks e nodes -----------
alter table public.tasks
  add column funnel_id uuid references public.funnels(id) on delete set null,
  add column product_id uuid references public.products(id) on delete set null;

alter table public.nodes
  add column funnel_id uuid references public.funnels(id) on delete set null,
  add column product_id uuid references public.products(id) on delete set null;

create index tasks_funnel_idx on public.tasks(funnel_id);
create index tasks_product_idx on public.tasks(product_id);
create index nodes_funnel_idx on public.nodes(funnel_id);
create index nodes_product_idx on public.nodes(product_id);

-- ----------- RLS -----------
alter table public.funnels  enable row level security;
alter table public.products enable row level security;

create policy "funnels_select" on public.funnels
  for select using (auth.role() = 'authenticated');
create policy "funnels_write" on public.funnels
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "products_select" on public.products
  for select using (auth.role() = 'authenticated');
create policy "products_write" on public.products
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

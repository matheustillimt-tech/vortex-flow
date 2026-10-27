-- ============================================================
-- Migration 013: anexos visuais nas tarefas (imagem, vídeo, áudio, arquivo)
-- ============================================================

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  type text not null check (type in ('image', 'video', 'audio', 'file')),
  url text not null,
  storage_path text,                -- caminho dentro do bucket (pra deletar)
  name text not null,
  size bigint,
  mime text,
  duration int,                     -- segundos, p/ audio/video
  width int,                        -- px, p/ image/video
  height int,
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists task_attachments_task_idx
  on public.task_attachments(task_id);
create index if not exists task_attachments_created_at_idx
  on public.task_attachments(created_at desc);

-- RLS: qualquer autenticado lê/escreve (igual o resto das tasks).
alter table public.task_attachments enable row level security;

drop policy if exists "task_attachments_select" on public.task_attachments;
create policy "task_attachments_select" on public.task_attachments
  for select using (auth.role() = 'authenticated');

drop policy if exists "task_attachments_write" on public.task_attachments;
create policy "task_attachments_write" on public.task_attachments
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Realtime
alter table public.task_attachments replica identity full;
do $$
begin
  begin
    alter publication supabase_realtime add table public.task_attachments;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================
-- Storage bucket dedicado
-- ============================================================
insert into storage.buckets (id, name, public)
values ('task-media', 'task-media', true)
on conflict do nothing;

drop policy if exists "task_media_select" on storage.objects;
create policy "task_media_select" on storage.objects
  for select using (bucket_id = 'task-media');

drop policy if exists "task_media_insert" on storage.objects;
create policy "task_media_insert" on storage.objects
  for insert with check (
    bucket_id = 'task-media' and auth.role() = 'authenticated'
  );

drop policy if exists "task_media_delete" on storage.objects;
create policy "task_media_delete" on storage.objects
  for delete using (
    bucket_id = 'task-media' and auth.role() = 'authenticated'
  );

-- FASE 2 — rode no SQL Editor do Supabase (uma vez)

-- 1) leads.updated_at com gatilho automático
alter table leads add column if not exists updated_at timestamptz default now();
update leads set updated_at = coalesce(updated_at, created_at, now());

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;

drop trigger if exists leads_set_updated_at on leads;
create trigger leads_set_updated_at before update on leads
  for each row execute function set_updated_at();

-- 2) corretores: whatsapp + liga/desliga do agente
alter table corretores add column if not exists whatsapp text;
alter table corretores add column if not exists agente_ativo boolean default false;

-- 3) alertas enviados (evita repetir cobrança e guarda ação pendente)
create table if not exists agente_alertas (
  id bigint generated always as identity primary key,
  lead_id uuid references leads(id) on delete cascade,
  corretor text not null,
  whatsapp text not null,
  regra text not null,
  mensagem text,
  acao_pendente jsonb,
  status text default 'enviado', -- enviado | respondido | executado | descartado
  criado_em timestamptz default now(),
  respondido_em timestamptz
);
create index if not exists agente_alertas_lead_idx on agente_alertas (lead_id, criado_em desc);
create index if not exists agente_alertas_whatsapp_idx on agente_alertas (whatsapp, criado_em desc);
alter table agente_alertas enable row level security;
create policy "anon acesso total agente_alertas" on agente_alertas
  for all to anon using (true) with check (true);

-- 4) mensagens: ligação opcional com lead
alter table agente_mensagens add column if not exists lead_id uuid;

-- 5) Cadastre os WhatsApp dos corretores (formato 55 + DDD + número) e ative:
-- update corretores set whatsapp = '5547999999999', agente_ativo = true where nome = 'Eliane';
-- update corretores set whatsapp = '5547999999999', agente_ativo = true where nome = 'Leide';

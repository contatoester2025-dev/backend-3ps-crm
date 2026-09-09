-- Rode no SQL Editor do Supabase (uma vez)
create table if not exists agente_mensagens (
  id bigint generated always as identity primary key,
  numero text not null,
  nome text,
  direcao text not null check (direcao in ('recebida','enviada')),
  texto text not null,
  whatsapp_id text,
  criado_em timestamptz default now()
);
create index if not exists agente_mensagens_numero_idx on agente_mensagens (numero, criado_em desc);

alter table agente_mensagens enable row level security;
create policy "anon acesso total agente_mensagens" on agente_mensagens
  for all to anon using (true) with check (true);

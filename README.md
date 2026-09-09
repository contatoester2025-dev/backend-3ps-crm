# backend-3ps-crm

Backend do 3Ps CRM. Recebe leads do Meta Lead Ads e envia/recebe mensagens de WhatsApp pela Evolution API.

## Endpoints
- `GET /` — healthcheck (mostra se WhatsApp e Meta estão configurados)
- `GET|POST /webhook/meta-leads` — webhook da Meta
- `POST /test/lead` — cria lead manual `{ nome, telefone, email }`
- `POST /webhook/whatsapp` — a Evolution API chama aqui (evento MESSAGES_UPSERT)
- `POST /whatsapp/enviar` — envia mensagem `{ numero, texto }` (header `x-token`)

## Deploy no Railway
1. Suba estes arquivos num repositório no GitHub.
2. Railway: New → GitHub Repo → selecione o repositório.
3. Em Variables, preencha tudo que está em `.env.example`.
4. Settings → Networking → Generate Domain.
5. No manager da Evolution, configure o webhook da instância com `https://SEU-DOMINIO/webhook/whatsapp` e o evento MESSAGES_UPSERT.
6. Rode `supabase.sql` no Supabase.

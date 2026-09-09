import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { enviar, extrairMensagem } from './whatsapp.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const supabase = createClient(process.env.SUPABASE_URL || 'https://qrfehznrjfaokbuqiroc.supabase.co', process.env.SUPABASE_KEY);
const PORT = process.env.PORT || 3000;

// ---------- Healthcheck ----------
app.get('/', (req, res) => {
  res.json({
    ok: true,
    servico: 'backend-3ps-crm',
    whatsapp: !!(process.env.EVOLUTION_URL && process.env.EVOLUTION_API_KEY && process.env.EVOLUTION_INSTANCE),
    meta: !!process.env.META_PAGE_ACCESS_TOKEN
  });
});

// ---------- Meta Lead Ads ----------
app.get('/webhook/meta-leads', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === (process.env.META_VERIFY_TOKEN || '3ps_crm_token_secreto')) return res.status(200).send(challenge);
  res.sendStatus(403);
});

app.post('/webhook/meta-leads', async (req, res) => {
  res.sendStatus(200); // responde rápido, a Meta exige
  try {
    for (const entry of req.body?.entry || []) {
      for (const change of entry.changes || []) {
        const leadgenId = change.value?.leadgen_id;
        if (!leadgenId) continue;
        const r = await fetch(`https://graph.facebook.com/v19.0/${leadgenId}?access_token=${process.env.META_PAGE_ACCESS_TOKEN}`);
        const lead = await r.json();
        const campos = {};
        for (const f of lead.field_data || []) campos[f.name] = f.values?.[0] || '';
        await salvarLead({
          nome: campos.full_name || campos.nome || campos.name || 'Lead Meta Ads',
          telefone: (campos.phone_number || campos.telefone || '').replace(/\D/g, ''),
          email: campos.email || '',
          origem: 'Meta Ads',
          observacoes: JSON.stringify(campos)
        });
      }
    }
  } catch (e) {
    console.error('Erro Meta Lead:', e.message);
  }
});

// Teste manual: POST /test/lead { nome, telefone, email }
app.post('/test/lead', async (req, res) => {
  try {
    const data = await salvarLead({ ...req.body, origem: req.body.origem || 'Teste' });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

async function salvarLead(lead) {
  const { data, error } = await supabase.from('leads').insert(lead).select();
  if (error) throw new Error(error.message);
  console.log('Lead salvo:', lead.nome);
  return data;
}

// ---------- WhatsApp (Evolution API) ----------
// A Evolution chama aqui. Aceita /webhook/whatsapp e /webhook/whatsapp/<evento>
app.post(['/webhook/whatsapp', '/webhook/whatsapp/*'], async (req, res) => {
  res.sendStatus(200);
  try {
    const msg = extrairMensagem(req.body);
    if (!msg || !msg.texto) return;
    console.log(`WhatsApp de ${msg.nome} (${msg.numero}): ${msg.texto}`);

    const { error } = await supabase.from('agente_mensagens').insert({
      numero: msg.numero,
      nome: msg.nome,
      direcao: 'recebida',
      texto: msg.texto,
      whatsapp_id: msg.id,
      criado_em: msg.timestamp
    });
    if (error) console.error('Erro ao salvar mensagem:', error.message);

    if ((process.env.AGENTE_ECO || 'true') === 'true') {
      await enviarERegistrar(msg.numero, `Recebi: "${msg.texto}" ✅`);
    }
  } catch (e) {
    console.error('Erro webhook WhatsApp:', e.message);
  }
});

// O CRM (ou você) chama aqui pra mandar mensagem. Header: x-token = BACKEND_TOKEN
app.post('/whatsapp/enviar', async (req, res) => {
  if (req.headers['x-token'] !== process.env.BACKEND_TOKEN) return res.status(401).json({ ok: false, erro: 'token inválido' });
  const { numero, texto } = req.body || {};
  if (!numero || !texto) return res.status(400).json({ ok: false, erro: 'numero e texto são obrigatórios' });
  try {
    const data = await enviarERegistrar(numero, texto);
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

async function enviarERegistrar(numero, texto) {
  const data = await enviar(numero, texto);
  const { error } = await supabase.from('agente_mensagens').insert({
    numero: String(numero).replace(/\D/g, ''),
    direcao: 'enviada',
    texto,
    whatsapp_id: data?.key?.id || null
  });
  if (error) console.error('Erro ao registrar envio:', error.message);
  return data;
}

app.listen(PORT, () => console.log(`backend-3ps-crm rodando na porta ${PORT}`));

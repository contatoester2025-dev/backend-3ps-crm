// Módulo WhatsApp — fala com a Evolution API
// enviar(numero, texto)  -> manda mensagem de texto
// extrairMensagem(body)  -> lê o webhook da Evolution e devolve {numero, nome, texto, id, timestamp} ou null

const URL = (process.env.EVOLUTION_URL || 'https://evolution-api-production-d613.up.railway.app').replace(/\/$/, '');
const KEY = process.env.EVOLUTION_API_KEY || '';
const INSTANCE = process.env.EVOLUTION_INSTANCE || 'EXCLUSIVE IMOVEIS';

function limparNumero(n) {
  return String(n || '').replace(/\D/g, '');
}

export async function enviar(numero, texto) {
  if (!URL || !KEY || !INSTANCE) throw new Error('Variáveis EVOLUTION_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE não configuradas');
  const number = limparNumero(numero);
  if (!number) throw new Error('Número inválido');

  const r = await fetch(`${URL}/message/sendText/${encodeURIComponent(INSTANCE)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY },
    body: JSON.stringify({ number, text: texto })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Evolution ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

// Payload da Evolution v2 (evento messages.upsert):
// { event, instance, data: { key: { remoteJid, fromMe, id }, pushName, message: {...}, messageTimestamp } }
export function extrairMensagem(body) {
  const evento = String(body?.event || '').toLowerCase().replace(/_/g, '.');
  if (evento && evento !== 'messages.upsert') return null;

  const d = body?.data;
  if (!d?.key) return null;
  if (d.key.fromMe) return null;                       // ignora o que a própria instância enviou
  if (d.key.remoteJid?.endsWith('@g.us')) return null; // ignora grupos por enquanto

  const m = d.message || {};
  const texto =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    (m.audioMessage ? '[áudio]' : '') ||
    (m.imageMessage ? '[imagem]' : '') ||
    (m.documentMessage ? '[documento]' : '') ||
    '';

  return {
    numero: limparNumero(d.key.remoteJid.split('@')[0]),
    nome: d.pushName || '',
    texto: String(texto).trim(),
    id: d.key.id || null,
    timestamp: d.messageTimestamp ? new Date(Number(d.messageTimestamp) * 1000).toISOString() : new Date().toISOString()
  };
}

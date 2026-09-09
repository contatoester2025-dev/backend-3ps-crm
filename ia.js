// Módulo de IA — chama a API da Anthropic; sem chave, usa regras (regras.js)
import { lembreteModelo, interpretarPorRegras } from './regras.js';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

const ETAPAS = ['novo', 'atendimento', 'followup', 'visita', 'proposta', 'fechada', 'perdido'];

async function perguntar(system, user, maxTokens = 400) {
  if (!API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${JSON.stringify(data)}`);
  return (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
}

const PERSONA = `Você é o Agente 3Ps, assistente da imobiliária Exclusive Imóveis (litoral de Santa Catarina).
Você fala com os corretores pelo WhatsApp, como um gestor parceiro: direto, cordial, sem cobrar de forma ríspida.
Escreva em português do Brasil, informal mas profissional, no máximo 3 frases curtas. Sem hashtags, sem emojis em excesso (no máximo 1). Não use markdown.`;

// Redige a cobrança/lembrete para o corretor
export async function redigirLembrete({ corretor, lead, regra, detalhe }) {
  if (!API_KEY) return lembreteModelo({ corretor, lead, regra, detalhe });
  const user = `Corretor: ${corretor}
Lead: ${lead.nome}${lead.empreendimento ? ` (interesse: ${lead.empreendimento})` : ''}${lead.cidade ? `, ${lead.cidade}` : ''}
Etapa atual: ${lead.status}
Situação: ${detalhe}
Regra disparada: ${regra}

Escreva a mensagem que o Agente 3Ps manda para ${corretor} no WhatsApp. Cumprimente pelo primeiro nome, diga qual lead e o que está pendente, e termine perguntando o que aconteceu ou pedindo um retorno rápido. Só o texto da mensagem.`;
  return perguntar(PERSONA, user, 250);
}

// Interpreta a resposta do corretor e devolve uma ação estruturada
export async function interpretarResposta({ corretor, lead, mensagemAgente, respostaCorretor }) {
  if (!API_KEY) return interpretarPorRegras({ lead, respostaCorretor });
  const system = PERSONA + `

Sua tarefa agora é interpretar a resposta do corretor e propor UMA ação no CRM.
Responda SOMENTE com JSON válido, sem texto antes ou depois, neste formato:
{
  "nova_etapa": "<uma de: ${ETAPAS.join(', ')} ou null se não mudar>",
  "nota": "<resumo curto do que o corretor disse, para registrar no lead, ou null>",
  "tarefa": { "titulo": "<texto>", "dias": <número de dias a partir de hoje> } ou null,
  "confirmacao": "<pergunta curta ao corretor resumindo a ação, terminando com: Responde SIM pra eu registrar.>"
}
Se a resposta não pedir nenhuma ação (ex.: "ok", "vou ver"), use nova_etapa null, tarefa null e coloque em "confirmacao" uma frase curta de encerramento sem pedir SIM.`;
  const user = `Lead: ${lead.nome} (etapa atual: ${lead.status})
Mensagem que o agente enviou: "${mensagemAgente}"
Resposta do corretor ${corretor}: "${respostaCorretor}"`;
  const bruto = await perguntar(system, user, 400);
  const limpo = bruto.replace(/```json|```/g, '').trim();
  const acao = JSON.parse(limpo);
  if (acao.nova_etapa && !ETAPAS.includes(acao.nova_etapa)) acao.nova_etapa = null;
  return acao;
}

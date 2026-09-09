// Cérebro do Agente 3Ps
import { enviar } from './whatsapp.js';
import { redigirLembrete, interpretarResposta } from './ia.js';

const H = 3600 * 1000, D = 24 * H;
const cfg = {
  intervaloMin: Number(process.env.AGENTE_INTERVALO_MIN || 30),
  horaInicio: Number(process.env.AGENTE_HORA_INICIO || 8),
  horaFim: Number(process.env.AGENTE_HORA_FIM || 20),
  maxPorCorretorDia: Number(process.env.AGENTE_MAX_POR_CORRETOR_DIA || 5),
  repeticaoHoras: Number(process.env.AGENTE_REPETICAO_HORAS || 48),
  fuso: process.env.AGENTE_FUSO || 'America/Sao_Paulo'
};

// Regras: etapa -> horas paradas
const REGRAS = [
  { regra: 'novo_sem_contato', status: ['novo'], horas: 24, detalhe: 'lead novo há mais de 24h sem primeiro contato registrado' },
  { regra: 'atendimento_parado', status: ['atendimento', 'followup'], horas: 72, detalhe: 'lead parado nesta etapa há mais de 3 dias' },
  { regra: 'visita_sem_retorno', status: ['visita'], horas: 48, detalhe: 'visita sem atualização há mais de 2 dias' },
  { regra: 'proposta_parada', status: ['proposta'], horas: 120, detalhe: 'proposta sem movimentação há mais de 5 dias' }
];
const IGNORAR = ['fechada', 'perdido'];

let supabase;
export function iniciar(client) {
  supabase = client;
  console.log(`Agente 3Ps iniciado: ciclo a cada ${cfg.intervaloMin} min, ${cfg.horaInicio}h–${cfg.horaFim}h`);
  setTimeout(ciclo, 15000);
  setInterval(ciclo, cfg.intervaloMin * 60 * 1000);
}

function horaLocal() {
  return Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: cfg.fuso }).format(new Date()));
}
const norm = s => String(s || '').trim().toLowerCase();
const primeiroNome = s => String(s || '').trim().split(/\s+/)[0];

// ---------- CICLO PRINCIPAL ----------
export async function ciclo() {
  try {
    const h = horaLocal();
    if (h < cfg.horaInicio || h >= cfg.horaFim) return;

    const { data: corretores, error: e1 } = await supabase.from('corretores').select('nome, whatsapp, agente_ativo').eq('agente_ativo', true);
    if (e1) throw new Error(e1.message);
    const ativos = (corretores || []).filter(c => c.whatsapp);
    if (!ativos.length) return;

    const { data: leads, error: e2 } = await supabase.from('leads')
      .select('id, nome, status, corretor, empreendimento, cidade, updated_at, created_at')
      .not('status', 'in', `(${IGNORAR.join(',')})`);
    if (e2) throw new Error(e2.message);

    const { data: tarefas } = await supabase.from('tarefas')
      .select('id, titulo, lead_rel, data_hora, corretor, concluida')
      .eq('concluida', false).lt('data_hora', new Date().toISOString());

    const desde = new Date(Date.now() - cfg.repeticaoHoras * H).toISOString();
    const { data: recentes } = await supabase.from('agente_alertas').select('lead_id, whatsapp, criado_em').gte('criado_em', desde);
    const jaAlertado = new Set((recentes || []).map(a => a.lead_id));
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const enviadosHoje = {};
    for (const a of recentes || []) if (new Date(a.criado_em) >= hoje) enviadosHoje[a.whatsapp] = (enviadosHoje[a.whatsapp] || 0) + 1;

    const agora = Date.now();
    for (const c of ativos) {
      const meusLeads = (leads || []).filter(l => norm(l.corretor) === norm(c.nome));
      const pendencias = [];

      for (const l of meusLeads) {
        if (jaAlertado.has(l.id)) continue;
        const parado = agora - new Date(l.updated_at || l.created_at).getTime();
        const r = REGRAS.find(r => r.status.includes(norm(l.status)));
        if (r && parado > r.horas * H) pendencias.push({ lead: l, regra: r.regra, detalhe: r.detalhe, peso: parado });
        const tv = (tarefas || []).find(t => t.lead_rel === l.id || norm(t.lead_rel) === norm(l.nome));
        if (tv && !pendencias.find(p => p.lead.id === l.id))
          pendencias.push({ lead: l, regra: 'tarefa_vencida', detalhe: `tarefa "${tv.titulo}" venceu em ${new Date(tv.data_hora).toLocaleDateString('pt-BR', { timeZone: cfg.fuso })} e não foi concluída`, peso: agora - new Date(tv.data_hora).getTime() + D * 30 });
      }

      pendencias.sort((a, b) => b.peso - a.peso);
      for (const p of pendencias) {
        if ((enviadosHoje[c.whatsapp] || 0) >= cfg.maxPorCorretorDia) break;
        try {
          const texto = await redigirLembrete({ corretor: primeiroNome(c.nome), lead: p.lead, regra: p.regra, detalhe: p.detalhe });
          const env = await enviar(c.whatsapp, texto);
          await supabase.from('agente_alertas').insert({ lead_id: p.lead.id, corretor: c.nome, whatsapp: c.whatsapp, regra: p.regra, mensagem: texto });
          await supabase.from('agente_mensagens').insert({ numero: c.whatsapp, nome: c.nome, direcao: 'enviada', texto, whatsapp_id: env?.key?.id || null, lead_id: p.lead.id });
          enviadosHoje[c.whatsapp] = (enviadosHoje[c.whatsapp] || 0) + 1;
          jaAlertado.add(p.lead.id);
          console.log(`Agente → ${c.nome}: [${p.regra}] ${p.lead.nome}`);
        } catch (e) {
          console.error(`Falha ao alertar ${c.nome} sobre ${p.lead.nome}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('Erro no ciclo do agente:', e.message);
  }
}

// ---------- RESPOSTAS DOS CORRETORES ----------
export async function tratarResposta(msg) {
  const { data: cs } = await supabase.from('corretores').select('nome, whatsapp, agente_ativo').eq('whatsapp', msg.numero).limit(1);
  const corretor = cs?.[0];
  if (!corretor) return false; // não é corretor cadastrado: só grava, não responde

  // último alerta desse corretor nas últimas 24h, ainda aberto
  const { data: als } = await supabase.from('agente_alertas').select('*')
    .eq('whatsapp', msg.numero).in('status', ['enviado', 'respondido'])
    .gte('criado_em', new Date(Date.now() - D).toISOString())
    .order('criado_em', { ascending: false }).limit(1);
  const alerta = als?.[0];
  if (!alerta) {
    await responder(msg.numero, corretor.nome, `Oi ${primeiroNome(corretor.nome)}, aqui é o Agente 3Ps. Recebi sua mensagem, mas não tenho nenhuma pendência aberta com você agora. Quando eu te mandar um lembrete de lead, é só responder nele.`);
    return true;
  }

  const { data: ls } = await supabase.from('leads').select('*').eq('id', alerta.lead_id).limit(1);
  const lead = ls?.[0];
  if (!lead) return false;

  const texto = norm(msg.texto);
  const ehSim = /^(sim|s|ok|pode|confirmo|isso|confirma)[.!\s]*$/.test(texto);

  // Confirmação de ação pendente
  if (alerta.acao_pendente && ehSim) {
    const a = alerta.acao_pendente;
    const feito = [];
    if (a.nova_etapa && a.nova_etapa !== lead.status) {
      await supabase.from('leads').update({ status: a.nova_etapa }).eq('id', lead.id);
      feito.push(`etapa → ${a.nova_etapa}`);
    }
    if (a.nota) {
      const obs = (lead.observacoes ? lead.observacoes + '\n' : '') + `[${new Date().toLocaleDateString('pt-BR', { timeZone: cfg.fuso })} · Agente 3Ps] ${a.nota}`;
      await supabase.from('leads').update({ observacoes: obs }).eq('id', lead.id);
      feito.push('nota registrada');
    }
    if (a.tarefa?.titulo) {
      const quando = new Date(Date.now() + (Number(a.tarefa.dias) || 1) * D);
      await supabase.from('tarefas').insert({ titulo: a.tarefa.titulo, lead_rel: lead.id, data_hora: quando.toISOString(), prioridade: 'media', corretor: lead.corretor, concluida: false, notas: 'Criada pelo Agente 3Ps' });
      feito.push(`tarefa "${a.tarefa.titulo}" em ${quando.toLocaleDateString('pt-BR', { timeZone: cfg.fuso })}`);
    }
    if (!a.nova_etapa && !a.nota && !a.tarefa?.titulo) {
      await supabase.from('leads').update({ updated_at: new Date().toISOString() }).eq('id', lead.id);
      feito.push('lead marcado como acompanhado');
    }
    await supabase.from('agente_alertas').update({ status: 'executado', respondido_em: new Date().toISOString() }).eq('id', alerta.id);
    await responder(msg.numero, corretor.nome, `Feito ✅ ${lead.nome}: ${feito.join(', ')}.`, lead.id);
    return true;
  }

  // Interpretar resposta livre e propor ação
  try {
    const acao = await interpretarResposta({ corretor: primeiroNome(corretor.nome), lead, mensagemAgente: alerta.mensagem, respostaCorretor: msg.texto });
    const temAcao = acao.nova_etapa || acao.nota || acao.tarefa?.titulo;
    await supabase.from('agente_alertas').update({
      acao_pendente: temAcao ? acao : null,
      status: temAcao ? 'respondido' : 'descartado',
      respondido_em: new Date().toISOString()
    }).eq('id', alerta.id);
    if (!temAcao) await supabase.from('leads').update({ updated_at: new Date().toISOString() }).eq('id', lead.id);
    await responder(msg.numero, corretor.nome, acao.confirmacao || 'Anotado.', lead.id);
  } catch (e) {
    console.error('Erro ao interpretar resposta:', e.message);
    await responder(msg.numero, corretor.nome, 'Recebi, mas não consegui entender direito. Pode me dizer em uma frase o que aconteceu com esse lead?', lead.id);
  }
  return true;
}

async function responder(numero, nome, texto, lead_id = null) {
  const env = await enviar(numero, texto);
  await supabase.from('agente_mensagens').insert({ numero, nome, direcao: 'enviada', texto, whatsapp_id: env?.key?.id || null, lead_id });
}

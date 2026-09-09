// Versão sem IA: modelos de mensagem e interpretação por palavras-chave
const MODELOS = {
  novo_sem_contato: ['{corretor}, o lead {lead}{interesse} entrou há mais de um dia e ainda está em "novo". Já conseguiu fazer o primeiro contato?', '{corretor}, aqui é o Agente 3Ps. O {lead}{interesse} chegou ontem e segue sem atendimento. Consegue dar um retorno hoje?'],
  atendimento_parado: ['{corretor}, o {lead}{interesse} está em {etapa} há mais de 3 dias sem novidade. Como está esse atendimento?', 'Oi {corretor}. O lead {lead} parou em {etapa} desde a semana passada. Rolou algum avanço?'],
  visita_sem_retorno: ['{corretor}, e a visita do {lead}{interesse}? Faz 2 dias e não tem retorno registrado. Como foi?', 'Oi {corretor}. O {lead} está em visita há mais de 2 dias. Ele visitou? Gostou?'],
  proposta_parada: ['{corretor}, a proposta do {lead}{interesse} está parada há 5 dias. Teve resposta do cliente?', '{corretor}, e a proposta do {lead}? Faz quase uma semana. Vale um retorno hoje?'],
  tarefa_vencida: ['{corretor}, tinha uma tarefa do {lead} que venceu: {situacao}. Conseguiu fazer?', 'Oi {corretor}. Ficou uma pendência do {lead}: {situacao}. Já resolveu?']
};

export function lembreteModelo({ corretor, lead, regra, detalhe }) {
  const lista = MODELOS[regra] || ['{corretor}, o lead {lead} precisa de atenção: {situacao}. Pode dar um retorno?'];
  const m = lista[Math.floor(Math.random() * lista.length)];
  return m.replace(/{corretor}/g, corretor).replace(/{lead}/g, lead.nome)
    .replace(/{interesse}/g, lead.empreendimento ? ` (${lead.empreendimento})` : '')
    .replace(/{etapa}/g, lead.status).replace(/{situacao}/g, detalhe);
}

// Devolve o mesmo formato que a IA: { nova_etapa, nota, tarefa, confirmacao }
export function interpretarPorRegras({ lead, respostaCorretor }) {
  const t = String(respostaCorretor || '').toLowerCase();
  let nova_etapa = null, tarefa = null;

  if (/(perdeu|desistiu|não quer|nao quer|sem interesse|comprou com outro|perdido)/.test(t)) nova_etapa = 'perdido';
  else if (/(fechou|fechamos|assinou|vendido|venda feita|fechado)/.test(t)) nova_etapa = 'fechada';
  else if (/(proposta|ofert|negocia)/.test(t)) nova_etapa = 'proposta';
  else if (/(visitou|visita marcada|agendei visita|vai visitar|visitar)/.test(t)) nova_etapa = 'visita';
  else if (/(follow|retornar|vai pensar|pensando|me ligar depois|depois)/.test(t)) nova_etapa = 'followup';
  else if (/(falei|conversei|liguei|respondeu|atendi|atendendo)/.test(t)) nova_etapa = 'atendimento';

  const mDias = t.match(/(?:em|daqui)\s+(\d+)\s+dias?/);
  if (/amanh[ãa]/.test(t)) tarefa = { titulo: `Retornar para ${lead.nome}`, dias: 1 };
  else if (mDias) tarefa = { titulo: `Retornar para ${lead.nome}`, dias: Number(mDias[1]) };
  else if (/semana que vem|pr[óo]xima semana/.test(t)) tarefa = { titulo: `Retornar para ${lead.nome}`, dias: 7 };
  else if (/ligar|retornar|cobrar/.test(t) && !nova_etapa) tarefa = { titulo: `Retornar para ${lead.nome}`, dias: 1 };

  if (nova_etapa === lead.status) nova_etapa = null;
  const nota = t.length > 3 ? respostaCorretor.trim().slice(0, 200) : null;
  const temAcao = nova_etapa || tarefa;
  const partes = [];
  if (nova_etapa) partes.push(`mover ${lead.nome} para ${nova_etapa}`);
  if (tarefa) partes.push(`criar tarefa "${tarefa.titulo}" em ${tarefa.dias} dia(s)`);
  const confirmacao = temAcao
    ? `Entendi. Vou ${partes.join(' e ')} e registrar sua observação. Responde SIM pra eu registrar.`
    : `Anotado sobre ${lead.nome}. Se rolar novidade, me avisa.`;
  return { nova_etapa, nota: temAcao ? nota : nota, tarefa, confirmacao };
}

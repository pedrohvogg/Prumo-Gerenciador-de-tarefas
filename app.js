/* =====================================================================
   Planejador — demandas, rotina e diário
   Site estático (PWA). Dados no localStorage; sincronização opcional
   via Firebase (Google + Firestore) configurada em Ajustes.
   ===================================================================== */
(() => {
'use strict';

/* ============================ Constantes ============================ */

const CATEGORIAS = {
  trabalho_diario:   { nome: 'Trabalho · Demandas diárias', cor: 'var(--cat-trab-dia)' },
  trabalho_projetos: { nome: 'Trabalho · Projetos',         cor: 'var(--cat-trab-proj)' },
  saude_mental:      { nome: 'Saúde mental',                cor: 'var(--cat-saude)' },
  exercicio:         { nome: 'Exercício',                   cor: 'var(--cat-exercicio)' },
  estudos:           { nome: 'Estudos',                     cor: 'var(--cat-estudos)' },
  lazer:             { nome: 'Lazer',                       cor: 'var(--cat-lazer)' },
};
const NIVEIS = { 1: 'Baixa', 2: 'Média', 3: 'Alta' };
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho',
               'Agosto','Setembro','Outubro','Novembro','Dezembro'];
const STORE_KEY = 'planejador.v1';
const FB_KEY = 'planejador.firebase';
const THEME_KEY = 'planejador.theme';

/* ============================ Utilidades ============================ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function dataStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function deStr(s) { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); }
function addDias(s, n) { const d = deStr(s); d.setDate(d.getDate() + n); return dataStr(d); }
function fmtData(s) {
  if (!s) return '';
  const d = deStr(s);
  return `${DIAS_SEMANA[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()}`;
}
function fmtDataCurta(s) { const [, m, d] = s.split('-'); return `${d}/${m}`; }
function fmtTempo(min) {
  if (!min) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`) : `${m}min`;
}
function inicioSemana(s) { const d = deStr(s); d.setDate(d.getDate() - d.getDay()); return dataStr(d); }
function escaparHtml(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ============================ Estado ============================ */

// itens: { [id]: {id, kind:'task'|'journal'|'capture', deleted, updatedAt, ...} }
let itens = {};
function carregarLocal() {
  try { itens = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch { itens = {}; }
}
function salvarLocal() { localStorage.setItem(STORE_KEY, JSON.stringify(itens)); }

function gravar(item) {
  item.updatedAt = Date.now();
  itens[item.id] = item;
  salvarLocal();
  syncEnviar(item);
}
function excluirItem(id) {
  const item = itens[id];
  if (!item) return;
  item.deleted = true;
  gravar(item);
}

const tarefas = () => Object.values(itens).filter(i => i.kind === 'task' && !i.deleted);
const capturas = () => Object.values(itens).filter(i => i.kind === 'capture' && !i.deleted)
  .sort((a, b) => b.updatedAt - a.updatedAt);

function diarioDe(data) {
  const id = 'j_' + data;
  return itens[id] && !itens[id].deleted ? itens[id]
    : { id, kind: 'journal', data, nota: '', acoes: [] };
}

/* ============================ Regras de negócio ============================ */

function ocorreEm(t, data) {
  if (!t.recorrencia) return false;
  if (t.criadaEm && data < t.criadaEm.slice(0, 10)) return false;
  const d = deStr(data);
  const r = t.recorrencia;
  if (r.tipo === 'diaria') return true;
  if (r.tipo === 'semanal') return (r.dias || []).includes(d.getDay());
  if (r.tipo === 'mensal') {
    const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === Math.min(r.dia || 1, ultimo);
  }
  return false;
}
function concluidaNoDia(t, data) {
  return t.recorrencia ? (t.datasConcluidas || []).includes(data) : t.status === 'concluida';
}
function pontuacao(t) { return t.importancia * 2 + t.urgencia; }
function quadrante(t) {
  const u = t.urgencia >= 3, i = t.importancia >= 3;
  return u && i ? 1 : i ? 2 : u ? 3 : 4;
}
function atrasada(t, hoje) {
  return !t.recorrencia && t.status !== 'concluida' && t.dataPrevista && t.dataPrevista < hoje;
}
function tarefasDoDia(data) {
  return tarefas().filter(t => !t.recorrencia && t.dataPrevista === data);
}
function recorrentesDoDia(data) {
  return tarefas().filter(t => ocorreEm(t, data));
}
function ordenarPrioridade(lista) {
  return lista.sort((a, b) =>
    pontuacao(b) - pontuacao(a) ||
    (a.dataPrevista || '9999').localeCompare(b.dataPrevista || '9999'));
}

function registrarAcao(data, texto) {
  const j = diarioDe(data);
  j.acoes = j.acoes || [];
  const p = (n) => String(n).padStart(2, '0');
  const agora = new Date();
  j.acoes.push({ hora: `${p(agora.getHours())}:${p(agora.getMinutes())}`, texto });
  gravar(j);
}
function removerAcao(data, texto) {
  const j = diarioDe(data);
  const idx = (j.acoes || []).map(a => a.texto).lastIndexOf(texto);
  if (idx >= 0) { j.acoes.splice(idx, 1); gravar(j); }
}

function alternarConclusao(t, data) {
  const rotulo = `Concluiu: ${t.titulo}`;
  if (t.recorrencia) {
    t.datasConcluidas = t.datasConcluidas || [];
    const i = t.datasConcluidas.indexOf(data);
    if (i >= 0) { t.datasConcluidas.splice(i, 1); removerAcao(data, rotulo); }
    else { t.datasConcluidas.push(data); registrarAcao(data, rotulo); }
  } else if (t.status === 'concluida') {
    t.status = 'ativa';
    removerAcao(t.concluidaEm || data, rotulo);
    delete t.concluidaEm;
  } else {
    t.status = 'concluida';
    t.concluidaEm = dataStr();
    registrarAcao(t.concluidaEm, rotulo);
  }
  gravar(t);
  renderTudo();
}

/* ============================ Render: componentes ============================ */

function htmlBadges(t, data) {
  const cat = CATEGORIAS[t.categoria] || { nome: t.categoria, cor: 'var(--muted)' };
  const hoje = dataStr();
  let b = `<span class="badge cat">${escaparHtml(cat.nome)}</span>`;
  if (t.urgencia >= 3) b += `<span class="badge urgente">Urgente</span>`;
  if (t.importancia >= 3) b += `<span class="badge">Importante</span>`;
  if (t.tempoEstimado) b += `<span class="badge">⏱ ${fmtTempo(t.tempoEstimado)}</span>`;
  if (t.recorrencia) b += `<span class="badge rec">↻ ${descreverRecorrencia(t.recorrencia)}</span>`;
  else if (t.dataPrevista) {
    b += atrasada(t, hoje)
      ? `<span class="badge atrasada">venceu ${fmtDataCurta(t.dataPrevista)}</span>`
      : `<span class="badge">📅 ${fmtDataCurta(t.dataPrevista)}</span>`;
  }
  return b;
}
function descreverRecorrencia(r) {
  if (r.tipo === 'diaria') return 'diária';
  if (r.tipo === 'mensal') return `dia ${r.dia}`;
  if (r.tipo === 'semanal') return (r.dias || []).map(d => DIAS_SEMANA[d]).join(', ');
  return '';
}

function htmlTarefa(t, data, opcoes = {}) {
  const feita = concluidaNoDia(t, data);
  const catCor = (CATEGORIAS[t.categoria] || {}).cor || 'var(--muted)';
  let entregas = '';
  if (!opcoes.compacta && (t.entregas || []).length) {
    entregas = `<div class="task-entregas">` + t.entregas.map((e, i) => `
      <label class="entrega-linha ${e.feita ? 'feita' : ''}">
        <input type="checkbox" data-entrega="${t.id}:${i}" ${e.feita ? 'checked' : ''}>
        <span>${escaparHtml(e.texto)}${e.data ? ` — ${fmtDataCurta(e.data)}` : ''}</span>
      </label>`).join('') + `</div>`;
  }
  return `
    <div class="task ${feita ? 'concluida' : ''}" style="--cat-cor:${catCor}">
      <button class="task-check" data-concluir="${t.id}" data-data="${data}" title="Concluir">${feita ? '✓' : ''}</button>
      <div class="task-corpo" data-editar="${t.id}">
        <div class="task-titulo">${escaparHtml(t.titulo)}</div>
        <div class="task-meta">${htmlBadges(t, data)}</div>
        ${entregas}
      </div>
    </div>`;
}

function ligarEventosTarefas(raiz) {
  raiz.querySelectorAll('[data-concluir]').forEach(el => {
    el.onclick = () => {
      const t = itens[el.dataset.concluir];
      if (t) alternarConclusao(t, el.dataset.data);
    };
  });
  raiz.querySelectorAll('[data-editar]').forEach(el => {
    el.onclick = (ev) => {
      if (ev.target.closest('.entrega-linha')) return;
      abrirModal(itens[el.dataset.editar]);
    };
  });
  raiz.querySelectorAll('[data-entrega]').forEach(el => {
    el.onchange = () => {
      const [id, i] = el.dataset.entrega.split(':');
      const t = itens[id];
      if (!t || !t.entregas[i]) return;
      t.entregas[i].feita = el.checked;
      if (el.checked) registrarAcao(dataStr(), `Entrega: ${t.entregas[i].texto} (${t.titulo})`);
      gravar(t);
      renderTudo();
    };
  });
}

/* ============================ Render: Hoje ============================ */

let dataHoje = dataStr();

function renderHoje() {
  const hojeReal = dataStr();
  $('#hoje-titulo').textContent =
    dataHoje === hojeReal ? 'Hoje' :
    dataHoje === addDias(hojeReal, 1) ? 'Amanhã' :
    dataHoje === addDias(hojeReal, -1) ? 'Ontem' : fmtDataCurta(dataHoje);
  $('#hoje-data').textContent = fmtData(dataHoje);

  const doDia = ordenarPrioridade(tarefasDoDia(dataHoje));
  const rec = ordenarPrioridade(recorrentesDoDia(dataHoje));
  const atrasadas = dataHoje === hojeReal
    ? ordenarPrioridade(tarefas().filter(t => atrasada(t, hojeReal))) : [];

  const totalMin = [...doDia, ...rec].reduce((s, t) => s + (t.tempoEstimado || 0), 0);
  const feitas = [...doDia, ...rec].filter(t => concluidaNoDia(t, dataHoje)).length;
  $('#hoje-resumo').innerHTML = `
    <span class="resumo-chip"><strong>${doDia.length + rec.length}</strong> tarefas</span>
    <span class="resumo-chip"><strong>${feitas}</strong> concluídas</span>
    ${totalMin ? `<span class="resumo-chip">⏱ <strong>${fmtTempo(totalMin)}</strong> estimado</span>` : ''}`;

  $('#hoje-atrasadas-wrap').hidden = !atrasadas.length;
  $('#hoje-atrasadas').innerHTML = atrasadas.map(t => htmlTarefa(t, dataHoje)).join('');
  $('#hoje-tarefas').innerHTML = doDia.map(t => htmlTarefa(t, dataHoje)).join('');
  $('#hoje-vazio').hidden = !!doDia.length;
  $('#hoje-recorrentes').innerHTML = rec.map(t => htmlTarefa(t, dataHoje, { compacta: true })).join('');
  $('#hoje-rec-vazio').hidden = !!rec.length;
  ligarEventosTarefas($('#view-hoje'));

  const j = diarioDe(dataHoje);
  const ta = $('#hoje-diario');
  if (document.activeElement !== ta) ta.value = j.nota || '';
}

/* ============================ Render: Semana ============================ */

let semanaInicio = inicioSemana(dataStr());

function renderSemana() {
  const fim = addDias(semanaInicio, 6);
  $('#semana-intervalo').textContent = `${fmtDataCurta(semanaInicio)} – ${fmtDataCurta(fim)}`;
  const hoje = dataStr();
  let html = '';
  for (let i = 0; i < 7; i++) {
    const dia = addDias(semanaInicio, i);
    const lista = ordenarPrioridade([...tarefasDoDia(dia), ...recorrentesDoDia(dia)]);
    const d = deStr(dia);
    html += `
      <div class="semana-dia ${dia === hoje ? 'hoje' : ''}">
        <div class="semana-dia-topo"><span>${DIAS_SEMANA[d.getDay()]}</span><span>${d.getDate()}</span></div>
        ${lista.map(t => `
          <div class="semana-item ${concluidaNoDia(t, dia) ? 'concluida' : ''}"
               style="--cat-cor:${(CATEGORIAS[t.categoria] || {}).cor || 'var(--muted)'}"
               data-editar="${t.id}">${escaparHtml(t.titulo)}</div>`).join('')}
      </div>`;
  }
  $('#semana-grid').innerHTML = html;
  ligarEventosTarefas($('#semana-grid'));
}

/* ============================ Render: Mês ============================ */

let mesAno = new Date().getFullYear();
let mesNum = new Date().getMonth();
let mesDiaSelecionado = dataStr();

function renderMes() {
  $('#mes-titulo').textContent = `${MESES[mesNum]} ${mesAno}`;
  $('#mes-cabecalho').innerHTML = DIAS_SEMANA.map(d => `<div>${d[0]}</div>`).join('');

  const primeiro = new Date(mesAno, mesNum, 1);
  const inicio = new Date(primeiro); inicio.setDate(1 - primeiro.getDay());
  const hoje = dataStr();
  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(inicio); d.setDate(inicio.getDate() + i);
    const dia = dataStr(d);
    const fora = d.getMonth() !== mesNum;
    const lista = [...tarefasDoDia(dia), ...recorrentesDoDia(dia)];
    const cores = [...new Set(lista.map(t => (CATEGORIAS[t.categoria] || {}).cor || 'var(--muted)'))];
    html += `
      <div class="mes-dia ${fora ? 'fora' : ''} ${dia === hoje ? 'hoje' : ''} ${dia === mesDiaSelecionado ? 'selecionado' : ''}" data-dia="${dia}">
        <span class="mes-dia-num">${d.getDate()}</span>
        <span class="mes-pontos">${cores.slice(0, 4).map(c => `<span class="mes-ponto" style="--cat-cor:${c}"></span>`).join('')}</span>
        ${lista.length > 4 ? `<span class="mes-mais">+${lista.length - 4}</span>` : ''}
      </div>`;
  }
  $('#mes-grid').innerHTML = html;
  $$('#mes-grid .mes-dia').forEach(el => {
    el.onclick = () => { mesDiaSelecionado = el.dataset.dia; renderMes(); };
  });

  $('#mes-dia-titulo').textContent = `Tarefas de ${fmtData(mesDiaSelecionado)}`;
  const lista = ordenarPrioridade([...tarefasDoDia(mesDiaSelecionado), ...recorrentesDoDia(mesDiaSelecionado)]);
  $('#mes-dia-tarefas').innerHTML = lista.length
    ? lista.map(t => htmlTarefa(t, mesDiaSelecionado, { compacta: true })).join('')
    : '<p class="vazio">Nada neste dia.</p>';
  ligarEventosTarefas($('#mes-dia-tarefas'));
}

/* ============================ Render: Demandas ============================ */

let filtroCategoria = null;
let mostrarMatriz = false;

function renderFiltrosCategorias() {
  $('#filtro-categorias').innerHTML = Object.entries(CATEGORIAS).map(([id, c]) => `
    <button class="chip ${filtroCategoria === id ? 'ativo' : ''}" style="--cat-cor:${c.cor}" data-cat="${id}">
      ${escaparHtml(c.nome)}
    </button>`).join('');
  $$('#filtro-categorias .chip').forEach(el => {
    el.onclick = () => {
      filtroCategoria = filtroCategoria === el.dataset.cat ? null : el.dataset.cat;
      renderDemandas();
    };
  });
}

function renderDemandas() {
  renderFiltrosCategorias();
  const busca = $('#filtro-busca').value.trim().toLowerCase();
  const status = $('#filtro-status').value;
  const ordem = $('#ordenacao').value;

  let lista = tarefas().filter(t => {
    if (filtroCategoria && t.categoria !== filtroCategoria) return false;
    const concluida = !t.recorrencia && t.status === 'concluida';
    if (status === 'ativas' && concluida) return false;
    if (status === 'concluidas' && !concluida) return false;
    if (busca && !(t.titulo + ' ' + (t.descricao || '')).toLowerCase().includes(busca)) return false;
    return true;
  });

  if (ordem === 'prioridade') ordenarPrioridade(lista);
  else if (ordem === 'prazo') lista.sort((a, b) => (a.dataPrevista || '9999').localeCompare(b.dataPrevista || '9999'));
  else if (ordem === 'tempo') lista.sort((a, b) => (a.tempoEstimado || 0) - (b.tempoEstimado || 0));
  else lista.sort((a, b) => b.updatedAt - a.updatedAt);

  $('#demandas-vazio').hidden = !!lista.length;
  $('#demandas-lista').hidden = mostrarMatriz;
  $('#demandas-matriz').hidden = !mostrarMatriz;
  $('#btn-matriz').textContent = mostrarMatriz ? 'Lista' : 'Matriz';

  if (mostrarMatriz) {
    for (const q of [1, 2, 3, 4]) {
      const el = $(`.q-lista[data-q="${q}"]`);
      const doQ = lista.filter(t => quadrante(t) === q);
      el.innerHTML = doQ.length
        ? doQ.map(t => htmlTarefa(t, dataStr(), { compacta: true })).join('')
        : '<p class="vazio">—</p>';
    }
    ligarEventosTarefas($('#demandas-matriz'));
  } else {
    $('#demandas-lista').innerHTML = lista.map(t => htmlTarefa(t, dataStr())).join('');
    ligarEventosTarefas($('#demandas-lista'));
  }
}

/* ============================ Render: Diário ============================ */

let diarioData = dataStr();

function renderDiario() {
  $('#diario-data').textContent = fmtData(diarioData);
  const j = diarioDe(diarioData);
  const ta = $('#diario-nota');
  if (document.activeElement !== ta) ta.value = j.nota || '';

  const acoes = j.acoes || [];
  $('#diario-acoes').innerHTML = acoes.map(a =>
    `<li><span class="hora">${escaparHtml(a.hora)}</span><span>${escaparHtml(a.texto)}</span></li>`).join('');
  $('#diario-acoes-vazio').hidden = !!acoes.length;

  const previstas = ordenarPrioridade([...tarefasDoDia(diarioData), ...recorrentesDoDia(diarioData)]);
  $('#diario-previstas').innerHTML = previstas.length
    ? previstas.map(t => htmlTarefa(t, diarioData, { compacta: true })).join('')
    : '<p class="vazio">Nada estava previsto para este dia.</p>';
  ligarEventosTarefas($('#diario-previstas'));
}

/* ============================ Render: Capturar ============================ */

let capturaFotos = []; // dataURLs da captura em edição

function renderCapturaFotos() {
  $('#captura-fotos').innerHTML = capturaFotos.map((src, i) => `
    <div class="captura-foto">
      <img src="${src}" alt="foto ${i + 1}">
      <button data-remfoto="${i}" title="Remover">✕</button>
    </div>`).join('');
  $$('#captura-fotos [data-remfoto]').forEach(el => {
    el.onclick = () => { capturaFotos.splice(+el.dataset.remfoto, 1); renderCapturaFotos(); };
  });
}

function renderCapturas() {
  const lista = capturas();
  $('#capturas-vazio').hidden = !!lista.length;
  $('#capturas-lista').innerHTML = lista.map(c => `
    <div class="captura-item">
      <div class="muted">
        <span>${fmtData(c.data)}</span>
        <button class="perigo" data-delcaptura="${c.id}" title="Excluir">✕</button>
      </div>
      ${c.texto ? `<p>${escaparHtml(c.texto)}</p>` : ''}
      ${(c.fotos || []).length ? `<div class="captura-fotos">${c.fotos.map(f => `<div class="captura-foto"><img src="${f}"></div>`).join('')}</div>` : ''}
    </div>`).join('');
  $$('[data-delcaptura]').forEach(el => {
    el.onclick = () => { excluirItem(el.dataset.delcaptura); renderCapturas(); };
  });
}

function redimensionarFoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 900;
      const escala = Math.min(1, MAX / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * escala);
      cv.height = Math.round(img.height * escala);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      resolve(cv.toDataURL('image/jpeg', 0.8));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function montarPromptClaude(texto, temFotos) {
  const cats = Object.entries(CATEGORIAS).map(([id, c]) => `"${id}" (${c.nome})`).join(', ');
  return `Você é meu assistente de planejamento pessoal. Analise o contexto abaixo${temFotos ? ' (vou anexar fotos também — considere-as)' : ''} e defina as variáveis da demanda.

Responda em português e TERMINE a resposta com um único bloco JSON válido, exatamente neste formato:

{
  "titulo": "título curto da demanda",
  "descricao": "resumo do contexto",
  "categoria": "uma dentre: ${Object.keys(CATEGORIAS).join(' | ')}",
  "urgencia": 1,
  "importancia": 1,
  "data_prevista": "YYYY-MM-DD ou null",
  "tempo_estimado_minutos": 0,
  "entregas": [{"texto": "entrega prevista", "data": "YYYY-MM-DD ou null"}],
  "recorrencia": null
}

Regras:
- urgencia e importancia: 1 = baixa, 2 = média, 3 = alta (justifique brevemente antes do JSON).
- categoria: ${cats}.
- recorrencia: null, ou {"tipo":"diaria"}, ou {"tipo":"semanal","dias":[1,3,5]} (0=domingo…6=sábado), ou {"tipo":"mensal","dia":15}.
- Hoje é ${fmtData(dataStr())} (${dataStr()}).

Contexto:
"""
${texto || '(apenas as fotos anexadas)'}
"""`;
}

async function enviarParaClaude() {
  const texto = $('#captura-texto').value.trim();
  if (!texto && !capturaFotos.length) { toast('Cole um texto ou adicione uma foto antes.'); return; }
  const prompt = montarPromptClaude(texto, capturaFotos.length > 0);
  try { await navigator.clipboard.writeText(prompt); } catch { /* segue mesmo assim */ }
  const url = 'https://claude.ai/new?q=' + encodeURIComponent(prompt.slice(0, 6000));
  window.open(url, '_blank');
  toast('Prompt copiado! No claude.ai, selecione o Opus e cole se necessário.');
}

function extrairJson(texto) {
  const bloco = texto.match(/```json\s*([\s\S]*?)```/i);
  if (bloco) { try { return JSON.parse(bloco[1]); } catch { /* tenta abaixo */ } }
  const ini = texto.indexOf('{');
  for (let fim = texto.lastIndexOf('}'); fim > ini && ini >= 0; fim = texto.lastIndexOf('}', fim - 1)) {
    try { return JSON.parse(texto.slice(ini, fim + 1)); } catch { /* tenta menor */ }
  }
  return null;
}

function criarDaResposta() {
  const resposta = $('#captura-resposta').value.trim();
  if (!resposta) { toast('Cole a resposta do Claude primeiro.'); return; }
  const dados = extrairJson(resposta);
  if (!dados || !dados.titulo) { toast('Não encontrei um JSON válido na resposta. Confira o texto colado.'); return; }
  const t = novaTarefaVazia();
  t.titulo = String(dados.titulo).slice(0, 200);
  t.descricao = String(dados.descricao || '');
  if (CATEGORIAS[dados.categoria]) t.categoria = dados.categoria;
  t.urgencia = Math.min(3, Math.max(1, +dados.urgencia || 2));
  t.importancia = Math.min(3, Math.max(1, +dados.importancia || 2));
  if (/^\d{4}-\d{2}-\d{2}$/.test(dados.data_prevista || '')) t.dataPrevista = dados.data_prevista;
  t.tempoEstimado = Math.max(0, +dados.tempo_estimado_minutos || 0);
  t.entregas = (Array.isArray(dados.entregas) ? dados.entregas : [])
    .filter(e => e && e.texto)
    .map(e => ({ texto: String(e.texto), data: /^\d{4}-\d{2}-\d{2}$/.test(e.data || '') ? e.data : '', feita: false }));
  const r = dados.recorrencia;
  if (r && ['diaria', 'semanal', 'mensal'].includes(r.tipo)) {
    t.recorrencia = { tipo: r.tipo };
    if (r.tipo === 'semanal') t.recorrencia.dias = (r.dias || []).filter(d => d >= 0 && d <= 6);
    if (r.tipo === 'mensal') t.recorrencia.dia = Math.min(31, Math.max(1, +r.dia || 1));
  }
  abrirModal(t, { novaPreenchida: true });
  $('#captura-resposta').value = '';
  toast('Confira os campos e salve a demanda.');
}

function salvarCaptura() {
  const texto = $('#captura-texto').value.trim();
  if (!texto && !capturaFotos.length) { toast('Nada para salvar.'); return; }
  gravar({ id: uid(), kind: 'capture', data: dataStr(), texto, fotos: capturaFotos.slice() });
  $('#captura-texto').value = '';
  capturaFotos = [];
  renderCapturaFotos();
  renderCapturas();
  toast('Captura salva.');
}

/* ============================ Modal de demanda ============================ */

function novaTarefaVazia() {
  return {
    id: uid(), kind: 'task', titulo: '', descricao: '',
    categoria: 'trabalho_diario', urgencia: 2, importancia: 2,
    dataPrevista: '', tempoEstimado: 0, entregas: [],
    recorrencia: null, datasConcluidas: [],
    status: 'ativa', criadaEm: new Date().toISOString(),
  };
}

let tarefaEmEdicao = null;

function linhaEntrega(e = { texto: '', data: '', feita: false }) {
  const div = document.createElement('div');
  div.className = 'entrega-form';
  div.innerHTML = `
    <input type="text" class="input" placeholder="Entrega prevista" value="${escaparHtml(e.texto)}" maxlength="200">
    <input type="date" class="input" value="${e.data || ''}">
    <button type="button" class="icon-btn" title="Remover">✕</button>`;
  div.dataset.feita = e.feita ? '1' : '';
  div.querySelector('button').onclick = () => div.remove();
  return div;
}

function abrirModal(tarefa, opcoes = {}) {
  tarefaEmEdicao = tarefa || null;
  const t = tarefa || novaTarefaVazia();
  const editando = !!tarefa && !opcoes.novaPreenchida;
  if (opcoes.novaPreenchida) tarefaEmEdicao = null; // será criada ao salvar

  $('#modal-titulo').textContent = editando ? 'Editar demanda' : 'Nova demanda';
  $('#btn-excluir').hidden = !editando;

  $('#f-titulo').value = t.titulo || '';
  $('#f-descricao').value = t.descricao || '';
  $('#f-categoria').innerHTML = Object.entries(CATEGORIAS)
    .map(([id, c]) => `<option value="${id}" ${t.categoria === id ? 'selected' : ''}>${escaparHtml(c.nome)}</option>`).join('');
  $('#f-urgencia').value = t.urgencia || 2;
  $('#f-importancia').value = t.importancia || 2;
  $('#f-data').value = t.dataPrevista || '';
  $('#f-horas').value = t.tempoEstimado ? Math.floor(t.tempoEstimado / 60) || '' : '';
  $('#f-minutos').value = t.tempoEstimado ? t.tempoEstimado % 60 || '' : '';

  const entregasEl = $('#f-entregas');
  entregasEl.innerHTML = '';
  (t.entregas || []).forEach(e => entregasEl.appendChild(linhaEntrega(e)));

  $('#f-rec-tipo').value = t.recorrencia ? t.recorrencia.tipo : '';
  $$('#f-rec-semanal input').forEach(cb => {
    cb.checked = !!(t.recorrencia && t.recorrencia.tipo === 'semanal' && (t.recorrencia.dias || []).includes(+cb.value));
  });
  $('#f-rec-dia').value = (t.recorrencia && t.recorrencia.dia) || '';
  atualizarCamposRecorrencia();

  // guarda os pré-preenchidos que o formulário não mostra
  $('#form-tarefa').dataset.base = JSON.stringify(opcoes.novaPreenchida ? t : {});

  $('#modal').hidden = false;
  if (!editando) setTimeout(() => $('#f-titulo').focus(), 60);
}

function fecharModal() { $('#modal').hidden = true; tarefaEmEdicao = null; }

function atualizarCamposRecorrencia() {
  const tipo = $('#f-rec-tipo').value;
  $('#f-rec-semanal').hidden = tipo !== 'semanal';
  $('#f-rec-mensal').hidden = tipo !== 'mensal';
}

function salvarFormulario(ev) {
  ev.preventDefault();
  const base = JSON.parse($('#form-tarefa').dataset.base || '{}');
  const t = tarefaEmEdicao || Object.assign(novaTarefaVazia(), base);

  t.titulo = $('#f-titulo').value.trim();
  if (!t.titulo) return;
  t.descricao = $('#f-descricao').value.trim();
  t.categoria = $('#f-categoria').value;
  t.urgencia = +$('#f-urgencia').value;
  t.importancia = +$('#f-importancia').value;
  t.dataPrevista = $('#f-data').value;
  t.tempoEstimado = (+$('#f-horas').value || 0) * 60 + (+$('#f-minutos').value || 0);

  t.entregas = $$('#f-entregas .entrega-form').map(div => ({
    texto: div.querySelector('input[type="text"]').value.trim(),
    data: div.querySelector('input[type="date"]').value,
    feita: div.dataset.feita === '1',
  })).filter(e => e.texto);

  const tipo = $('#f-rec-tipo').value;
  if (!tipo) t.recorrencia = null;
  else {
    t.recorrencia = { tipo };
    if (tipo === 'semanal') {
      t.recorrencia.dias = $$('#f-rec-semanal input:checked').map(cb => +cb.value);
      if (!t.recorrencia.dias.length) { toast('Escolha ao menos um dia da semana.'); return; }
    }
    if (tipo === 'mensal') t.recorrencia.dia = Math.min(31, Math.max(1, +$('#f-rec-dia').value || 1));
  }

  gravar(t);
  fecharModal();
  renderTudo();
  toast('Demanda salva.');
}

/* ============================ Sincronização (Firebase) ============================ */

let fb = null; // { db, auth, user, mods }
let syncPronto = false;

function setSyncStatus(texto, classe) {
  const el = $('#sync-status');
  el.textContent = texto;
  el.className = 'sync-status' + (classe ? ' ' + classe : '');
}

function configFirebase() {
  try { return JSON.parse(localStorage.getItem(FB_KEY)) || null; } catch { return null; }
}

async function iniciarFirebase() {
  const cfg = configFirebase();
  renderAjustes();
  if (!cfg) { setSyncStatus('local'); return; }
  setSyncStatus('conectando…');
  try {
    const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
    const [appM, authM, fsM] = await Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-auth.js'),
      import(base + 'firebase-firestore.js'),
    ]);
    const app = appM.initializeApp(cfg);
    const auth = authM.getAuth(app);
    const db = fsM.getFirestore(app);
    fb = { app, auth, db, user: null, mods: { authM, fsM } };

    authM.onAuthStateChanged(auth, (user) => {
      fb.user = user;
      renderAjustes();
      if (user) conectarFirestore();
      else setSyncStatus('sem login', 'erro');
    });
    // trata retorno do login por redirect (celular)
    authM.getRedirectResult(auth).catch(() => {});
  } catch (e) {
    console.error('Firebase:', e);
    setSyncStatus('erro config', 'erro');
    toast('Não consegui iniciar o Firebase. Confira a configuração em Ajustes.');
  }
}

async function loginGoogle() {
  if (!fb) return;
  const { authM } = fb.mods;
  const provider = new authM.GoogleAuthProvider();
  try {
    await authM.signInWithPopup(fb.auth, provider);
  } catch (e) {
    // popups costumam falhar no celular — tenta redirect
    try { await authM.signInWithRedirect(fb.auth, provider); }
    catch (e2) { console.error(e2); toast('Falha no login: ' + (e2.code || e2.message)); }
  }
}

function colecaoItens() {
  const { fsM } = fb.mods;
  return fsM.collection(fb.db, 'users', fb.user.uid, 'items');
}

async function conectarFirestore() {
  const { fsM } = fb.mods;
  setSyncStatus('sincronizando…');
  try {
    // 1) puxa tudo e mescla por updatedAt (o mais novo vence)
    const snap = await fsM.getDocs(colecaoItens());
    const remotos = {};
    snap.forEach(d => { remotos[d.id] = d.data(); });
    for (const [id, rem] of Object.entries(remotos)) {
      if (!itens[id] || (rem.updatedAt || 0) > (itens[id].updatedAt || 0)) itens[id] = rem;
    }
    salvarLocal();
    // 2) envia o que só existe (ou é mais novo) localmente
    for (const item of Object.values(itens)) {
      const rem = remotos[item.id];
      if (!rem || (item.updatedAt || 0) > (rem.updatedAt || 0)) {
        await fsM.setDoc(fsM.doc(colecaoItens(), item.id), item);
      }
    }
    // 3) escuta mudanças de outros aparelhos
    fsM.onSnapshot(colecaoItens(), (snap2) => {
      let mudou = false;
      snap2.docChanges().forEach(ch => {
        if (ch.doc.metadata.hasPendingWrites) return;
        const rem = ch.doc.data();
        if (!itens[rem.id] || (rem.updatedAt || 0) > (itens[rem.id].updatedAt || 0)) {
          itens[rem.id] = rem; mudou = true;
        }
      });
      if (mudou) { salvarLocal(); renderTudo(); }
    });
    syncPronto = true;
    setSyncStatus('☁ sincronizado', 'on');
  } catch (e) {
    console.error('Firestore:', e);
    setSyncStatus('erro sync', 'erro');
    toast('Erro ao sincronizar: ' + (e.code || e.message));
  }
}

async function syncEnviar(item) {
  if (!syncPronto || !fb || !fb.user) return;
  try {
    const { fsM } = fb.mods;
    await fsM.setDoc(fsM.doc(colecaoItens(), item.id), item);
  } catch (e) { console.error('syncEnviar:', e); setSyncStatus('erro sync', 'erro'); }
}

function renderAjustes() {
  const cfg = configFirebase();
  $('#sync-config-wrap').hidden = !!cfg;
  $('#sync-conta-wrap').hidden = !cfg;
  if (cfg) {
    const user = fb && fb.user;
    $('#sync-conta-info').textContent = user
      ? `Conectado como ${user.email || user.displayName}. Seus dados sincronizam automaticamente.`
      : 'Configuração salva. Entre com sua conta Google para sincronizar.';
    $('#btn-login').hidden = !!user;
    $('#btn-logout').hidden = !user;
  }
}

/* ============================ Backup ============================ */

function exportarDados() {
  const blob = new Blob([JSON.stringify(itens, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `planejador-backup-${dataStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importarDados(file) {
  const leitor = new FileReader();
  leitor.onload = () => {
    try {
      const dados = JSON.parse(leitor.result);
      let n = 0;
      for (const [id, item] of Object.entries(dados)) {
        if (!item || !item.kind) continue;
        if (!itens[id] || (item.updatedAt || 0) > (itens[id].updatedAt || 0)) {
          itens[id] = item; n++;
          syncEnviar(item);
        }
      }
      salvarLocal();
      renderTudo();
      toast(`Importados ${n} itens.`);
    } catch { toast('Arquivo inválido.'); }
  };
  leitor.readAsText(file);
}

/* ============================ Navegação e eventos ============================ */

let viewAtual = 'hoje';

function mostrarView(nome) {
  viewAtual = nome;
  $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + nome; });
  $$('.tab').forEach(t => t.classList.toggle('ativo', t.dataset.view === nome));
  $('#btn-nova').hidden = ['ajustes', 'capturar'].includes(nome);
  renderTudo();
  window.scrollTo(0, 0);
}

function renderTudo() {
  if (viewAtual === 'hoje') renderHoje();
  else if (viewAtual === 'semana') renderSemana();
  else if (viewAtual === 'mes') renderMes();
  else if (viewAtual === 'demandas') renderDemandas();
  else if (viewAtual === 'diario') renderDiario();
  else if (viewAtual === 'capturar') { renderCapturaFotos(); renderCapturas(); }
  else if (viewAtual === 'ajustes') renderAjustes();
}

function aplicarTema() {
  const t = localStorage.getItem(THEME_KEY);
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

function ligarEventos() {
  $$('.tab').forEach(t => t.onclick = () => mostrarView(t.dataset.view));
  $('#btn-settings').onclick = () => mostrarView('ajustes');
  $('#btn-theme').onclick = () => {
    const atual = localStorage.getItem(THEME_KEY);
    const prox = atual === 'dark' ? 'light' : atual === 'light' ? '' : 'dark';
    if (prox) localStorage.setItem(THEME_KEY, prox); else localStorage.removeItem(THEME_KEY);
    aplicarTema();
    toast('Tema: ' + (prox === 'dark' ? 'escuro' : prox === 'light' ? 'claro' : 'automático'));
  };

  // navegação de datas
  $$('[data-daynav]').forEach(b => b.onclick = () => { dataHoje = addDias(dataHoje, +b.dataset.daynav); renderHoje(); });
  $$('[data-weeknav]').forEach(b => b.onclick = () => { semanaInicio = addDias(semanaInicio, 7 * +b.dataset.weeknav); renderSemana(); });
  $$('[data-monthnav]').forEach(b => b.onclick = () => {
    mesNum += +b.dataset.monthnav;
    if (mesNum < 0) { mesNum = 11; mesAno--; }
    if (mesNum > 11) { mesNum = 0; mesAno++; }
    renderMes();
  });
  $$('[data-diarionav]').forEach(b => b.onclick = () => { diarioData = addDias(diarioData, +b.dataset.diarionav); renderDiario(); });

  // diários com salvamento automático
  const salvarNotaHoje = debounce(() => {
    const j = diarioDe(dataHoje); j.nota = $('#hoje-diario').value; gravar(j);
  }, 700);
  $('#hoje-diario').oninput = salvarNotaHoje;
  const salvarNotaDiario = debounce(() => {
    const j = diarioDe(diarioData); j.nota = $('#diario-nota').value; gravar(j);
  }, 700);
  $('#diario-nota').oninput = salvarNotaDiario;

  // demandas
  $('#filtro-busca').oninput = debounce(renderDemandas, 250);
  $('#filtro-status').onchange = renderDemandas;
  $('#ordenacao').onchange = renderDemandas;
  $('#btn-matriz').onclick = () => { mostrarMatriz = !mostrarMatriz; renderDemandas(); };

  // modal
  $('#btn-nova').onclick = () => abrirModal(null);
  $('#modal-fechar').onclick = fecharModal;
  $('#btn-cancelar').onclick = fecharModal;
  $('#modal').onclick = (ev) => { if (ev.target === $('#modal')) fecharModal(); };
  $('#form-tarefa').onsubmit = salvarFormulario;
  $('#f-rec-tipo').onchange = atualizarCamposRecorrencia;
  $('#btn-add-entrega').onclick = () => $('#f-entregas').appendChild(linhaEntrega());
  $('#btn-excluir').onclick = () => {
    if (tarefaEmEdicao && confirm('Excluir esta demanda?')) {
      excluirItem(tarefaEmEdicao.id);
      fecharModal();
      renderTudo();
      toast('Demanda excluída.');
    }
  };

  // capturar
  $('#captura-foto-input').onchange = async (ev) => {
    for (const f of ev.target.files) {
      try { capturaFotos.push(await redimensionarFoto(f)); }
      catch { toast('Não consegui ler uma das fotos.'); }
    }
    ev.target.value = '';
    renderCapturaFotos();
  };
  $('#btn-enviar-claude').onclick = enviarParaClaude;
  $('#btn-salvar-captura').onclick = salvarCaptura;
  $('#btn-criar-da-resposta').onclick = criarDaResposta;

  // ajustes
  $('#btn-salvar-firebase').onclick = () => {
    const texto = $('#firebase-config').value.trim();
    try {
      // aceita tanto JSON puro quanto o trecho "const firebaseConfig = {...}"
      const m = texto.match(/\{[\s\S]*\}/);
      const cfg = JSON.parse(m ? m[0].replace(/(\w+)\s*:/g, '"$1":').replace(/'/g, '"').replace(/,\s*}/g, '}') : texto);
      if (!cfg.apiKey || !cfg.projectId) throw new Error('faltam campos');
      localStorage.setItem(FB_KEY, JSON.stringify(cfg));
      toast('Configuração salva. Iniciando…');
      iniciarFirebase();
    } catch { toast('Configuração inválida. Cole o objeto firebaseConfig completo.'); }
  };
  $('#btn-remover-firebase').onclick = () => {
    if (confirm('Remover a configuração do Firebase deste aparelho? (os dados locais permanecem)')) {
      localStorage.removeItem(FB_KEY);
      location.reload();
    }
  };
  $('#btn-login').onclick = loginGoogle;
  $('#btn-logout').onclick = async () => { if (fb) { await fb.mods.authM.signOut(fb.auth); syncPronto = false; setSyncStatus('sem login', 'erro'); } };
  $('#btn-exportar').onclick = exportarDados;
  $('#importar-input').onchange = (ev) => { if (ev.target.files[0]) importarDados(ev.target.files[0]); ev.target.value = ''; };
}

/* ============================ Início ============================ */

aplicarTema();
carregarLocal();
ligarEventos();
mostrarView('hoje');
iniciarFirebase();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

})();

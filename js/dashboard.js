// js/dashboard.js — Métricas Financeiras e Gestão do Fundo de Reserva

import { state, salvarLocal } from './state.js';
import { formatarMoedaExibicao, mostrarToast, abrirModal, fecharModalAtual, refreshIcons } from './utils.js';

export function renderizarDashboard() {
  let faturamento = 0;
  let custo = 0;
  let lucro = 0;
  let reservaAcumulada = 0;
  let hojeReserva = 0;
  const operadoresCount = {};

  const hojeStr = new Date().toISOString().split('T')[0];

  state.vendas.forEach(v => {
    faturamento += v.valor_total;
    custo += v.custo_total;
    lucro += v.lucro_bruto;
    reservaAcumulada += v.valor_reserva_30;

    if (v.created_at.startsWith(hojeStr)) {
      hojeReserva += v.valor_reserva_30;
    }

    const op = v.operador || 'Não identificado';
    operadoresCount[op] = (operadoresCount[op] || 0) + 1;
  });

  const kpiFat = document.getElementById('kpiFaturamento');
  const kpiCusto = document.getElementById('kpiCusto');
  const kpiLucro = document.getElementById('kpiLucro');
  const resAcum = document.getElementById('reservaAcumuladaVal');
  const sepHoje = document.getElementById('separarHojeVal');
  const metaTxt = document.getElementById('metaReservaVal');
  const pctTag = document.getElementById('tagPercentualReserva');

  if (kpiFat) kpiFat.innerText = `R$ ${formatarMoedaExibicao(faturamento)}`;
  if (kpiCusto) kpiCusto.innerText = `R$ ${formatarMoedaExibicao(custo)}`;
  if (kpiLucro) kpiLucro.innerText = `R$ ${formatarMoedaExibicao(lucro)}`;
  if (resAcum) resAcum.innerText = `R$ ${formatarMoedaExibicao(reservaAcumulada)}`;
  if (sepHoje) sepHoje.innerText = `R$ ${formatarMoedaExibicao(hojeReserva)}`;
  if (metaTxt) metaTxt.innerText = `R$ ${formatarMoedaExibicao(state.config.tetoReserva)}`;
  if (pctTag) pctTag.innerText = `${state.config.percentualReserva}%`;

  // Barra de progresso da Reserva
  const teto = state.config.tetoReserva || 1500;
  const pct = Math.min(100, Math.round((reservaAcumulada / teto) * 100));
  const fill = document.getElementById('reserveProgressFill');
  const pctLabel = document.getElementById('reservePct');
  if (fill) fill.style.width = `${pct}%`;
  if (pctLabel) pctLabel.innerText = `${pct}%`;

  // Renderiza contagem dinâmica de operadores
  const opContainer = document.getElementById('vendasPorOperadorContainer');
  if (opContainer) {
    const entries = Object.entries(operadoresCount);
    if (entries.length === 0) {
      opContainer.innerHTML = '<span style="color: var(--text-muted);">Nenhuma venda registrada ainda.</span>';
    } else {
      opContainer.innerHTML = entries.map(([nome, qtd]) => `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="display: flex; align-items: center; gap: 6px;"><i data-lucide="user" style="width: 14px; height: 14px; color: var(--text-muted);"></i> ${nome}</span>
          <strong>${qtd} ${qtd === 1 ? 'venda' : 'vendas'}</strong>
        </div>
      `).join('');
    }
  }

  refreshIcons();
}

export function abrirModalConfigReserva() {
  const inputMeta = document.getElementById('inputMetaReserva');
  const inputPct = document.getElementById('inputPctReserva');

  if (inputMeta) inputMeta.value = state.config.tetoReserva;
  if (inputPct) inputPct.value = state.config.percentualReserva;

  abrirModal('modalConfigReserva');
}

export function salvarConfigReserva() {
  const meta = parseFloat(document.getElementById('inputMetaReserva').value) || 1500;
  const pct = parseFloat(document.getElementById('inputPctReserva').value) || 30;

  if (meta <= 0 || pct <= 0 || pct > 100) {
    mostrarToast('Valores de meta ou porcentagem inválidos.');
    return;
  }

  state.config.tetoReserva = meta;
  state.config.percentualReserva = pct;
  salvarLocal();
  fecharModalAtual();
  mostrarToast('Parâmetros do Fundo de Reserva atualizados!');
  renderizarDashboard();

  if (state.supabase) {
    (async () => {
      try {
        await state.supabase.from('casa_configuracoes').upsert({
          chave: 'fundo_reserva',
          valor: state.config,
          updated_at: new Date().toISOString()
        });
      } catch (err) {
        console.warn('[Sync] Erro ao sincronizar meta de reserva:', err);
      }
    })();
  }
}

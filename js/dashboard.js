import { state, salvarLocal, enfileirarMutacao } from './state.js';
import { formatarMoedaExibicao, parseMonetaryValue, mostrarToast, abrirModal, fecharModalAtual, refreshIcons } from './utils.js';
import { processarOutbox, logSync } from './sync_engine.js';

export function renderizarDashboard() {
  let faturamento = 0;
  let custo = 0;
  let lucro = 0;
  let reservaAcumulada = 0;
  let hojeReserva = 0;
  let hojeLucro = 0;
  let totalUnidades = 0;
  const operadoresCount = {};

  const hojeStr = new Date().toISOString().split('T')[0];

  state.vendas.forEach(v => {
    faturamento += v.valor_total;
    custo += v.custo_total;
    lucro += v.lucro_bruto;
    reservaAcumulada += v.valor_reserva_30;
    totalUnidades += (v.quantidade || 1);

    if (v.created_at && v.created_at.startsWith(hojeStr)) {
      hojeReserva += v.valor_reserva_30;
      hojeLucro += v.lucro_bruto;
    }

    const op = v.operador || 'Não identificado';
    operadoresCount[op] = (operadoresCount[op] || 0) + 1;
  });

  const totalVendas = state.vendas.length;
  const ticketMedio = totalVendas > 0 ? (faturamento / totalVendas) : 0;
  const upv = totalVendas > 0 ? (totalUnidades / totalVendas) : 0;

  // Atualização dos KPIs Básicos
  const kpiFat = document.getElementById('kpiFaturamento');
  const kpiCusto = document.getElementById('kpiCusto');
  const kpiLucro = document.getElementById('kpiLucro');
  const kpiTicket = document.getElementById('kpiTicketMedio');
  const kpiUpvElem = document.getElementById('kpiUpv');
  const resAcum = document.getElementById('reservaAcumuladaVal');
  const sepHoje = document.getElementById('separarHojeVal');
  const metaTxt = document.getElementById('metaReservaVal');
  const pctTag = document.getElementById('tagPercentualReserva');

  if (kpiFat) kpiFat.innerText = `R$ ${formatarMoedaExibicao(faturamento)}`;
  if (kpiCusto) kpiCusto.innerText = `R$ ${formatarMoedaExibicao(custo)}`;
  if (kpiLucro) kpiLucro.innerText = `R$ ${formatarMoedaExibicao(lucro)}`;
  if (kpiTicket) kpiTicket.innerText = `R$ ${formatarMoedaExibicao(ticketMedio)}`;
  if (kpiUpvElem) kpiUpvElem.innerText = `${upv.toFixed(1).replace('.', ',')} un`;
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

  // --- PONTO DE EQUILÍBRIO OPERACIONAL ---
  renderizarPontoEquilibrio(hojeLucro);

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

function renderizarPontoEquilibrio(hojeLucro) {
  const custosCfg = state.config.custosFixos || { itens: [], diasUteisMes: 26 };
  const itens = Array.isArray(custosCfg.itens) ? custosCfg.itens : [];
  const diasUteis = Math.max(1, parseInt(custosCfg.diasUteisMes, 10) || 26);
  
  const totalMensal = itens.reduce((acc, it) => acc + (parseFloat(it.valor) || 0), 0);
  const metaDiaria = diasUteis > 0 ? (totalMensal / diasUteis) : 0;

  const lblMetaDia = document.getElementById('equilibrioMetaDiaVal');
  const lblLucroHoje = document.getElementById('equilibrioLucroHojeVal');
  const lblPct = document.getElementById('equilibrioPctVal');
  const fillBar = document.getElementById('equilibrioProgressFill');
  const statusPill = document.getElementById('tagStatusEquilibrio');
  const statusBox = document.getElementById('boxEquilibrioStatusTxt');
  const statusMsg = document.getElementById('equilibrioMensagemTxt');
  const statusIcon = document.getElementById('equilibrioStatusIcon');

  if (lblMetaDia) lblMetaDia.innerText = `R$ ${formatarMoedaExibicao(metaDiaria)}`;
  if (lblLucroHoje) lblLucroHoje.innerText = `R$ ${formatarMoedaExibicao(hojeLucro)}`;

  if (totalMensal === 0) {
    if (lblPct) lblPct.innerText = '0%';
    if (fillBar) {
      fillBar.style.width = '0%';
      fillBar.className = 'equilibrio-progress-fill status-red';
    }
    if (statusPill) {
      statusPill.innerText = 'Não configurado';
      statusPill.className = 'equilibrio-status-pill pendente';
    }
    if (statusBox) statusBox.className = 'equilibrio-status-card pendente';
    if (statusMsg) statusMsg.innerText = 'Cadastre suas despesas fixas para monitorar o ponto de equilíbrio do dia.';
    if (statusIcon) statusIcon.setAttribute('data-lucide', 'info');
  } else if (hojeLucro >= metaDiaria && metaDiaria > 0) {
    const superavit = hojeLucro - metaDiaria;
    const pctCalculado = Math.round((hojeLucro / metaDiaria) * 100);

    if (lblPct) lblPct.innerText = `${pctCalculado}%`;
    if (fillBar) {
      fillBar.style.width = '100%';
      fillBar.className = 'equilibrio-progress-fill status-green';
    }
    if (statusPill) {
      statusPill.innerText = 'Atingido';
      statusPill.className = 'equilibrio-status-pill atingido';
    }
    if (statusBox) statusBox.className = 'equilibrio-status-card atingido';
    if (statusMsg) {
      statusMsg.innerText = superavit > 0
        ? `Equilíbrio superado! Lucro livre apurado hoje: +R$ ${formatarMoedaExibicao(superavit)}.`
        : 'Ponto de equilíbrio atingido hoje! Contas do dia 100% cobertas.';
    }
    if (statusIcon) statusIcon.setAttribute('data-lucide', 'check-circle-2');
  } else {
    const falta = metaDiaria - hojeLucro;
    const pctCalculado = metaDiaria > 0 ? Math.min(99, Math.round((hojeLucro / metaDiaria) * 100)) : 0;
    const isParcial = pctCalculado >= 50;

    if (lblPct) lblPct.innerText = `${pctCalculado}%`;
    if (fillBar) {
      fillBar.style.width = `${pctCalculado}%`;
      fillBar.className = `equilibrio-progress-fill ${isParcial ? 'status-green' : 'status-red'}`;
    }
    if (statusPill) {
      statusPill.innerText = isParcial ? 'Parcial' : 'Pendente';
      statusPill.className = `equilibrio-status-pill ${isParcial ? 'parcial' : 'pendente'}`;
    }
    if (statusBox) statusBox.className = `equilibrio-status-card ${isParcial ? 'parcial' : 'pendente'}`;
    if (statusMsg) {
      statusMsg.innerText = `Falta R$ ${formatarMoedaExibicao(falta)} em lucro bruto hoje para cobrir o custo fixo diário.`;
    }
    if (statusIcon) statusIcon.setAttribute('data-lucide', isParcial ? 'alert-circle' : 'info');
  }
}

// --- MODAL DE CONFIGURAÇÃO DE RESERVA ---
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

  enfileirarMutacao('CONFIG_UPSERT', 'configuracoes', 'fundo_reserva', {
    chave: 'fundo_reserva',
    valor: {
      tetoReserva: meta,
      percentualReserva: pct
    }
  });

  logSync('LOCAL', 'Parâmetros de reserva salvos localmente e enfileirados.');
  processarOutbox();
}

// --- MODAL DE PONTO DE EQUILÍBRIO & CUSTOS FIXOS ---
export function abrirModalConfigEquilibrio() {
  if (!state.config.custosFixos) {
    state.config.custosFixos = { itens: [], diasUteisMes: 26 };
  }

  const inputDias = document.getElementById('inputDiasUteisMes');
  if (inputDias) {
    inputDias.value = state.config.custosFixos.diasUteisMes || 26;
  }

  const inputNome = document.getElementById('inputNomeCustoFixo');
  const inputValor = document.getElementById('inputValorCustoFixo');
  if (inputNome) inputNome.value = '';
  if (inputValor) inputValor.value = '';

  renderizarListaCustosFixosModal();
  abrirModal('modalConfigEquilibrio');
}

export function renderizarListaCustosFixosModal() {
  const container = document.getElementById('listaCustosFixosContainer');
  if (!container) return;

  const itens = (state.config.custosFixos && Array.isArray(state.config.custosFixos.itens))
    ? state.config.custosFixos.itens
    : [];

  const diasUteis = state.config.custosFixos?.diasUteisMes || 26;
  const totalMensal = itens.reduce((acc, it) => acc + (parseFloat(it.valor) || 0), 0);
  const metaDiaria = diasUteis > 0 ? (totalMensal / diasUteis) : 0;

  const lblTotal = document.getElementById('modalTotalCustosFixos');
  const lblMeta = document.getElementById('modalMetaDiariaEquilibrio');
  if (lblTotal) lblTotal.innerText = `R$ ${formatarMoedaExibicao(totalMensal)}`;
  if (lblMeta) lblMeta.innerText = `R$ ${formatarMoedaExibicao(metaDiaria)}`;

  if (itens.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 14px; color: var(--text-muted); font-size: 12.5px;">
        Nenhuma despesa fixa cadastrada ainda.
      </div>
    `;
    return;
  }

  container.innerHTML = itens.map(it => `
    <div class="custo-item-row" data-id="${it.id}">
      <div class="custo-item-info">
        <span class="custo-item-nome">${it.nome}</span>
        <span class="custo-item-valor">R$ ${formatarMoedaExibicao(it.valor)}</span>
      </div>
      <button type="button" class="btn-remover-custo" data-id="${it.id}" title="Remover Despesa">
        <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
      </button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-remover-custo').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      removerItemCustoFixo(id);
    });
  });

  refreshIcons();
}

export function adicionarItemCustoFixo() {
  const inputNome = document.getElementById('inputNomeCustoFixo');
  const inputValor = document.getElementById('inputValorCustoFixo');

  const nome = inputNome ? inputNome.value.trim() : '';
  const valor = parseMonetaryValue(inputValor ? inputValor.value : '');

  if (!nome) {
    mostrarToast('Por favor, informe a descrição da despesa (ex: Aluguel).');
    inputNome?.focus();
    return;
  }

  if (valor <= 0) {
    mostrarToast('Por favor, informe um valor válido para a despesa.');
    inputValor?.focus();
    return;
  }

  if (!state.config.custosFixos) {
    state.config.custosFixos = { itens: [], diasUteisMes: 26 };
  }
  if (!Array.isArray(state.config.custosFixos.itens)) {
    state.config.custosFixos.itens = [];
  }

  const novoItem = {
    id: `cf_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    nome,
    valor
  };

  state.config.custosFixos.itens.push(novoItem);
  salvarLocal();
  sincronizarCustosFixosNuvem();

  if (inputNome) inputNome.value = '';
  if (inputValor) inputValor.value = '';
  inputNome?.focus();

  mostrarToast(`Despesa "${nome}" adicionada!`);
  renderizarListaCustosFixosModal();
  renderizarDashboard();
}

export function removerItemCustoFixo(id) {
  if (!state.config.custosFixos || !Array.isArray(state.config.custosFixos.itens)) return;

  const itemRemovido = state.config.custosFixos.itens.find(it => it.id === id);
  state.config.custosFixos.itens = state.config.custosFixos.itens.filter(it => it.id !== id);
  salvarLocal();
  sincronizarCustosFixosNuvem();

  mostrarToast(itemRemovido ? `Despesa "${itemRemovido.nome}" removida.` : 'Despesa removida.');
  renderizarListaCustosFixosModal();
  renderizarDashboard();
}

export function atualizarDiasUteisMes(val) {
  const dias = Math.max(1, Math.min(31, parseInt(val, 10) || 26));
  if (!state.config.custosFixos) {
    state.config.custosFixos = { itens: [], diasUteisMes: dias };
  } else {
    state.config.custosFixos.diasUteisMes = dias;
  }

  salvarLocal();
  sincronizarCustosFixosNuvem();
  renderizarListaCustosFixosModal();
  renderizarDashboard();
}

function sincronizarCustosFixosNuvem() {
  enfileirarMutacao('CONFIG_UPSERT', 'configuracoes', 'custos_fixos', {
    chave: 'custos_fixos',
    valor: state.config.custosFixos
  });
  logSync('LOCAL', 'Configuração de custos fixos salva localmente e enfileirada.');
  processarOutbox();
}


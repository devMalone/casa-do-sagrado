// js/vendas.js — Registro de Vendas Rápidas e Histórico

import { state, salvarLocal } from './state.js';
import { formatarMoedaExibicao, mostrarToast, abrirModal, fecharModalAtual, refreshIcons, pedirConfirmacao } from './utils.js';

let onVendaRealizadaCallback = null;

export function setOnVendaRealizadaCallback(fn) {
  onVendaRealizadaCallback = fn;
}

export function iniciarVendaRapida(produtoId) {
  const prod = state.produtos.find(p => p.id === produtoId);
  if (!prod || prod.estoque_atual <= 0) return;

  state.vendaEmAndamento = {
    produto: prod,
    quantidade: 1
  };

  document.getElementById('vendaProdNome').innerText = prod.nome;
  document.getElementById('vendaPrecoUnit').innerText = `R$ ${formatarMoedaExibicao(prod.preco_venda)}`;
  document.getElementById('vendaQtdVal').innerText = '1';
  document.getElementById('vendaTotalFinal').innerText = `R$ ${formatarMoedaExibicao(prod.preco_venda)}`;
  
  abrirModal('modalVendaRapida');
}

export function ajustarQtdVenda(delta) {
  if (!state.vendaEmAndamento) return;
  let novaQtd = state.vendaEmAndamento.quantidade + delta;
  if (novaQtd < 1) novaQtd = 1;
  if (novaQtd > state.vendaEmAndamento.produto.estoque_atual) {
    mostrarToast('Quantidade máxima disponível atingida.');
    return;
  }
  state.vendaEmAndamento.quantidade = novaQtd;
  document.getElementById('vendaQtdVal').innerText = novaQtd;
  const total = novaQtd * state.vendaEmAndamento.produto.preco_venda;
  document.getElementById('vendaTotalFinal').innerText = `R$ ${formatarMoedaExibicao(total)}`;
}

export function selecionarMetodoPgto(metodo, elem) {
  state.metodoPgtoSelecionado = metodo;
  document.querySelectorAll('.payment-methods .pay-btn').forEach(b => b.classList.remove('active'));
  elem.classList.add('active');
}

export async function confirmarVendaFinal() {
  if (!state.vendaEmAndamento) return;

  const p = state.vendaEmAndamento.produto;
  const qtd = state.vendaEmAndamento.quantidade;
  const valTotal = qtd * p.preco_venda;
  const custoTot = qtd * p.preco_custo;
  const lucroBruto = valTotal - custoTot;
  
  // Percentual configurável de reserva (padrão 30%)
  const pctReserva = (state.config.percentualReserva || 30) / 100;
  const reservaCalculada = lucroBruto * pctReserva;

  // 1. Decrementa estoque localmente (Local-First)
  p.estoque_atual -= qtd;

  // 2. Cria registro de venda
  const novaVenda = {
    id: crypto.randomUUID(),
    produto_id: p.id,
    nome_produto: p.nome,
    quantidade: qtd,
    valor_unitario: p.preco_venda,
    valor_total: valTotal,
    custo_total: custoTot,
    lucro_bruto: lucroBruto,
    valor_reserva_30: reservaCalculada,
    metodo_pagamento: state.metodoPgtoSelecionado,
    operador: state.operador || 'Operador',
    created_at: new Date().toISOString()
  };

  state.vendas.unshift(novaVenda);
  salvarLocal();

  // Feedback tátil
  if (navigator.vibrate) navigator.vibrate(50);

  fecharModalAtual();
  mostrarToast(`Venda de R$ ${formatarMoedaExibicao(valTotal)} registrada!`);
  
  if (onVendaRealizadaCallback) onVendaRealizadaCallback();

  // 3. Sincroniza com Supabase
  if (state.supabase) {
    state.supabase.rpc('casa_dar_baixa_venda', {
      p_produto_id: p.id,
      p_qtd: qtd
    }).catch(err => console.warn('[Sync] Baixa nuvem erro:', err));

    state.supabase.from('casa_vendas').insert([novaVenda])
      .then(() => console.log('[Sync] Venda sincronizada com sucesso'))
      .catch(err => console.warn('[Sync] Venda nuvem erro:', err));
  }
}

export function renderizarHistoricoVendas() {
  const container = document.getElementById('salesListContainer');
  if (!container) return;
  container.innerHTML = '';

  const contador = document.getElementById('vendasTotalContador');
  if (contador) contador.innerText = `${state.vendas.length} vendas registradas`;

  if (state.vendas.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <i data-lucide="receipt" style="width: 48px; height: 48px; margin-bottom: 10px; opacity: 0.5;"></i>
        <p>Nenhuma venda registrada ainda.</p>
      </div>`;
    refreshIcons();
    return;
  }

  state.vendas.forEach(v => {
    const dataFormatada = new Date(v.created_at).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    const prodAtual = state.produtos.find(p => p.id === v.produto_id);
    const nomeExibicao = prodAtual ? prodAtual.nome : (v.nome_produto || 'Produto');

    const item = document.createElement('div');
    item.className = 'sale-item';
    item.innerHTML = `
      <div class="sale-info">
        <div class="sale-prod">${v.quantidade}x ${nomeExibicao}</div>
        <div class="sale-meta">
          <span>${dataFormatada}</span>
          <span>•</span>
          <span style="display: inline-flex; align-items: center; gap: 3px;"><i data-lucide="user" style="width: 11px; height: 11px;"></i> ${v.operador}</span>
          <span>•</span>
          <span>${v.metodo_pagamento}</span>
        </div>
      </div>
      <div class="sale-right-area">
        <div class="sale-amount">
          <div class="sale-val">R$ ${formatarMoedaExibicao(v.valor_total)}</div>
          <div class="sale-reserve">Reserva: +R$ ${formatarMoedaExibicao(v.valor_reserva_30)}</div>
        </div>
        <button type="button" class="btn-undo-sale" data-id="${v.id}" title="Desfazer / Estornar Venda">
          <i data-lucide="rotate-ccw" style="width: 13px; height: 13px;"></i>
        </button>
      </div>
    `;

    const btnUndo = item.querySelector('.btn-undo-sale');
    btnUndo?.addEventListener('click', () => estornarVenda(v.id));

    container.appendChild(item);
  });

  refreshIcons();
}

export async function estornarVenda(vendaId) {
  const venda = state.vendas.find(v => v.id === vendaId);
  if (!venda) return;

  const prodAtual = state.produtos.find(p => p.id === venda.produto_id);
  const nomeExibicao = prodAtual ? prodAtual.nome : (venda.nome_produto || 'Produto');

  const confirmou = await pedirConfirmacao({
    titulo: 'Desfazer Venda?',
    mensagem: `Deseja realmente desfazer a venda de ${venda.quantidade}x "${nomeExibicao}" (R$ ${formatarMoedaExibicao(venda.valor_total)})? A quantidade será devolvida ao estoque.`,
    textoConfirmar: 'Sim, Desfazer Venda',
    perigo: true
  });

  if (!confirmou) return;

  // 1. Devolve estoque ao produto
  if (prodAtual) {
    prodAtual.estoque_atual = (parseInt(prodAtual.estoque_atual, 10) || 0) + venda.quantidade;
    if (state.supabase) {
      state.supabase.from('casa_produtos')
        .update({ estoque_atual: prodAtual.estoque_atual, updated_at: new Date().toISOString() })
        .eq('id', prodAtual.id)
        .catch(err => console.warn('[Sync] Erro ao devolver estoque no Supabase:', err));
    }
  }

  // 2. Remove do histórico local
  state.vendas = state.vendas.filter(v => v.id !== vendaId);
  salvarLocal();

  // 3. Remove do banco de dados na nuvem
  if (state.supabase) {
    state.supabase.from('casa_vendas')
      .delete()
      .eq('id', vendaId)
      .catch(err => console.warn('[Sync] Erro ao estornar venda no Supabase:', err));
  }

  // 4. Feedback e re-renderização completa
  if (navigator.vibrate) navigator.vibrate(40);
  mostrarToast(`Venda desfeita! ${venda.quantidade}x "${nomeExibicao}" devolvido ao estoque.`);

  if (onVendaRealizadaCallback) {
    onVendaRealizadaCallback();
  }
}

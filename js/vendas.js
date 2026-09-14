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
  if (contador) contador.innerText = `${state.vendas.length} ${state.vendas.length === 1 ? 'venda registrada' : 'vendas registradas'}`;

  const btnLimpar = document.getElementById('btnLimparVendas');
  if (btnLimpar) {
    btnLimpar.style.display = state.vendas.length > 0 ? 'inline-flex' : 'none';
  }

  if (state.vendas.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <i data-lucide="receipt" style="width: 48px; height: 48px; margin-bottom: 10px; opacity: 0.5;"></i>
        <p>Nenhuma venda registrada ainda.</p>
      </div>`;
    refreshIcons();
    return;
  }

  state.vendas.forEach((v, index) => {
    if (!v.id) {
      v.id = `venda_${Date.now()}_${index}`;
    }

    const dataFormatada = new Date(v.created_at).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    const prodAtual = state.produtos.find(p => p.id === v.produto_id);
    const nomeExibicao = prodAtual ? prodAtual.nome : (v.nome_produto || 'Produto');
    const metodoPgto = v.metodo_pagamento || 'Outro';

    const item = document.createElement('div');
    item.className = 'sale-item';
    item.setAttribute('data-sale-id', v.id);
    item.innerHTML = `
      <div class="sale-top-row">
        <div class="sale-prod">${v.quantidade}x ${nomeExibicao}</div>
        <div class="sale-top-right">
          <span class="sale-val">R$ ${formatarMoedaExibicao(v.valor_total)}</span>
          <button type="button" class="btn-undo-sale" data-id="${v.id}" data-index="${index}" title="Estornar esta venda">
            <i data-lucide="rotate-ccw" style="width: 12px; height: 12px;"></i>
            <span>Estornar</span>
          </button>
        </div>
      </div>
      <div class="sale-bottom-row">
        <div class="sale-meta">
          <span>${dataFormatada}</span>
          <span>•</span>
          <span class="sale-operator"><i data-lucide="user" style="width: 11px; height: 11px;"></i> ${v.operador || 'Operador'}</span>
        </div>
        <div class="sale-bottom-right">
          <span class="sale-pay-badge">${metodoPgto}</span>
          <span class="sale-reserve">Reserva: +R$ ${formatarMoedaExibicao(v.valor_reserva_30)}</span>
        </div>
      </div>
    `;

    const btnUndo = item.querySelector('.btn-undo-sale');
    let confirmTimer = null;

    btnUndo?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Se já está no estado de confirmação, executa o estorno no segundo toque
      if (btnUndo.classList.contains('confirming')) {
        if (confirmTimer) clearTimeout(confirmTimer);
        executarEstorno(v.id, index, item);
      } else {
        // Primeiro toque: solicita confirmação rápida no próprio botão
        btnUndo.classList.add('confirming');
        btnUndo.innerHTML = `
          <i data-lucide="alert-circle" style="width: 12px; height: 12px;"></i>
          <span>Confirmar?</span>
        `;
        refreshIcons();

        confirmTimer = setTimeout(() => {
          btnUndo.classList.remove('confirming');
          btnUndo.innerHTML = `
            <i data-lucide="rotate-ccw" style="width: 12px; height: 12px;"></i>
            <span>Estornar</span>
          `;
          refreshIcons();
        }, 3500);
      }
    });

    container.appendChild(item);
  });

  refreshIcons();
}

async function removerVendaSupabase(venda) {
  if (!state.supabase || !venda) return;
  try {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(venda.id);
    if (isUUID) {
      await state.supabase.from('casa_vendas').delete().eq('id', venda.id);
    } else if (venda.created_at) {
      await state.supabase.from('casa_vendas').delete().eq('created_at', venda.created_at);
    }
  } catch (err) {
    console.warn('[Sync] Erro ao remover venda do Supabase:', err);
  }
}

export async function executarEstorno(vendaId, indexFallback, itemElement) {
  let index = state.vendas.findIndex(v => String(v.id) === String(vendaId));
  if (index === -1 && typeof indexFallback === 'number' && state.vendas[indexFallback]) {
    index = indexFallback;
  }
  if (index === -1) {
    mostrarToast('Venda não localizada para estorno.');
    renderizarHistoricoVendas();
    return;
  }

  const venda = state.vendas[index];
  const prodAtual = state.produtos.find(p => p.id === venda.produto_id);
  const nomeExibicao = prodAtual ? prodAtual.nome : (venda.nome_produto || 'Produto');
  const qtdEstorno = parseInt(venda.quantidade, 10) || 1;

  // 1. Feedback visual imediato com animação de saída suave
  if (itemElement) {
    itemElement.classList.add('removing');
  }

  // 2. Devolve estoque ao produto localmente
  if (prodAtual) {
    prodAtual.estoque_atual = (parseInt(prodAtual.estoque_atual, 10) || 0) + qtdEstorno;
    if (state.supabase) {
      state.supabase.from('casa_produtos')
        .update({ estoque_atual: prodAtual.estoque_atual, updated_at: new Date().toISOString() })
        .eq('id', prodAtual.id)
        .catch(err => console.warn('[Sync] Erro ao devolver estoque no Supabase:', err));
    }
  }

  // 3. Remove do histórico local
  state.vendas.splice(index, 1);
  salvarLocal();

  // 4. Feedback tátil e aviso na tela
  if (navigator.vibrate) navigator.vibrate(40);
  mostrarToast(`Estorno concluído! ${qtdEstorno}x "${nomeExibicao}" devolvido ao estoque.`);

  // 5. Remove da nuvem em segundo plano
  removerVendaSupabase(venda);

  // 6. Atualiza contador e dashboard sem atraso
  setTimeout(() => {
    renderizarHistoricoVendas();
    if (onVendaRealizadaCallback) {
      onVendaRealizadaCallback();
    }
  }, 220);
}

export async function estornarVenda(vendaId, indexFallback) {
  executarEstorno(vendaId, indexFallback, null);
}

export async function limparTodoHistoricoVendas() {
  if (state.vendas.length === 0) return;

  let confirmou = false;
  try {
    confirmou = await pedirConfirmacao({
      titulo: 'Limpar Todo Histórico?',
      mensagem: `Deseja excluir todas as ${state.vendas.length} vendas registradas? O estoque correspondente de cada item será restaurado.`,
      textoConfirmar: 'Sim, Limpar Todas as Vendas',
      perigo: true
    });
  } catch (err) {
    confirmou = window.confirm(`Deseja excluir todas as ${state.vendas.length} vendas registradas?`);
  }

  if (!confirmou) return;

  // 1. Restaura estoque para os produtos vendidos
  state.vendas.forEach(v => {
    const prod = state.produtos.find(p => p.id === v.produto_id);
    if (prod) {
      prod.estoque_atual = (parseInt(prod.estoque_atual, 10) || 0) + (parseInt(v.quantidade, 10) || 1);
      if (state.supabase) {
        state.supabase.from('casa_produtos')
          .update({ estoque_atual: prod.estoque_atual, updated_at: new Date().toISOString() })
          .eq('id', prod.id)
          .catch(err => console.warn('[Sync] Erro ao restaurar estoque:', err));
      }
    }
  });

  // 2. Remove da nuvem Supabase
  if (state.supabase) {
    state.supabase.from('casa_vendas').delete().neq('id', '00000000-0000-0000-0000-000000000000').catch(() => {});
  }

  // 3. Limpa localmente
  state.vendas = [];
  salvarLocal();

  if (navigator.vibrate) navigator.vibrate(50);
  mostrarToast('Histórico de vendas resetado e estoques restaurados!');

  renderizarHistoricoVendas();
  if (onVendaRealizadaCallback) {
    onVendaRealizadaCallback();
  }
}

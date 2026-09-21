// js/vendas.js — Registro de Vendas em Sacola / Carrinho, Histórico Agrupado e Estornos Transacionais
// Versão: v24.0 (Suporte à Sacola Multi-Item, Variações de Produto e Transações Atômicas)

import {
  state,
  salvarLocal,
  enfileirarMutacao,
  adicionarAoCarrinho,
  removerDoCarrinho,
  ajustarQtdCarrinho,
  limparCarrinho,
  obterTotaisCarrinho
} from './state.js';

import {
  formatarMoedaExibicao,
  mostrarToast,
  abrirModal,
  fecharModalAtual,
  refreshIcons,
  pedirConfirmacao,
  obterImagemProdutoResolvida
} from './utils.js';

import { processarOutbox, logSync } from './sync_engine.js';

let onVendaRealizadaCallback = null;
let selecaoVariacaoAtiva = {
  produto: null,
  atributosSelecionados: {},
  varianteSelecionada: null,
  quantidade: 1
};

export function setOnVendaRealizadaCallback(fn) {
  onVendaRealizadaCallback = fn;
}

// ==============================================================================
// 1. INICIALIZAÇÃO DE VENDA (SIMPLES OU COM SELEÇÃO DE VARIAÇÃO)
// ==============================================================================

export function iniciarVendaRapida(produtoId) {
  const prod = state.produtos.find(p => p.id === produtoId);
  if (!prod) return;

  if (prod.estoque_atual <= 0) {
    mostrarToast('Este produto está esgotado.');
    return;
  }

  // Se o produto possui variações configuradas, abre modal de seleção de variante
  if (prod.tem_variacoes && Array.isArray(prod.variantes) && prod.variantes.length > 0) {
    abrirModalSelecaoVariacao(prod);
    return;
  }

  // Produto simples sem variação
  abrirModalConfirmacaoVenda(prod, null);
}

/**
 * Abre o modal de seleção tátil da combinação de variação (PDV e Catálogo).
 */
export function abrirModalSelecaoVariacao(prod) {
  selecaoVariacaoAtiva.produto = prod;
  selecaoVariacaoAtiva.atributosSelecionados = {};
  selecaoVariacaoAtiva.varianteSelecionada = null;
  selecaoVariacaoAtiva.quantidade = 1;

  const nomeElem = document.getElementById('selVarProdNome');
  const precoElem = document.getElementById('selVarProdPreco');
  const thumbBox = document.getElementById('selVarProdThumb');
  const containerDims = document.getElementById('selVarDimensoesContainer');
  const qtdElem = document.getElementById('selVarQtdVal');

  if (nomeElem) nomeElem.innerText = prod.nome;
  if (precoElem) precoElem.innerText = `R$ ${formatarMoedaExibicao(prod.preco_venda)}`;
  if (qtdElem) qtdElem.innerText = '1';

  if (thumbBox) {
    thumbBox.innerHTML = prod.imagem
      ? `<img src="${prod.imagem}" alt="${prod.nome}" style="width: 100%; height: 100%; object-fit: cover;">`
      : `<i data-lucide="package" style="width: 24px; height: 24px; opacity: 0.4;"></i>`;
  }

  // Identifica dimensões disponíveis (Cor, Tamanho, etc.)
  let dimensoes = [];
  if (Array.isArray(prod.variacoes) && prod.variacoes.length > 0) {
    dimensoes = prod.variacoes.filter(v => v.nome && v.valores?.length > 0);
  } else if (prod.variantes[0]?.combinacao) {
    dimensoes = Object.keys(prod.variantes[0].combinacao).map(nomeDim => {
      const valoresSet = new Set();
      prod.variantes.forEach(varItem => {
        if (varItem.combinacao?.[nomeDim]) {
          valoresSet.add(varItem.combinacao[nomeDim]);
        }
      });
      return { nome: nomeDim, valores: [...valoresSet] };
    });
  }

  // Pré-seleciona a primeira variante que tenha estoque disponível
  const primeiraComEstoque = prod.variantes.find(v => (v.estoque_atual || 0) > 0) || prod.variantes[0];
  if (primeiraComEstoque && primeiraComEstoque.combinacao) {
    selecaoVariacaoAtiva.atributosSelecionados = { ...primeiraComEstoque.combinacao };
  } else if (dimensoes.length > 0) {
    dimensoes.forEach(dim => {
      if (dim.valores.length > 0) {
        selecaoVariacaoAtiva.atributosSelecionados[dim.nome] = dim.valores[0];
      }
    });
  }

  // Renderiza seletores por dimensão
  if (containerDims) {
    containerDims.innerHTML = dimensoes.map(dim => {
      const chipsHtml = dim.valores.map(val => {
        const isSelected = selecaoVariacaoAtiva.atributosSelecionados[dim.nome] === val;
        return `
          <div class="sel-var-chip ${isSelected ? 'active' : ''}" data-dim-nome="${dim.nome}" data-dim-val="${val}">
            ${val}
          </div>
        `;
      }).join('');

      return `
        <div class="sel-var-dim-row">
          <div class="sel-var-dim-label">${dim.nome}:</div>
          <div class="sel-var-chips-grid">
            ${chipsHtml}
          </div>
        </div>
      `;
    }).join('');

    // Eventos de clique nos chips de atributo
    containerDims.querySelectorAll('.sel-var-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const dimNome = chip.getAttribute('data-dim-nome');
        const dimVal = chip.getAttribute('data-dim-val');

        selecaoVariacaoAtiva.atributosSelecionados[dimNome] = dimVal;

        const parentGrid = chip.closest('.sel-var-chips-grid');
        parentGrid.querySelectorAll('.sel-var-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        atualizarStatusVarianteSelecionada();
      });
    });
  }

  atualizarStatusVarianteSelecionada();
  abrirModal('modalSelecaoVariacao');
  refreshIcons();
}

export function ajustarQtdSelecaoVariacao(delta) {
  const v = selecaoVariacaoAtiva.varianteSelecionada;
  const maxEst = v ? (parseInt(v.estoque_atual, 10) || 0) : (parseInt(selecaoVariacaoAtiva.produto?.estoque_atual, 10) || 0);

  let novaQtd = (selecaoVariacaoAtiva.quantidade || 1) + delta;
  if (novaQtd < 1) novaQtd = 1;
  if (novaQtd > maxEst) {
    mostrarToast(`Estoque máximo disponível atingido (${maxEst} un).`);
    return;
  }

  selecaoVariacaoAtiva.quantidade = novaQtd;
  const qtdElem = document.getElementById('selVarQtdVal');
  if (qtdElem) qtdElem.innerText = novaQtd;

  const precoUnit = v?.preco_venda || selecaoVariacaoAtiva.produto?.preco_venda || 0;
  const precoTotal = novaQtd * precoUnit;
  const precoElem = document.getElementById('selVarPrecoFinal');
  if (precoElem) precoElem.innerText = `R$ ${formatarMoedaExibicao(precoTotal)}`;
}

/**
 * Atualiza o painel de status e preço da combinação selecionada no modal.
 */
function atualizarStatusVarianteSelecionada() {
  const prod = selecaoVariacaoAtiva.produto;
  if (!prod) return;

  const selecao = selecaoVariacaoAtiva.atributosSelecionados;
  const varianteMatch = prod.variantes.find(v => {
    return Object.entries(selecao).every(([k, val]) => v.combinacao && v.combinacao[k] === val);
  });

  selecaoVariacaoAtiva.varianteSelecionada = varianteMatch || null;

  // Atualiza foto do produto/variante em tempo real no PDV
  const thumbBox = document.getElementById('selVarProdThumb');
  if (thumbBox) {
    const fotoResolvida = obterImagemProdutoResolvida(prod, varianteMatch || selecao);
    thumbBox.innerHTML = fotoResolvida
      ? `<img src="${fotoResolvida}" alt="${prod.nome}" style="width: 100%; height: 100%; object-fit: cover;">`
      : `<i data-lucide="package" style="width: 24px; height: 24px; opacity: 0.4;"></i>`;
    refreshIcons();
  }

  const nomeCombElem = document.getElementById('selVarCombinacaoNome');
  const badgeEstoque = document.getElementById('selVarEstoqueBadge');
  const precoFinalElem = document.getElementById('selVarPrecoFinal');
  const btnConfirmar = document.getElementById('btnConfirmarSelecaoVariacao');
  const btnAddSacola = document.getElementById('btnAdicionarVarSacola');
  const skuTagElem = document.getElementById('selVarSkuTag');

  const qtd = selecaoVariacaoAtiva.quantidade || 1;

  if (varianteMatch) {
    if (nomeCombElem) nomeCombElem.innerText = varianteMatch.nome_combinacao;
    if (skuTagElem) {
      if (varianteMatch.sku) {
        skuTagElem.innerText = `SKU: ${varianteMatch.sku}`;
        skuTagElem.style.display = 'inline-block';
      } else {
        skuTagElem.style.display = 'none';
      }
    }
    const preco = varianteMatch.preco_venda || prod.preco_venda;
    if (precoFinalElem) precoFinalElem.innerText = `R$ ${formatarMoedaExibicao(preco * qtd)}`;

    const est = parseInt(varianteMatch.estoque_atual, 10) || 0;
    if (badgeEstoque) {
      if (est <= 0) {
        badgeEstoque.className = 'stock-badge empty';
        badgeEstoque.innerText = 'Esgotado nesta variação';
      } else if (est <= (varianteMatch.estoque_minimo || 2)) {
        badgeEstoque.className = 'stock-badge low';
        badgeEstoque.innerText = `Apenas ${est} un disponíveis`;
      } else {
        badgeEstoque.className = 'stock-badge ok';
        badgeEstoque.innerText = `${est} un disponíveis`;
      }
    }

    const indisponivel = est <= 0;
    if (btnConfirmar) {
      btnConfirmar.disabled = indisponivel;
      btnConfirmar.style.opacity = indisponivel ? '0.5' : '1';
    }
    if (btnAddSacola) {
      btnAddSacola.disabled = indisponivel;
      btnAddSacola.style.opacity = indisponivel ? '0.5' : '1';
    }
  } else {
    if (nomeCombElem) nomeCombElem.innerText = 'Combinação indisponível';
    if (badgeEstoque) {
      badgeEstoque.className = 'stock-badge empty';
      badgeEstoque.innerText = 'Não disponível';
    }
    if (btnConfirmar) {
      btnConfirmar.disabled = true;
      btnConfirmar.style.opacity = '0.5';
    }
    if (btnAddSacola) {
      btnAddSacola.disabled = true;
      btnAddSacola.style.opacity = '0.5';
    }
  }
}

/**
 * Adiciona a variante selecionada no modal diretamente à Sacola/Carrinho.
 */
export function adicionarVarianteSelecionadaAoCarrinho() {
  const { produto, varianteSelecionada, quantidade } = selecaoVariacaoAtiva;
  if (!produto || !varianteSelecionada) {
    mostrarToast('Selecione uma combinação válida.');
    return;
  }

  const qtd = quantidade || 1;
  const estoqueDisponivel = parseInt(varianteSelecionada.estoque_atual, 10) || 0;

  // Verifica se já tem no carrinho para não estourar estoque somado
  const itemExistente = state.carrinho.find(i => i.produto_id === produto.id && i.variante_id === varianteSelecionada.id);
  const qtdJaNoCarrinho = itemExistente ? itemExistente.quantidade : 0;

  if (qtdJaNoCarrinho + qtd > estoqueDisponivel) {
    mostrarToast(`Estoque insuficiente. Já existem ${qtdJaNoCarrinho} un na sacola (máx: ${estoqueDisponivel}).`);
    return;
  }

  adicionarAoCarrinho(produto, varianteSelecionada, qtd);
  salvarLocal();
  atualizarBadgeSacola();

  if (navigator.vibrate) navigator.vibrate(40);
  fecharModalAtual();
  mostrarToast(`+${qtd}x "${produto.nome} (${varianteSelecionada.nome_combinacao})" adicionado à sacola!`);
}

/**
 * Abre o modal de venda rápida (quantidade e método de pagamento) para o produto ou variante selecionada.
 */
function abrirModalConfirmacaoVenda(prod, variante = null) {
  const qtdInicial = (selecaoVariacaoAtiva && selecaoVariacaoAtiva.produto?.id === prod.id && selecaoVariacaoAtiva.quantidade) || 1;
  state.vendaEmAndamento = {
    produto: prod,
    variante: variante,
    quantidade: qtdInicial
  };

  const precoUnitario = variante?.preco_venda || prod.preco_venda;
  const nomeExibicao = variante ? `${prod.nome} — ${variante.nome_combinacao}` : prod.nome;

  const nomeEl = document.getElementById('vendaProdNome');
  const precoUnitEl = document.getElementById('vendaPrecoUnit');
  const qtdValEl = document.getElementById('vendaQtdVal');
  const totalFinalEl = document.getElementById('vendaTotalFinal');

  if (nomeEl) nomeEl.innerText = nomeExibicao;
  if (precoUnitEl) precoUnitEl.innerText = `R$ ${formatarMoedaExibicao(precoUnitario)}`;
  if (qtdValEl) qtdValEl.innerText = String(qtdInicial);
  if (totalFinalEl) totalFinalEl.innerText = `R$ ${formatarMoedaExibicao(precoUnitario * qtdInicial)}`;

  // Atualiza thumbnail do produto/variante no resumo de checkout
  const fotoFinal = obterImagemProdutoResolvida(prod, variante);
  const thumbBox = document.getElementById('vendaProdThumb');
  if (thumbBox) {
    thumbBox.innerHTML = fotoFinal
      ? `<img src="${fotoFinal}" alt="${prod.nome}" style="width: 100%; height: 100%; object-fit: cover;">`
      : `<i data-lucide="package" style="width: 20px; height: 20px; opacity: 0.4;"></i>`;
    refreshIcons();
  }
  const nomeDestaque = document.getElementById('vendaProdNomeDestaque');
  const varDestaque = document.getElementById('vendaProdVarianteDestaque');
  if (nomeDestaque) nomeDestaque.innerText = prod.nome;
  if (varDestaque) varDestaque.innerText = variante ? variante.nome_combinacao : (prod.categoria || '');

  abrirModal('modalVendaRapida');
}

/**
 * Adiciona o produto em andamento (simples ou variante) à Sacola/Carrinho.
 */
export function adicionarItemVendaEmAndamentoAoCarrinho() {
  if (!state.vendaEmAndamento) return;
  const { produto, variante, quantidade } = state.vendaEmAndamento;
  const qtd = quantidade || 1;
  const estoqueMax = variante ? (parseInt(variante.estoque_atual, 10) || 0) : (parseInt(produto.estoque_atual, 10) || 0);

  const itemExistente = state.carrinho.find(i => i.produto_id === produto.id && (i.variante_id || null) === (variante?.id || null));
  const qtdAtualNoCarrinho = itemExistente ? itemExistente.quantidade : 0;

  if (qtdAtualNoCarrinho + qtd > estoqueMax) {
    mostrarToast(`Estoque insuficiente. Já existem ${qtdAtualNoCarrinho} un na sacola (máx: ${estoqueMax}).`);
    return;
  }

  adicionarAoCarrinho(produto, variante, qtd);
  salvarLocal();
  atualizarBadgeSacola();

  if (navigator.vibrate) navigator.vibrate(40);
  fecharModalAtual();
  const nomeDesc = variante ? `${produto.nome} (${variante.nome_combinacao})` : produto.nome;
  mostrarToast(`+${qtd}x "${nomeDesc}" adicionado à sacola!`);
}

// ==============================================================================
// 2. AJUSTE DE QUANTIDADE E FORMA DE PAGAMENTO (MODAL VENDA RÁPIDA)
// ==============================================================================

export function ajustarQtdVenda(delta) {
  if (!state.vendaEmAndamento) return;
  const { produto, variante } = state.vendaEmAndamento;
  const estoqueMaximo = variante ? (variante.estoque_atual || 0) : (produto.estoque_atual || 0);

  let novaQtd = state.vendaEmAndamento.quantidade + delta;
  if (novaQtd < 1) novaQtd = 1;
  if (novaQtd > estoqueMaximo) {
    mostrarToast(`Quantidade máxima disponível atingida (${estoqueMaximo} un).`);
    return;
  }

  state.vendaEmAndamento.quantidade = novaQtd;
  document.getElementById('vendaQtdVal').innerText = novaQtd;

  const precoUnit = variante?.preco_venda || produto.preco_venda;
  const total = novaQtd * precoUnit;
  document.getElementById('vendaTotalFinal').innerText = `R$ ${formatarMoedaExibicao(total)}`;
}

export function selecionarMetodoPgto(metodo, elem) {
  state.metodoPgtoSelecionado = metodo;
  document.querySelectorAll('.payment-methods .pay-btn').forEach(b => b.classList.remove('active'));
  if (elem) elem.classList.add('active');
}

// ==============================================================================
// 3. CONFIRMAÇÃO DE VENDA DIRETA (1 ITEM) E BAIXA TRANSACIONAL ATÔMICA
// ==============================================================================

export async function confirmarVendaFinal() {
  if (!state.vendaEmAndamento) return;

  const { produto: p, variante, quantidade: qtd } = state.vendaEmAndamento;

  // Validação estrita de estoque (Variante vs Produto Simples)
  if (variante) {
    if ((variante.estoque_atual || 0) < qtd) {
      mostrarToast(`Estoque insuficiente da variação "${variante.nome_combinacao}".`);
      return;
    }
  } else {
    if ((p.estoque_atual || 0) < qtd) {
      mostrarToast('Estoque insuficiente para esta venda.');
      return;
    }
  }

  const precoUnit = Number(variante?.preco_venda || p.preco_venda || 0);
  const custoUnit = Number(variante?.preco_custo || p.preco_custo || 0);
  const valTotal = qtd * precoUnit;
  const custoTot = qtd * custoUnit;
  const lucroBruto = valTotal - custoTot;

  const pctReserva = (state.config.percentualReserva || 30) / 100;
  const reservaCalculada = lucroBruto * pctReserva;
  const agoraIso = new Date().toISOString();

  // 1. ATUALIZAÇÃO LOCAL SÍNCRONA (Local-First Real)
  if (variante) {
    variante.estoque_atual -= qtd;
  }
  p.estoque_atual -= qtd;
  p.updated_at = agoraIso;

  const skuVendido = (variante && variante.sku) ? variante.sku : (p.sku || null);
  const pedidoId = crypto.randomUUID();
  const numeroPedido = '#CS-' + Math.floor(1000 + Math.random() * 9000);

  // 2. Registro oficial de venda com pedido_id compartilhado, número do pedido e categoria
  const novaVenda = {
    id: crypto.randomUUID(),
    pedido_id: pedidoId,
    numero_pedido: numeroPedido,
    produto_id: p.id,
    nome_produto: p.nome,
    categoria: p.categoria || 'Geral',
    subcategoria: p.subcategoria || null,
    variante_id: variante ? variante.id : null,
    variacao_nome: variante ? variante.nome_combinacao : null,
    variacao_atributos: variante ? variante.combinacao : null,
    sku: skuVendido,
    quantidade: qtd,
    valor_unitario: precoUnit,
    valor_total: valTotal,
    custo_total: custoTot,
    lucro_bruto: lucroBruto,
    valor_reserva_30: reservaCalculada,
    metodo_pagamento: state.metodoPgtoSelecionado,
    operador: state.operador || 'Operador',
    estornada: false,
    created_at: agoraIso,
    updated_at: agoraIso
  };

  state.vendas.unshift(novaVenda);

  // 3. Enfileira na Outbox persistente como VENDA_TRANSACIONAL
  enfileirarMutacao('VENDA_TRANSACIONAL', 'vendas', novaVenda.id, novaVenda);
  enfileirarMutacao('PRODUTO_UPSERT', 'produtos', p.id, { ...p });
  salvarLocal();

  if (navigator.vibrate) navigator.vibrate(50);

  fecharModalAtual();
  const descVenda = variante ? `${qtd}x ${p.nome} (${variante.nome_combinacao})` : `${qtd}x ${p.nome}`;
  mostrarToast(`Venda ${numeroPedido} de R$ ${formatarMoedaExibicao(valTotal)} registrada!`);

  if (onVendaRealizadaCallback) onVendaRealizadaCallback();

  logSync('LOCAL', `Venda ${novaVenda.id} (${descVenda}) concluída e enfileirada.`);
  processarOutbox();
}

// ==============================================================================
// 4. GESTÃO COMPLETA DA SACOLA / CARRINHO DE COMPRAS
// ==============================================================================

/**
 * Atualiza badges da sacola no topo e o bottom bar flutuante.
 */
export function atualizarBadgeSacola() {
  const totais = obterTotaisCarrinho();
  const badgeTop = document.getElementById('badgeSacolaTop');
  const barFlutuante = document.getElementById('barSacolaFlutuante');
  const barQtdTxt = document.getElementById('sacolaBarQtdTxt');
  const barTotalTxt = document.getElementById('sacolaBarTotalTxt');

  // Atualiza badge no botão do topo
  if (badgeTop) {
    if (totais.totalUnidades > 0) {
      badgeTop.innerText = totais.totalUnidades > 99 ? '99+' : totais.totalUnidades;
      badgeTop.style.display = 'flex';
    } else {
      badgeTop.style.display = 'none';
    }
  }

  // Atualiza floating action bar da sacola
  if (barFlutuante) {
    if (totais.totalUnidades > 0) {
      if (barQtdTxt) {
        barQtdTxt.innerText = `${totais.totalUnidades} ${totais.totalUnidades === 1 ? 'item' : 'itens'}`;
      }
      if (barTotalTxt) {
        barTotalTxt.innerText = `R$ ${formatarMoedaExibicao(totais.subtotal)}`;
      }
      barFlutuante.classList.add('visible');
    } else {
      barFlutuante.classList.remove('visible');
    }
  }
}

/**
 * Abre o modal da sacola e renderiza seu conteúdo atualizado.
 */
export function abrirModalSacola() {
  renderizarConteudoSacola();
  abrirModal('modalSacola');
  refreshIcons();
}

/**
 * Renderiza os itens da sacola, botões de quantidade, remoção e resumo financeiro.
 */
export function renderizarConteudoSacola() {
  const container = document.getElementById('sacolaItensContainer');
  const resumoBox = document.getElementById('sacolaResumoBox');
  const subtotalEl = document.getElementById('sacolaSubtotalVal');
  const totalEl = document.getElementById('sacolaTotalVal');
  const btnFinalizar = document.getElementById('btnFinalizarVendaSacola');
  const badgeTotalItens = document.getElementById('sacolaHeaderCountBadge');

  if (!container) return;

  const totais = obterTotaisCarrinho();

  if (badgeTotalItens) {
    badgeTotalItens.innerText = `${totais.totalUnidades} ${totais.totalUnidades === 1 ? 'item' : 'itens'}`;
  }

  if (state.carrinho.length === 0) {
    container.innerHTML = `
      <div class="empty-cart-state">
        <div class="empty-cart-icon">
          <i data-lucide="shopping-bag" style="width: 44px; height: 44px; opacity: 0.4;"></i>
        </div>
        <p class="empty-cart-title">Sua sacola está vazia</p>
        <p class="empty-cart-desc">Selecione produtos no catálogo ou estoque para adicionar à venda.</p>
        <button type="button" class="btn-main" id="btnContinuarComprandoSacola" style="margin-top: 14px; width: auto; padding: 0 20px;">
          <i data-lucide="arrow-left" style="width: 14px; height: 14px;"></i> Voltar ao Catálogo
        </button>
      </div>
    `;

    if (resumoBox) resumoBox.style.display = 'none';
    if (btnFinalizar) {
      btnFinalizar.disabled = true;
      btnFinalizar.style.opacity = '0.5';
    }

    document.getElementById('btnContinuarComprandoSacola')?.addEventListener('click', fecharModalAtual);
    refreshIcons();
    return;
  }

  if (resumoBox) resumoBox.style.display = 'block';
  if (btnFinalizar) {
    btnFinalizar.disabled = false;
    btnFinalizar.style.opacity = '1';
  }

  container.innerHTML = state.carrinho.map(item => {
    const totalLinha = item.quantidade * item.preco_unitario;
    const badgeVar = item.variacao_nome
      ? `<span class="cart-var-badge">${item.variacao_nome}</span>`
      : '';
    const badgeSku = item.sku
      ? `<span class="cart-sku-badge">SKU: ${item.sku}</span>`
      : '';

    return `
      <div class="cart-item-card" data-prod-id="${item.produto_id}" data-var-id="${item.variante_id || ''}">
        <div class="cart-item-thumb">
          ${item.imagem
            ? `<img src="${item.imagem}" alt="${item.nome_produto || item.nome}">`
            : `<i data-lucide="package" style="width: 22px; height: 22px; opacity: 0.4;"></i>`
          }
        </div>
        <div class="cart-item-body">
          <div class="cart-item-title-row">
            <div class="cart-item-title">${item.nome_produto || item.nome}</div>
            <button type="button" class="btn-cart-remove" data-remove-prod="${item.produto_id}" data-remove-var="${item.variante_id || ''}" title="Remover item">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
          </div>
          <div class="cart-item-meta">
            ${badgeVar}
            ${badgeSku}
          </div>
          <div class="cart-item-footer">
            <div class="cart-stepper">
              <button type="button" class="cart-step-btn" data-step-prod="${item.produto_id}" data-step-var="${item.variante_id || ''}" data-step-delta="-1">-</button>
              <span class="cart-step-val">${item.quantidade}</span>
              <button type="button" class="cart-step-btn" data-step-prod="${item.produto_id}" data-step-var="${item.variante_id || ''}" data-step-delta="1">+</button>
            </div>
            <div class="cart-item-prices">
              <span class="cart-unit-price">${item.quantidade}x R$ ${formatarMoedaExibicao(item.preco_unitario)}</span>
              <strong class="cart-line-total">R$ ${formatarMoedaExibicao(totalLinha)}</strong>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (subtotalEl) subtotalEl.innerText = `R$ ${formatarMoedaExibicao(totais.subtotal)}`;
  if (totalEl) totalEl.innerText = `R$ ${formatarMoedaExibicao(totais.subtotal)}`;

  // Vincula botões de ajuste de quantidade no carrinho
  container.querySelectorAll('[data-step-delta]').forEach(btn => {
    btn.addEventListener('click', () => {
      const prodId = btn.getAttribute('data-step-prod');
      const varId = btn.getAttribute('data-step-var') || null;
      const delta = parseInt(btn.getAttribute('data-step-delta'), 10);
      ajustarQtdItemCarrinho(prodId, varId, delta);
    });
  });

  // Vincula botões de remoção de item
  container.querySelectorAll('[data-remove-prod]').forEach(btn => {
    btn.addEventListener('click', () => {
      const prodId = btn.getAttribute('data-remove-prod');
      const varId = btn.getAttribute('data-remove-var') || null;
      removerItemCarrinho(prodId, varId);
    });
  });

  refreshIcons();
}

export function ajustarQtdItemCarrinho(produtoId, varianteId, delta) {
  ajustarQtdCarrinho(produtoId, varianteId, delta);
  salvarLocal();
  atualizarBadgeSacola();
  renderizarConteudoSacola();
}

export function removerItemCarrinho(produtoId, varianteId) {
  removerDoCarrinho(produtoId, varianteId);
  salvarLocal();
  atualizarBadgeSacola();
  renderizarConteudoSacola();
  mostrarToast('Item removido da sacola.');
}

/**
 * Finaliza atomicamente a venda da Sacola inteira (múltiplos itens e variantes).
 */
export async function finalizarVendaSacola() {
  if (state.carrinho.length === 0) {
    mostrarToast('A sacola está vazia.');
    return;
  }

  // 1. Validação local de estoque de todos os itens antes de prosseguir
  for (const item of state.carrinho) {
    const prod = state.produtos.find(p => p.id === item.produto_id);
    const nomeItem = item.nome_produto || item.nome || prod?.nome || 'Produto';
    if (!prod) {
      mostrarToast(`Produto "${nomeItem}" não encontrado no cadastro.`);
      return;
    }

    if (item.variante_id) {
      const varAlvo = prod.variantes?.find(v => v.id === item.variante_id);
      if (!varAlvo || (parseInt(varAlvo.estoque_atual, 10) || 0) < item.quantidade) {
        mostrarToast(`Estoque insuficiente de "${nomeItem} (${item.variacao_nome || 'variante'})". Disponível: ${varAlvo?.estoque_atual || 0} un.`);
        return;
      }
    } else {
      if ((parseInt(prod.estoque_atual, 10) || 0) < item.quantidade) {
        mostrarToast(`Estoque insuficiente de "${nomeItem}". Disponível: ${prod.estoque_atual || 0} un.`);
        return;
      }
    }
  }

  const totais = obterTotaisCarrinho();
  const pedidoId = crypto.randomUUID();
  const numeroPedido = '#CS-' + Math.floor(1000 + Math.random() * 9000);
  const agoraIso = new Date().toISOString();
  const metodoPgto = state.metodoPgtoSelecionado || 'Pix';
  const operadorNome = state.operador || 'Operador';

  const itensGravados = [];
  const produtosModificados = new Set();

  // 2. Aplica baixa de estoque local para cada item do carrinho
  for (const item of state.carrinho) {
    const prod = state.produtos.find(p => p.id === item.produto_id);
    const qtd = item.quantidade;
    const precoUnit = Number(item.preco_unitario || 0);
    const custoUnit = Number(item.preco_custo || 0);
    const valorTot = qtd * precoUnit;
    const custoTot = qtd * custoUnit;
    const lucro = valorTot - custoTot;
    const reserva = lucro * ((state.config.percentualReserva || 30) / 100);

    if (item.variante_id) {
      const varAlvo = prod.variantes?.find(v => v.id === item.variante_id);
      if (varAlvo) {
        varAlvo.estoque_atual = (parseInt(varAlvo.estoque_atual, 10) || 0) - qtd;
      }
    }
    prod.estoque_atual = (parseInt(prod.estoque_atual, 10) || 0) - qtd;
    prod.updated_at = agoraIso;
    produtosModificados.add(prod);

    const vendaItemObj = {
      id: crypto.randomUUID(),
      pedido_id: pedidoId,
      numero_pedido: numeroPedido,
      produto_id: item.produto_id,
      nome_produto: item.nome_produto || item.nome || prod.nome,
      categoria: item.categoria || prod.categoria || 'Geral',
      subcategoria: item.subcategoria || prod.subcategoria || null,
      variante_id: item.variante_id || null,
      variacao_nome: item.variacao_nome || null,
      variacao_atributos: item.variacao_atributos || null,
      sku: item.sku || null,
      quantidade: qtd,
      valor_unitario: precoUnit,
      valor_total: valorTot,
      custo_total: custoTot,
      lucro_bruto: lucro,
      valor_reserva_30: reserva,
      metodo_pagamento: metodoPgto,
      operador: operadorNome,
      estornada: false,
      created_at: agoraIso,
      updated_at: agoraIso
    };

    itensGravados.push(vendaItemObj);
    state.vendas.unshift(vendaItemObj);
  }

  // 3. Enfileira o job atômico VENDA_CARRINHO_TRANSACIONAL na Outbox
  const payloadCarrinho = {
    pedido_id: pedidoId,
    numero_pedido: numeroPedido,
    metodo_pagamento: metodoPgto,
    operador: operadorNome,
    itens: itensGravados.map(it => ({
      id: it.id,
      venda_id: it.id,
      produto_id: it.produto_id,
      variante_id: it.variante_id,
      nome_produto: it.nome_produto,
      categoria: it.categoria,
      subcategoria: it.subcategoria,
      variacao_nome: it.variacao_nome,
      variacao_atributos: it.variacao_atributos,
      sku: it.sku,
      quantidade: it.quantidade,
      valor_unitario: it.valor_unitario,
      valor_total: it.valor_total,
      custo_total: it.custo_total,
      lucro_bruto: it.lucro_bruto,
      valor_reserva_30: it.valor_reserva_30
    })),
    valor_total: totais.subtotal,
    custo_total: totais.custoTotal,
    lucro_bruto: totais.lucroBruto,
    valor_reserva_30: totais.reservaCalculada,
    created_at: agoraIso
  };

  enfileirarMutacao('VENDA_CARRINHO_TRANSACIONAL', 'vendas', pedidoId, payloadCarrinho);

  // Enfileira sincronização dos produtos que tiveram estoque baixado
  produtosModificados.forEach(p => {
    enfileirarMutacao('PRODUTO_UPSERT', 'produtos', p.id, { ...p });
  });

  // Limpa a sacola e salva localmente
  limparCarrinho();
  salvarLocal();
  atualizarBadgeSacola();

  if (navigator.vibrate) navigator.vibrate(50);
  fecharModalAtual();

  mostrarToast(`Venda ${numeroPedido} (${totais.totalUnidades} un) no valor de R$ ${formatarMoedaExibicao(totais.subtotal)} finalizada!`);

  if (onVendaRealizadaCallback) {
    onVendaRealizadaCallback();
  }

  logSync('LOCAL', `Venda ${numeroPedido} (${itensGravados.length} linhas, ${totais.totalUnidades} un) gravada na sacola e enfileirada.`);
  processarOutbox();
}

// ==============================================================================
// 5. HISTÓRICO DE VENDAS AGRUPADO POR PEDIDO E ESTORNO ATÔMICO
// ==============================================================================

export function renderizarHistoricoVendas() {
  const container = document.getElementById('salesListContainer') || document.getElementById('salesList');
  const contador = document.getElementById('vendasTotalContador') || document.getElementById('salesCountBadge');
  if (!container) return;
  container.innerHTML = '';

  const vendasAtivas = state.vendas.filter(v => !v.estornada);

  // Agrupa vendas ativas por pedido_id para exibição visual agrupada
  const pedidosMap = new Map();
  vendasAtivas.forEach(v => {
    const pId = v.pedido_id || v.id;
    if (!pedidosMap.has(pId)) {
      pedidosMap.set(pId, {
        pedido_id: pId,
        numero_pedido: v.numero_pedido || ('#CS-' + (v.id ? v.id.substring(0, 5).toUpperCase() : '0000')),
        created_at: v.created_at,
        operador: v.operador || 'Operador',
        metodo_pagamento: v.metodo_pagamento || 'Pix',
        valor_total: 0,
        valor_reserva: 0,
        itens: []
      });
    }
    const p = pedidosMap.get(pId);
    p.valor_total += Number(v.valor_total || 0);
    p.valor_reserva += Number(v.valor_reserva_30 || 0);
    p.itens.push(v);
  });

  const listaPedidos = Array.from(pedidosMap.values());
  const totalTransacoes = listaPedidos.length;

  if (contador) {
    contador.innerText = `${totalTransacoes} ${totalTransacoes === 1 ? 'venda' : 'vendas'}`;
  }

  const btnLimpar = document.getElementById('btnLimparVendas');
  if (btnLimpar) {
    btnLimpar.style.display = totalTransacoes > 0 ? 'inline-flex' : 'none';
  }

  if (totalTransacoes === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <i data-lucide="receipt" style="width: 48px; height: 48px; margin-bottom: 10px; opacity: 0.5;"></i>
        <p>Nenhuma venda registrada ainda.</p>
      </div>`;
    refreshIcons();
    return;
  }

  listaPedidos.forEach(pedido => {
    const dataFormatada = new Date(pedido.created_at).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    const totalUnidadesPedido = pedido.itens.reduce((acc, it) => acc + (parseInt(it.quantidade, 10) || 1), 0);
    const qtdLinhas = pedido.itens.length;

    let metodoPgto = pedido.metodo_pagamento || 'Outro';
    if (metodoPgto.toLowerCase().includes('crédito') || metodoPgto.toLowerCase().includes('credito')) {
      metodoPgto = 'Crédito';
    } else if (metodoPgto.toLowerCase().includes('débito') || metodoPgto.toLowerCase().includes('debito')) {
      metodoPgto = 'Débito';
    }

    // Monta itens do pedido
    const itensHtml = pedido.itens.map(it => {
      const prodAtual = state.produtos.find(p => p.id === it.produto_id);
      const nomeBase = prodAtual ? prodAtual.nome : (it.nome_produto || 'Produto');

      const badgeVar = it.variacao_nome
        ? `<span class="category-badge" style="font-size: 10px; padding: 1px 6px; margin-left: 4px; background: rgba(245, 158, 11, 0.12); color: var(--primary); border-color: rgba(245, 158, 11, 0.3); font-weight: 600;">${it.variacao_nome}</span>`
        : '';

      const badgeSku = it.sku
        ? `<span style="font-size: 9.5px; font-family: monospace; color: var(--text-muted); background: rgba(255, 255, 255, 0.06); padding: 1px 5px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.08); margin-left: 4px;">SKU: ${it.sku}</span>`
        : '';

      return `
        <div class="order-item-subrow">
          <div class="order-item-left">
            <span class="order-item-name"><strong>${it.quantidade}x</strong> ${nomeBase}</span>
            ${badgeVar}
            ${badgeSku}
          </div>
          <div class="order-item-right">
            <span>R$ ${formatarMoedaExibicao(it.valor_total)}</span>
          </div>
        </div>
      `;
    }).join('');

    const card = document.createElement('div');
    card.className = 'sale-order-card';
    card.setAttribute('data-pedido-id', pedido.pedido_id);

    card.innerHTML = `
      <div class="sale-order-header">
        <div class="sale-order-info-left">
          <div class="sale-order-code">
            <span>${pedido.numero_pedido}</span>
            <span class="sale-order-count-pill">${totalUnidadesPedido} un (${qtdLinhas} ${qtdLinhas === 1 ? 'item' : 'itens'})</span>
          </div>
          <div class="sale-order-meta">
            <span>${dataFormatada}</span>
            <span>•</span>
            <span><i data-lucide="user" style="width: 11px; height: 11px; display: inline-block; vertical-align: middle;"></i> ${pedido.operador}</span>
          </div>
        </div>
        <div class="sale-order-info-right">
          <div class="sale-order-total">R$ ${formatarMoedaExibicao(pedido.valor_total)}</div>
          <div class="sale-order-actions">
            <button type="button" class="btn-undo-sale" data-pedido-id="${pedido.pedido_id}" title="Estornar esta compra">
              <i data-lucide="rotate-ccw" style="width: 12px; height: 12px;"></i>
              <span>Estornar</span>
            </button>
          </div>
        </div>
      </div>
      
      <div class="sale-order-items-container">
        ${itensHtml}
      </div>

      <div class="sale-order-footer">
        <div class="sale-pay-badge">${metodoPgto}</div>
        <div class="sale-reserve">Reserva: +R$ ${formatarMoedaExibicao(pedido.valor_reserva)}</div>
      </div>
    `;

    const btnUndo = card.querySelector('.btn-undo-sale');
    let confirmTimer = null;

    btnUndo?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();

      if (btnUndo.classList.contains('confirming')) {
        if (confirmTimer) clearTimeout(confirmTimer);
        executarEstornoPedido(pedido.pedido_id, card);
      } else {
        btnUndo.classList.add('confirming');
        btnUndo.innerHTML = `
          <i data-lucide="alert-circle" style="width: 12px; height: 12px;"></i>
          <span>Confirmar Estorno?</span>
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

    container.appendChild(card);
  });

  refreshIcons();
}

/**
 * Estorna atomicamente todos os itens pertencentes a um pedido_id, restaurando estoques com exatidão.
 */
export async function executarEstornoPedido(pedidoId, cardElement) {
  const itensDoPedido = state.vendas.filter(v => (v.pedido_id === pedidoId || v.id === pedidoId) && !v.estornada);

  if (itensDoPedido.length === 0) {
    mostrarToast('Pedido não localizado ou já estornado.');
    renderizarHistoricoVendas();
    return;
  }

  const agoraIso = new Date().toISOString();
  const operadorNome = state.operador || 'Operador';
  const produtosAfetados = new Set();
  const numeroPedido = itensDoPedido[0].numero_pedido || '#CS-0000';

  if (cardElement) {
    cardElement.classList.add('removing');
  }

  // 1. Devolve estoque atômica e exatamente de cada item e variação
  for (const venda of itensDoPedido) {
    const prodAtual = state.produtos.find(p => p.id === venda.produto_id);
    const qtdEstorno = parseInt(venda.quantidade, 10) || 1;

    if (prodAtual) {
      if (venda.variante_id && prodAtual.tem_variacoes && Array.isArray(prodAtual.variantes)) {
        const varAlvo = prodAtual.variantes.find(v => v.id === venda.variante_id);
        if (varAlvo) {
          varAlvo.estoque_atual = (parseInt(varAlvo.estoque_atual, 10) || 0) + qtdEstorno;
        }
      }
      prodAtual.estoque_atual = (parseInt(prodAtual.estoque_atual, 10) || 0) + qtdEstorno;
      prodAtual.updated_at = agoraIso;
      produtosAfetados.add(prodAtual);
    }

    venda.estornada = true;
    venda.estornada_em = agoraIso;
    venda.estorno_operador = operadorNome;
    venda.updated_at = agoraIso;
  }

  // 2. Enfileira mutação transacional na Outbox persistente
  enfileirarMutacao('ESTORNO_CARRINHO_TRANSACIONAL', 'vendas', pedidoId, {
    pedido_id: pedidoId,
    numero_pedido: numeroPedido,
    operador: operadorNome,
    itens: itensDoPedido.map(v => ({
      venda_id: v.id,
      produto_id: v.produto_id,
      variante_id: v.variante_id || null,
      quantidade: parseInt(v.quantidade, 10) || 1
    }))
  });

  // Enfileira atualização dos produtos restaurados
  produtosAfetados.forEach(prod => {
    enfileirarMutacao('PRODUTO_UPSERT', 'produtos', prod.id, { ...prod });
  });

  salvarLocal();

  if (navigator.vibrate) navigator.vibrate(40);
  mostrarToast(`Estorno do pedido ${numeroPedido} concluído! Todos os itens voltaram ao estoque.`);

  setTimeout(() => {
    renderizarHistoricoVendas();
    if (onVendaRealizadaCallback) {
      onVendaRealizadaCallback();
    }
  }, 180);

  logSync('LOCAL', `Estorno do pedido ${pedidoId} executado localmente e enfileirado.`);
  processarOutbox();
}

/**
 * Compatibilidade legada para estorno de venda individual por ID.
 */
export async function estornarVenda(vendaId) {
  const venda = state.vendas.find(v => v.id === vendaId);
  const pedidoId = venda?.pedido_id || vendaId;
  executarEstornoPedido(pedidoId, null);
}

export async function limparTodoHistoricoVendas() {
  if (state.vendas.length === 0) return;

  let confirmou = false;
  try {
    confirmou = await pedirConfirmacao({
      titulo: 'Limpar Todo Histórico?',
      mensagem: `Deseja excluir todas as ${state.vendas.length} vendas registradas? O estoque correspondente de cada item e variação será restaurado.`,
      textoConfirmar: 'Sim, limpar',
      perigo: true
    });
  } catch (err) {
    confirmou = window.confirm(`Deseja excluir todas as ${state.vendas.length} vendas registradas?`);
  }

  if (!confirmou) return;

  const vendasParaRestaurar = [...state.vendas];
  const agoraIso = new Date().toISOString();

  // Restaura estoque de cada venda e variante
  vendasParaRestaurar.forEach(v => {
    if (v.estornada !== true) {
      const prod = state.produtos.find(p => p.id === v.produto_id);
      if (prod) {
        const qtd = parseInt(v.quantidade, 10) || 1;
        if (v.variante_id && prod.tem_variacoes && Array.isArray(prod.variantes)) {
          const varAlvo = prod.variantes.find(itemVar => itemVar.id === v.variante_id);
          if (varAlvo) {
            varAlvo.estoque_atual = (parseInt(varAlvo.estoque_atual, 10) || 0) + qtd;
          }
        }
        prod.estoque_atual = (parseInt(prod.estoque_atual, 10) || 0) + qtd;
        prod.updated_at = agoraIso;
        enfileirarMutacao('PRODUTO_UPSERT', 'produtos', prod.id, { ...prod });
      }
    }
  });

  state.vendas = [];
  enfileirarMutacao('VENDAS_CLEAR', 'vendas', null, null);
  salvarLocal();

  if (navigator.vibrate) navigator.vibrate(50);
  mostrarToast('Histórico de vendas zerado e todos os estoques restaurados!');

  renderizarHistoricoVendas();
  if (onVendaRealizadaCallback) {
    onVendaRealizadaCallback();
  }

  logSync('LOCAL', 'Histórico de vendas limpo localmente e enfileirado na Outbox.');
  processarOutbox();
}

/**
 * Vincula eventos dos botões no modal de seleção de variação.
 */
export function configurarEventosSelecaoVariacao() {
  const btnAvancar = document.getElementById('btnConfirmarSelecaoVariacao');
  btnAvancar?.addEventListener('click', () => {
    const { produto, varianteSelecionada } = selecaoVariacaoAtiva;
    if (!produto || !varianteSelecionada) return;

    fecharModalAtual();
    abrirModalConfirmacaoVenda(produto, varianteSelecionada);
  });

  // Botão "Adicionar à Sacola" no modal de seleção de variação
  const btnAddSacola = document.getElementById('btnAdicionarVarSacola');
  btnAddSacola?.addEventListener('click', () => {
    adicionarVarianteSelecionadaAoCarrinho();
  });

  // Stepper de quantidade no modal de seleção de variação
  document.getElementById('btnSelVarQtdMenos')?.addEventListener('click', () => ajustarQtdSelecaoVariacao(-1));
  document.getElementById('btnSelVarQtdMais')?.addEventListener('click', () => ajustarQtdSelecaoVariacao(1));

  // Botão "Adicionar à Sacola" no modal de venda rápida simples
  document.getElementById('btnVendaAdicionarSacola')?.addEventListener('click', () => {
    adicionarItemVendaEmAndamentoAoCarrinho();
  });
}

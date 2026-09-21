// js/vendas.js — Registro de Vendas Rápidas, Histórico e Estornos Transacionais
// Versão: v23.0 (Suporte a Variações de Produto, Baixa Atômica por Combinação e Histórico Estruturado)

import { state, salvarLocal, enfileirarMutacao } from './state.js';
import { formatarMoedaExibicao, mostrarToast, abrirModal, fecharModalAtual, refreshIcons, pedirConfirmacao, obterImagemProdutoResolvida } from './utils.js';
import { processarOutbox, logSync } from './sync_engine.js';

let onVendaRealizadaCallback = null;
let selecaoVariacaoAtiva = {
  produto: null,
  atributosSelecionados: {},
  varianteSelecionada: null
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

  const nomeElem = document.getElementById('selVarProdNome');
  const precoElem = document.getElementById('selVarProdPreco');
  const thumbBox = document.getElementById('selVarProdThumb');
  const containerDims = document.getElementById('selVarDimensoesContainer');

  if (nomeElem) nomeElem.innerText = prod.nome;
  if (precoElem) precoElem.innerText = `R$ ${formatarMoedaExibicao(prod.preco_venda)}`;

  if (thumbBox) {
    thumbBox.innerHTML = prod.imagem
      ? `<img src="${prod.imagem}" alt="${prod.nome}">`
      : `<i data-lucide="package" style="width: 24px; height: 24px; opacity: 0.4;"></i>`;
  }

  // Identifica dimensões disponíveis (Cor, Tamanho, etc.)
  let dimensoes = [];
  if (Array.isArray(prod.variacoes) && prod.variacoes.length > 0) {
    dimensoes = prod.variacoes.filter(v => v.nome && v.valores?.length > 0);
  } else if (prod.variantes[0]?.combinacao) {
    // Fallback: infere dimensões da primeira variante
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

        // Atualiza estado visual dos chips desta dimensão
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
      ? `<img src="${fotoResolvida}" alt="${prod.nome}">`
      : `<i data-lucide="package" style="width: 24px; height: 24px; opacity: 0.4;"></i>`;
    refreshIcons();
  }

  const nomeCombElem = document.getElementById('selVarCombinacaoNome');
  const badgeEstoque = document.getElementById('selVarEstoqueBadge');
  const precoFinalElem = document.getElementById('selVarPrecoFinal');
  const btnConfirmar = document.getElementById('btnConfirmarSelecaoVariacao');
  const skuTagElem = document.getElementById('selVarSkuTag');

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
    if (precoFinalElem) precoFinalElem.innerText = `R$ ${formatarMoedaExibicao(preco)}`;

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

    if (btnConfirmar) {
      btnConfirmar.disabled = est <= 0;
      btnConfirmar.style.opacity = est <= 0 ? '0.5' : '1';
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
  }
}

/**
 * Abre o modal de venda rápida (quantidade e método de pagamento) para o produto ou variante selecionada.
 */
function abrirModalConfirmacaoVenda(prod, variante = null) {
  state.vendaEmAndamento = {
    produto: prod,
    variante: variante,
    quantidade: 1
  };

  const precoUnitario = variante?.preco_venda || prod.preco_venda;
  const nomeExibicao = variante ? `${prod.nome} — ${variante.nome_combinacao}` : prod.nome;

  document.getElementById('vendaProdNome').innerText = nomeExibicao;
  document.getElementById('vendaPrecoUnit').innerText = `R$ ${formatarMoedaExibicao(precoUnitario)}`;
  document.getElementById('vendaQtdVal').innerText = '1';
  document.getElementById('vendaTotalFinal').innerText = `R$ ${formatarMoedaExibicao(precoUnitario)}`;

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

// ==============================================================================
// 2. AJUSTE DE QUANTIDADE E FORMA DE PAGAMENTO
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
  elem.classList.add('active');
}

// ==============================================================================
// 3. CONFIRMAÇÃO DE VENDA E BAIXA TRANSACIONAL ATÔMICA
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

  const precoUnit = variante?.preco_venda || p.preco_venda;
  const custoUnit = variante?.preco_custo || p.preco_custo;
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

  // 2. Registro oficial de venda com atributos estruturados de variação e snapshot de SKU
  const novaVenda = {
    id: crypto.randomUUID(),
    produto_id: p.id,
    nome_produto: p.nome,
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
  mostrarToast(`Venda de R$ ${formatarMoedaExibicao(valTotal)} registrada!`);

  if (onVendaRealizadaCallback) onVendaRealizadaCallback();

  logSync('LOCAL', `Venda ${novaVenda.id} (${descVenda}) concluída e enfileirada.`);
  processarOutbox();
}

// ==============================================================================
// 4. HISTÓRICO DE VENDAS E ESTORNO COM RESTAURAÇÃO DE ESTOQUE DE VARIANTE
// ==============================================================================

export function renderizarHistoricoVendas() {
  const container = document.getElementById('salesList');
  const contador = document.getElementById('salesCountBadge');
  if (!container) return;
  container.innerHTML = '';

  const vendasAtivas = state.vendas.filter(v => !v.estornada);

  if (contador) contador.innerText = `${vendasAtivas.length} ${vendasAtivas.length === 1 ? 'venda registrada' : 'vendas registradas'}`;

  const btnLimpar = document.getElementById('btnLimparVendas');
  if (btnLimpar) {
    btnLimpar.style.display = vendasAtivas.length > 0 ? 'inline-flex' : 'none';
  }

  if (vendasAtivas.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <i data-lucide="receipt" style="width: 48px; height: 48px; margin-bottom: 10px; opacity: 0.5;"></i>
        <p>Nenhuma venda registrada ainda.</p>
      </div>`;
    refreshIcons();
    return;
  }

  vendasAtivas.forEach((v, index) => {
    if (!v.id) {
      v.id = crypto.randomUUID();
    }

    const dataFormatada = new Date(v.created_at).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    const prodAtual = state.produtos.find(p => p.id === v.produto_id);
    const nomeBase = prodAtual ? prodAtual.nome : (v.nome_produto || 'Produto');

    // Se a venda teve variação registrada, exibe badge com a combinação
    const badgeVar = v.variacao_nome
      ? `<span class="category-badge" style="font-size: 10px; padding: 1px 6px; margin-left: 6px; background: rgba(245, 158, 11, 0.12); color: var(--primary); border-color: rgba(245, 158, 11, 0.3); font-weight: 600;">${v.variacao_nome}</span>`
      : '';

    // Se a venda possui SKU registrado, exibe discretamente
    const badgeSku = v.sku
      ? `<span style="font-size: 9.5px; font-family: monospace; color: var(--text-muted); background: rgba(255, 255, 255, 0.06); padding: 1px 5px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.08); margin-left: 4px;">SKU: ${v.sku}</span>`
      : '';

    let metodoPgto = v.metodo_pagamento || 'Outro';
    if (metodoPgto.toLowerCase().includes('crédito') || metodoPgto.toLowerCase().includes('credito')) {
      metodoPgto = 'Crédito';
    } else if (metodoPgto.toLowerCase().includes('débito') || metodoPgto.toLowerCase().includes('debito')) {
      metodoPgto = 'Débito';
    }

    const item = document.createElement('div');
    item.className = 'sale-item';
    item.setAttribute('data-sale-id', v.id);
    item.innerHTML = `
      <div class="sale-top-row">
        <div class="sale-prod" style="display: flex; align-items: center; flex-wrap: wrap;">
          <span>${v.quantidade}x ${nomeBase}</span>
          ${badgeVar}
          ${badgeSku}
        </div>
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
          <span class="sale-time">${dataFormatada}</span>
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

    btnUndo?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();

      if (btnUndo.classList.contains('confirming')) {
        if (confirmTimer) clearTimeout(confirmTimer);
        executarEstorno(v.id, index, item);
      } else {
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

/**
 * Executa o estorno devolvendo o estoque para a variante específica e para o produto pai.
 */
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
  if (venda.estornada) {
    mostrarToast('Esta venda já foi estornada anteriormente.');
    return;
  }

  const prodAtual = state.produtos.find(p => p.id === venda.produto_id);
  const qtdEstorno = parseInt(venda.quantidade, 10) || 1;
  const agoraIso = new Date().toISOString();

  if (itemElement) {
    itemElement.classList.add('removing');
  }

  // 1. Devolve estoque para a variante específica e para o produto pai
  if (prodAtual) {
    if (venda.variante_id && prodAtual.tem_variacoes && Array.isArray(prodAtual.variantes)) {
      const varAlvo = prodAtual.variantes.find(v => v.id === venda.variante_id);
      if (varAlvo) {
        varAlvo.estoque_atual = (parseInt(varAlvo.estoque_atual, 10) || 0) + qtdEstorno;
      }
    }
    prodAtual.estoque_atual = (parseInt(prodAtual.estoque_atual, 10) || 0) + qtdEstorno;
    prodAtual.updated_at = agoraIso;
  }

  venda.estornada = true;
  venda.estornada_em = agoraIso;
  venda.estorno_operador = state.operador || 'Operador';
  venda.updated_at = agoraIso;

  state.vendas.splice(index, 1);

  // 2. Enfileira mutação transacional na Outbox persistente
  enfileirarMutacao('ESTORNO_TRANSACIONAL', 'vendas', venda.id, {
    operador: state.operador || 'Operador',
    produto_id: venda.produto_id,
    quantidade: qtdEstorno,
    variante_id: venda.variante_id || null
  });

  if (prodAtual) {
    enfileirarMutacao('PRODUTO_UPSERT', 'produtos', prodAtual.id, { ...prodAtual });
  }
  salvarLocal();

  if (navigator.vibrate) navigator.vibrate(40);
  const nomeItem = venda.variacao_nome ? `${prodAtual?.nome || 'Produto'} (${venda.variacao_nome})` : (prodAtual?.nome || 'Produto');
  mostrarToast(`Estorno concluído! +${qtdEstorno} "${nomeItem}" voltou ao estoque.`);

  setTimeout(() => {
    renderizarHistoricoVendas();
    if (onVendaRealizadaCallback) {
      onVendaRealizadaCallback();
    }
  }, 180);

  logSync('LOCAL', `Estorno da venda ${venda.id} executado localmente e enfileirado.`);
  processarOutbox();
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
 * Vincula o botão de confirmar do modal de seleção de variação para avançar ao checkout.
 */
export function configurarEventosSelecaoVariacao() {
  const btnAvancar = document.getElementById('btnConfirmarSelecaoVariacao');
  btnAvancar?.addEventListener('click', () => {
    const { produto, varianteSelecionada } = selecaoVariacaoAtiva;
    if (!produto || !varianteSelecionada) return;

    fecharModalAtual();
    abrirModalConfirmacaoVenda(produto, varianteSelecionada);
  });
}


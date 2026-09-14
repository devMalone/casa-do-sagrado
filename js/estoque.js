// js/estoque.js — Catálogo de Produtos e Controle de Estoque

import { state, salvarLocal } from './state.js';
import { formatarMoedaExibicao, parseMonetaryValue, mostrarToast, abrirModal, fecharModalAtual, refreshIcons, pedirConfirmacao } from './utils.js';
import { renderizarCategoriasUI } from './categorias.js';

let onQuickSellCallback = null;

export function setOnQuickSellCallback(fn) {
  onQuickSellCallback = fn;
}

export function renderizarEstoque() {
  const container = document.getElementById('productsList');
  if (!container) return;
  container.innerHTML = '';

  const filtrados = state.produtos.filter(p => {
    const matchesCat = state.categoriaFiltro === 'todos' || p.categoria === state.categoriaFiltro;
    const matchesBusca = p.nome.toLowerCase().includes(state.buscaFiltro.toLowerCase()) || 
                         p.categoria.toLowerCase().includes(state.buscaFiltro.toLowerCase());
    return matchesCat && matchesBusca;
  });

  if (filtrados.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <i data-lucide="package-open" style="width: 48px; height: 48px; margin-bottom: 10px; opacity: 0.5;"></i>
        <p>Nenhum produto cadastrado no catálogo.</p>
      </div>`;
    refreshIcons();
    return;
  }

  filtrados.forEach(p => {
    let stockClass = 'ok';
    let stockText = `${p.estoque_atual} em estoque`;
    let cardAlertClass = '';

    if (p.estoque_atual <= 0) {
      stockClass = 'empty';
      stockText = 'Esgotado';
      cardAlertClass = 'out-stock';
    } else if (p.estoque_atual <= p.estoque_minimo) {
      stockClass = 'low';
      stockText = `Apenas ${p.estoque_atual} un`;
      cardAlertClass = 'low-stock';
    }

    const card = document.createElement('div');
    card.className = `product-card ${cardAlertClass}`;
    card.innerHTML = `
      <div class="product-header">
        <div class="product-title">${p.nome}</div>
        <span class="category-badge">${p.categoria}</span>
      </div>
      <div class="product-details">
        <div>
          <div class="price-tag">R$ ${formatarMoedaExibicao(p.preco_venda)}</div>
          <div class="cost-tag">Custo: R$ ${formatarMoedaExibicao(p.preco_custo)}</div>
        </div>
        <div class="stock-badge ${stockClass}">
          <i data-lucide="archive" style="width: 14px; height: 14px;"></i>
          ${stockText}
        </div>
      </div>
      <div class="product-actions">
        <button class="btn-quick-sell" data-sell-id="${p.id}" ${p.estoque_atual <= 0 ? 'disabled' : ''}>
          <i data-lucide="shopping-cart" style="width: 16px; height: 16px;"></i> Vender 1x
        </button>
        <button class="btn-icon-action" data-edit-id="${p.id}" title="Editar Produto">
          <i data-lucide="edit-3" style="width: 16px; height: 16px;"></i>
        </button>
      </div>
    `;

    card.querySelector('[data-sell-id]')?.addEventListener('click', () => {
      if (onQuickSellCallback) onQuickSellCallback(p.id);
    });

    card.querySelector('[data-edit-id]')?.addEventListener('click', () => {
      editarProduto(p.id);
    });

    container.appendChild(card);
  });

  refreshIcons();
}

export function filtrarProdutos() {
  const input = document.getElementById('searchInput');
  if (input) {
    state.buscaFiltro = input.value;
    renderizarEstoque();
  }
}

let onProdutoAlteradoCallback = null;

export function setOnProdutoAlteradoCallback(fn) {
  onProdutoAlteradoCallback = fn;
}

export function abrirModalProduto() {
  document.getElementById('tituloModalProd').innerText = 'Cadastrar Produto';
  document.getElementById('prodEditId').value = '';
  document.getElementById('prodNome').value = '';
  
  const inputProdCat = document.getElementById('prodCategoria');
  if (inputProdCat) {
    inputProdCat.value = state.categorias.length > 0 ? state.categorias[0] : '';
  }
  renderizarCategoriasUI();

  document.getElementById('prodPrecoCusto').value = '';
  document.getElementById('prodPrecoVenda').value = '';
  document.getElementById('prodEstoque').value = '0';
  document.getElementById('prodEstoqueMin').value = '0';

  const btnDel = document.getElementById('btnExcluirProduto');
  if (btnDel) btnDel.style.display = 'none';

  abrirModal('modalProduto');
}

export function editarProduto(id) {
  const p = state.produtos.find(prod => prod.id === id);
  if (!p) return;

  document.getElementById('tituloModalProd').innerText = 'Editar Produto';
  document.getElementById('prodEditId').value = p.id;
  document.getElementById('prodNome').value = p.nome;

  const inputProdCat = document.getElementById('prodCategoria');
  if (inputProdCat) {
    inputProdCat.value = p.categoria;
  }
  renderizarCategoriasUI();

  document.getElementById('prodPrecoCusto').value = formatarMoedaExibicao(p.preco_custo);
  document.getElementById('prodPrecoVenda').value = formatarMoedaExibicao(p.preco_venda);
  document.getElementById('prodEstoque').value = p.estoque_atual;
  document.getElementById('prodEstoqueMin').value = p.estoque_minimo;

  const btnDel = document.getElementById('btnExcluirProduto');
  if (btnDel) btnDel.style.display = 'flex';
  
  abrirModal('modalProduto');
}

export async function excluirProdutoAtual() {
  const id = document.getElementById('prodEditId')?.value;
  if (!id) return;
  const prod = state.produtos.find(p => p.id === id);
  const nome = prod ? prod.nome : 'este produto';

  const confirmou = await pedirConfirmacao({
    titulo: 'Excluir Produto',
    mensagem: `Tem certeza que deseja remover "${nome}" do catálogo e estoque?`,
    textoConfirmar: 'Sim, excluir',
    perigo: true
  });

  if (confirmou) {
    state.produtos = state.produtos.filter(p => p.id !== id);
    salvarLocal();
    fecharModalAtual();
    mostrarToast(`Produto "${nome}" excluído.`);
    renderizarEstoque();

    if (state.supabase) {
      state.supabase.from('casa_produtos').delete().eq('id', id)
        .catch(err => console.warn('[Sync] Erro ao deletar produto:', err));
    }
  }
}

export function salvarProduto() {
  const id = document.getElementById('prodEditId').value;
  const nome = document.getElementById('prodNome').value.trim();
  const categoria = document.getElementById('prodCategoria').value || (state.categorias.length > 0 ? state.categorias[0] : 'Geral');
  const preco_custo = parseMonetaryValue(document.getElementById('prodPrecoCusto').value);
  const preco_venda = parseMonetaryValue(document.getElementById('prodPrecoVenda').value);
  const estoque_atual = parseInt(document.getElementById('prodEstoque').value, 10) || 0;
  const estoque_minimo = parseInt(document.getElementById('prodEstoqueMin').value, 10) || 0;

  if (!nome || preco_venda <= 0) {
    mostrarToast('Preencha o nome e um preço de venda válido.');
    return;
  }

  if (id) {
    const p = state.produtos.find(prod => prod.id === id);
    if (p) {
      p.nome = nome;
      p.categoria = categoria;
      p.preco_custo = preco_custo;
      p.preco_venda = preco_venda;
      p.estoque_atual = estoque_atual;
      p.estoque_minimo = estoque_minimo;
      p.updated_at = new Date().toISOString();

      // Sincroniza o novo nome do produto em todas as vendas já registradas
      state.vendas.forEach(v => {
        if (v.produto_id === id) {
          v.nome_produto = nome;
        }
      });
    }
  } else {
    const novo = {
      id: crypto.randomUUID(),
      nome,
      categoria,
      preco_custo,
      preco_venda,
      estoque_atual,
      estoque_minimo,
      ativo: true,
      created_at: new Date().toISOString()
    };
    state.produtos.unshift(novo);
  }

  salvarLocal();
  fecharModalAtual();
  mostrarToast('Produto salvo com sucesso!');
  renderizarEstoque();

  if (onProdutoAlteradoCallback) {
    onProdutoAlteradoCallback();
  }

  if (state.supabase) {
    const itemSalvo = id ? state.produtos.find(prod => prod.id === id) : state.produtos[0];
    state.supabase.from('casa_produtos').upsert([itemSalvo])
      .catch(err => console.warn('[Sync] Erro upsert produto:', err));

    if (id) {
      state.supabase.from('casa_vendas').update({ nome_produto: nome }).eq('produto_id', id)
        .catch(err => console.warn('[Sync] Erro atualizar nome em vendas:', err));
    }
  }
}

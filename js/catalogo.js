// js/catalogo.js — Módulo de Catálogo Visual / Vitrine de Produtos

import { state, salvarLocal } from './state.js';
import { formatarMoedaExibicao, mostrarToast, abrirModal, fecharModalAtual, refreshIcons } from './utils.js';
import { editarProduto } from './estoque.js';

let onQuickSellCallback = null;

export function setOnCatalogQuickSellCallback(fn) {
  onQuickSellCallback = fn;
}

/**
 * Comprime e redimensiona imagem no lado do cliente via Canvas HTML5.
 * Reduz fotos de celulares (4-15 MB) para um Data URL WebP/JPEG leve (~30-50 KB).
 * Isso viabiliza persistência instantânea no localStorage e sincronização fluida no Supabase.
 */
export function comprimirImagem(file, maxWidth = 600, maxHeight = 600, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      return reject(new Error('O arquivo selecionado não é uma imagem válida.'));
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Preenche fundo com tom neutro caso a imagem original tenha transparência PNG
        ctx.fillStyle = '#161f2e';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        let dataUrl = '';
        try {
          dataUrl = canvas.toDataURL('image/webp', quality);
          if (!dataUrl || !dataUrl.startsWith('data:image/webp')) {
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }
        } catch (err) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        resolve(dataUrl);
      };

      img.onerror = () => reject(new Error('Falha ao decodificar os dados da imagem.'));
      img.src = e.target.result;
    };

    reader.onerror = () => reject(new Error('Falha ao ler o arquivo no dispositivo.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Renderiza a vitrine de produtos no formato de grade em blocos (conforme o esboço do usuário).
 */
export function renderizarCatalogo() {
  const container = document.getElementById('catalogGrid');
  const counterElem = document.getElementById('catalogCounter');
  if (!container) return;

  const filtrados = state.produtos.filter(p => {
    const matchesCat = state.categoriaFiltro === 'todos' || p.categoria === state.categoriaFiltro;
    const matchesBusca = p.nome.toLowerCase().includes(state.buscaFiltro.toLowerCase()) || 
                         p.categoria.toLowerCase().includes(state.buscaFiltro.toLowerCase());
    return matchesCat && matchesBusca;
  });

  if (counterElem) {
    const qtd = filtrados.length;
    counterElem.innerText = qtd === 1 ? '1 produto na vitrine' : `${qtd} produtos na vitrine`;
  }

  container.innerHTML = '';

  if (filtrados.length === 0) {
    container.innerHTML = `
      <div class="catalog-empty-state">
        <i data-lucide="layout-grid" style="width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.35;"></i>
        <p style="font-size: 14px; font-weight: 600; color: var(--text);">Nenhum item na vitrine</p>
        <p style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">Toque no botão + abaixo para cadastrar produtos com foto.</p>
      </div>`;
    refreshIcons();
    return;
  }

  filtrados.forEach(p => {
    let stockClass = 'ok';
    let stockText = `${p.estoque_atual} un`;

    if (p.estoque_atual <= 0) {
      stockClass = 'empty';
      stockText = 'Esgotado';
    } else if (p.estoque_atual <= p.estoque_minimo) {
      stockClass = 'low';
      stockText = `Apenas ${p.estoque_atual}`;
    }

    const card = document.createElement('div');
    card.className = 'catalog-card';
    card.setAttribute('data-id', p.id);

    // Miniatura com imagem real ou placeholder elegante
    const thumbHtml = p.imagem
      ? `<img src="${p.imagem}" alt="${p.nome}" class="catalog-thumb-img" loading="lazy">`
      : `<div class="catalog-thumb-placeholder">
           <i data-lucide="package" style="width: 28px; height: 28px; opacity: 0.35;"></i>
         </div>`;

    card.innerHTML = `
      <div class="catalog-thumb-box">
        ${thumbHtml}
        <span class="catalog-stock-pill ${stockClass}">${stockText}</span>
      </div>
      <div class="catalog-info">
        <div class="catalog-title" title="${p.nome}">${p.nome}</div>
        <div class="catalog-price">R$ ${formatarMoedaExibicao(p.preco_venda)}</div>
      </div>
    `;

    card.addEventListener('click', () => {
      abrirDetalheCatalogo(p.id);
    });

    container.appendChild(card);
  });

  refreshIcons();
}

let produtoVisualizadoId = null;

/**
 * Abre modal com visualização rápida/ampliada do produto da vitrine.
 */
export function abrirDetalheCatalogo(id) {
  const p = state.produtos.find(prod => prod.id === id);
  if (!p) return;

  produtoVisualizadoId = id;

  const nomeElem = document.getElementById('catalogoDetalheNome');
  const imgElem = document.getElementById('catalogoDetalheImg');
  const placeholderElem = document.getElementById('catalogoDetalhePlaceholder');
  const badgeEstoque = document.getElementById('catalogoDetalheBadgeEstoque');
  const catElem = document.getElementById('catalogoDetalheCategoria');
  const precoElem = document.getElementById('catalogoDetalhePreco');
  const custoElem = document.getElementById('catalogoDetalheCusto');
  const estoqueMinElem = document.getElementById('catalogoDetalheEstoqueMin');
  const btnVender = document.getElementById('btnVenderPeloCatalogo');

  if (nomeElem) nomeElem.innerText = p.nome;
  if (catElem) catElem.innerText = p.categoria || 'Geral';
  if (precoElem) precoElem.innerText = `R$ ${formatarMoedaExibicao(p.preco_venda)}`;
  if (custoElem) custoElem.innerText = `R$ ${formatarMoedaExibicao(p.preco_custo)}`;
  if (estoqueMinElem) estoqueMinElem.innerText = `${p.estoque_minimo} un`;

  if (p.imagem && imgElem && placeholderElem) {
    imgElem.src = p.imagem;
    imgElem.style.display = 'block';
    placeholderElem.style.display = 'none';
  } else if (imgElem && placeholderElem) {
    imgElem.src = '';
    imgElem.style.display = 'none';
    placeholderElem.style.display = 'flex';
  }

  if (badgeEstoque) {
    badgeEstoque.className = 'catalog-stock-pill';
    if (p.estoque_atual <= 0) {
      badgeEstoque.classList.add('empty');
      badgeEstoque.innerText = 'Esgotado';
    } else if (p.estoque_atual <= p.estoque_minimo) {
      badgeEstoque.classList.add('low');
      badgeEstoque.innerText = `Apenas ${p.estoque_atual} un em estoque`;
    } else {
      badgeEstoque.classList.add('ok');
      badgeEstoque.innerText = `${p.estoque_atual} un em estoque`;
    }
  }

  if (btnVender) {
    btnVender.disabled = p.estoque_atual <= 0;
  }

  abrirModal('modalDetalheCatalogo');
  refreshIcons();
}

/**
 * Inicializa os botões de ação do modal de detalhe do catálogo.
 */
export function configurarEventosCatalogo() {
  const btnVender = document.getElementById('btnVenderPeloCatalogo');
  if (btnVender) {
    btnVender.addEventListener('click', () => {
      if (!produtoVisualizadoId) return;
      const id = produtoVisualizadoId;
      fecharModalAtual();
      if (onQuickSellCallback) {
        onQuickSellCallback(id);
      }
    });
  }

  const btnEditar = document.getElementById('btnEditarPeloCatalogo');
  if (btnEditar) {
    btnEditar.addEventListener('click', () => {
      if (!produtoVisualizadoId) return;
      const id = produtoVisualizadoId;
      fecharModalAtual();
      editarProduto(id);
    });
  }

  const inputBusca = document.getElementById('catalogSearchInput');
  if (inputBusca) {
    inputBusca.addEventListener('input', () => {
      state.buscaFiltro = inputBusca.value;
      const inputEstoque = document.getElementById('searchInput');
      if (inputEstoque) inputEstoque.value = inputBusca.value;
      renderizarCatalogo();
    });
  }
}

// js/estoque.js — Catálogo de Produtos, Variações de Produto e Controle de Estoque
// Versão: v23.3 (Sistema de SKU Automático, Código de Barras e Código Comercial)

import { state, salvarLocal, enfileirarMutacao } from './state.js';
import { formatarMoedaExibicao, parseMonetaryValue, mostrarToast, abrirModal, fecharModalAtual, refreshIcons, pedirConfirmacao, normalizarSku, gerarSkuAutomaticoProduto, gerarSkuVariante, validarUnicidadeSku } from './utils.js';
import { renderizarCategoriasUI, renderizarCategoriasFormProduto, criarCategoriaRapida, criarSubcategoriaRapida } from './categorias.js';
import { abrirCropperFoto } from './catalogo.js';
import { processarOutbox, logSync } from './sync_engine.js';
import { salvarImagemLocal, removerImagemLocal, salvarImagemOriginal, obterImagemOriginal, removerImagemOriginal } from './indexed_db.js';

let onQuickSellCallback = null;
let onProdutoAlteradoCallback = null;

// Estados temporários do formulário de produto
let variacoesEmEdicao = [];
let variantesEmEdicao = [];
let fotoOriginalTemporaria = null;
let fotoCropTemporario = null;
let alvoFotoAtiva = null;

export function setOnQuickSellCallback(fn) {
  onQuickSellCallback = fn;
}

export function setOnProdutoAlteradoCallback(fn) {
  onProdutoAlteradoCallback = fn;
}

// ==============================================================================
// 1. RENDERIZAÇÃO DA LISTA DE ESTOQUE COM FILTROS DE CATEGORIA E SUBCATEGORIA
// ==============================================================================

export function renderizarEstoque() {
  const container = document.getElementById('productsList');
  if (!container) return;
  container.innerHTML = '';

  const filtrados = state.produtos.filter(p => {
    const matchesCat = state.categoriaFiltro === 'todos' || p.categoria === state.categoriaFiltro;
    const matchesSubcat = state.subcategoriaFiltro === 'todas' || p.subcategoria === state.subcategoriaFiltro;
    const busca = state.buscaFiltro.toLowerCase().trim();
    const matchesSku = (p.sku && p.sku.toLowerCase().includes(busca)) ||
                       (p.codigo_barras && p.codigo_barras.toLowerCase().includes(busca)) ||
                       (p.tem_variacoes && Array.isArray(p.variantes) && p.variantes.some(v => v.sku && v.sku.toLowerCase().includes(busca)));
    const matchesBusca = p.nome.toLowerCase().includes(busca) || 
                         (p.categoria && p.categoria.toLowerCase().includes(busca)) ||
                         (p.subcategoria && p.subcategoria.toLowerCase().includes(busca)) ||
                         matchesSku;
    return matchesCat && matchesSubcat && matchesBusca;
  });

  if (filtrados.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <i data-lucide="package-open" style="width: 48px; height: 48px; margin-bottom: 10px; opacity: 0.5;"></i>
        <p>Nenhum produto cadastrado no catálogo com os filtros atuais.</p>
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

    const thumbHtml = p.imagem
      ? `<img src="${p.imagem}" alt="${p.nome}" class="product-mini-thumb" loading="lazy">`
      : `<div class="product-mini-placeholder"><i data-lucide="package" style="width: 18px; height: 18px; opacity: 0.35;"></i></div>`;

    const subBadgeHtml = p.subcategoria
      ? `<span class="category-badge" style="font-size: 10px; padding: 2px 6px; background: rgba(56, 189, 248, 0.12); color: #38bdf8; border-color: rgba(56, 189, 248, 0.3);">${p.subcategoria}</span>`
      : '';

    const varBadgeHtml = p.tem_variacoes
      ? `<span class="category-badge" style="font-size: 10px; padding: 2px 6px; background: rgba(245, 158, 11, 0.12); color: var(--primary); border-color: rgba(245, 158, 11, 0.3); display: inline-flex; align-items: center; gap: 3px;">
           <i data-lucide="layers" style="width: 10px; height: 10px;"></i> ${p.variantes?.length || 0} variações
         </span>`
      : '';

    const skuBadgeHtml = p.sku
      ? `<span class="category-badge" style="font-size: 10px; padding: 2px 6px; font-family: monospace; background: rgba(255, 255, 255, 0.06); color: var(--text-muted); border-color: rgba(255, 255, 255, 0.12);" title="SKU do produto">
           <i data-lucide="tag" style="width: 9px; height: 9px;"></i> ${p.sku}
         </span>`
      : '';

    const card = document.createElement('div');
    card.className = `product-card ${cardAlertClass}`;
    card.innerHTML = `
      <div class="product-header">
        <div class="product-header-left">
          ${thumbHtml}
          <div class="product-title-wrap">
            <div class="product-title">${p.nome}</div>
            <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap; margin-top: 2px;">
              <span class="category-badge">${p.categoria}</span>
              ${subBadgeHtml}
              ${varBadgeHtml}
              ${skuBadgeHtml}
            </div>
          </div>
        </div>
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
    const inputCatalogo = document.getElementById('catalogSearchInput');
    if (inputCatalogo) inputCatalogo.value = input.value;
    renderizarEstoque();
  }
}

// ==============================================================================
// 2. CONSTRUTOR DINÂMICO DE VARIAÇÕES E COMBINAÇÕES CARTESIANAS
// ==============================================================================

/**
 * Adiciona um novo tipo de variação (ex: Cor, Tamanho, Aroma).
 */
export function adicionarTipoVariacao(nomeInicial = '') {
  const novoId = 'var_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  variacoesEmEdicao.push({
    id: novoId,
    nome: nomeInicial,
    valores: [],
    fotos: {},
    fotos_crop: {}
  });
  renderizarConstrutorVariacoesUI();
}

/**
 * Remove um tipo de variação e regenera combinações.
 */
export function removerTipoVariacao(varId) {
  variacoesEmEdicao = variacoesEmEdicao.filter(v => v.id !== varId);
  recalcularCombinacoesCartesianas();
  renderizarConstrutorVariacoesUI();
}

/**
 * Adiciona um valor (tag) a uma variação específica.
 */
export function adicionarValorVariacao(varId, valorTexto) {
  if (!valorTexto) return;
  const texto = valorTexto.trim();
  if (!texto) return;

  const varObj = variacoesEmEdicao.find(v => v.id === varId);
  if (!varObj) return;

  if (varObj.valores.some(val => val.toLowerCase() === texto.toLowerCase())) {
    mostrarToast(`O valor "${texto}" já foi adicionado a esta variação.`);
    return;
  }

  varObj.valores.push(texto);
  recalcularCombinacoesCartesianas();
  renderizarConstrutorVariacoesUI();
}

/**
 * Remove um valor de uma variação específica.
 */
export function removerValorVariacao(varId, valorTexto) {
  const varObj = variacoesEmEdicao.find(v => v.id === varId);
  if (!varObj) return;

  varObj.valores = varObj.valores.filter(v => v !== valorTexto);
  if (varObj.fotos && varObj.fotos[valorTexto]) {
    delete varObj.fotos[valorTexto];
  }
  if (varObj.fotos_crop && varObj.fotos_crop[valorTexto]) {
    delete varObj.fotos_crop[valorTexto];
  }
  if (varObj.fotos_originais && varObj.fotos_originais[valorTexto]) {
    delete varObj.fotos_originais[valorTexto];
  }
  recalcularCombinacoesCartesianas();
  renderizarConstrutorVariacoesUI();
}

/**
 * Gera o produto cartesiano a partir de um array de dimensões com valores.
 */
function calcularProdutoCartesiano(dimensoes) {
  if (dimensoes.length === 0) return [];
  return dimensoes.reduce((acumulado, dim) => {
    const resultado = [];
    acumulado.forEach(obj => {
      dim.valores.forEach(val => {
        resultado.push({ ...obj, [dim.nome]: val });
      });
    });
    return resultado;
  }, [{}]);
}

/**
 * Recalcula as combinações preservando estoques e dados opcionais já digitados pelo usuário.
 */
export function recalcularCombinacoesCartesianas() {
  const dimValidas = variacoesEmEdicao.filter(v => v.nome.trim() && v.valores.length > 0);
  const inputEstoque = document.getElementById('prodEstoque');
  const badgeSoma = document.getElementById('prodEstoqueVariacoesBadge');
  const wrapperCombinacoes = document.getElementById('variacoesCombinacoesWrapper');

  if (dimValidas.length === 0) {
    variantesEmEdicao = [];
    if (wrapperCombinacoes) wrapperCombinacoes.style.display = 'none';
    if (inputEstoque) {
      inputEstoque.readOnly = false;
      inputEstoque.style.background = '';
    }
    if (badgeSoma) badgeSoma.style.display = 'none';
    return;
  }

  // Gera combinações cartesianas
  const cartesianas = calcularProdutoCartesiano(dimValidas);

  // Mapeia variantes anteriores por chave de combinação para reaproveitar estoque já digitado e SKUs estáveis
  const mapaAntigo = new Map();
  variantesEmEdicao.forEach(varItem => {
    const chave = Object.entries(varItem.combinacao || {})
      .map(([k, v]) => `${k}:${v}`)
      .sort()
      .join('|');
    mapaAntigo.set(chave, varItem);
  });

  const skuBaseInput = document.getElementById('prodSku')?.value?.trim();
  const nomeInput = document.getElementById('prodNome')?.value?.trim();
  const catInput = document.getElementById('prodCategoria')?.value?.trim();
  const prodId = document.getElementById('prodEditId')?.value || null;
  const skuBase = normalizarSku(skuBaseInput) || gerarSkuAutomaticoProduto(nomeInput, catInput, prodId);

  const novasVariantes = cartesianas.map((comb, idx) => {
    const chave = Object.entries(comb)
      .map(([k, v]) => `${k}:${v}`)
      .sort()
      .join('|');

    const existente = mapaAntigo.get(chave);
    const nomeComb = Object.values(comb).join(' / ');

    if (existente) {
      return {
        ...existente,
        combinacao: comb,
        nome_combinacao: nomeComb,
        sku: existente.sku ? normalizarSku(existente.sku) : gerarSkuVariante(skuBase, comb, idx),
        imagem: existente.imagem || null,
        foto_crop: existente.foto_crop || null
      };
    }

    return {
      id: crypto.randomUUID(),
      combinacao: comb,
      nome_combinacao: nomeComb,
      estoque_atual: 0,
      estoque_minimo: 2,
      sku: gerarSkuVariante(skuBase, comb, idx),
      preco_venda: null,
      preco_custo: null,
      imagem: null,
      foto_crop: null,
      ativo: true
    };
  });

  variantesEmEdicao = novasVariantes;

  // Atualiza o estoque total do produto no input geral (soma de todas as combinações)
  sincronizarEstoqueTotalVariantes();

  if (wrapperCombinacoes) wrapperCombinacoes.style.display = 'block';
  if (inputEstoque) {
    inputEstoque.readOnly = true;
    inputEstoque.style.background = 'rgba(255, 255, 255, 0.05)';
  }
  if (badgeSoma) badgeSoma.style.display = 'inline';
}

/**
 * Soma os estoques de cada combinação e atualiza o input de estoque geral.
 */
function sincronizarEstoqueTotalVariantes() {
  const inputEstoque = document.getElementById('prodEstoque');
  const contadorCombTxt = document.getElementById('variacoesTotalCombinacoesTxt');

  const total = variantesEmEdicao.reduce((acc, v) => acc + (parseInt(v.estoque_atual, 10) || 0), 0);
  if (inputEstoque && variantesEmEdicao.length > 0) {
    inputEstoque.value = total;
  }
  if (contadorCombTxt) {
    contadorCombTxt.innerText = `${variantesEmEdicao.length} ${variantesEmEdicao.length === 1 ? 'combinação' : 'combinações'}`;
  }
}

/**
 * Renderiza a interface do construtor de variações e da tabela de combinações.
 */
function renderizarConstrutorVariacoesUI() {
  const containerDefs = document.getElementById('variacoesDefinicoesContainer');
  const containerCombs = document.getElementById('variacoesCombinacoesContainer');
  if (!containerDefs || !containerCombs) return;

  // 1. Renderiza Cards de Definição de Tipos de Variação
  if (variacoesEmEdicao.length === 0) {
    containerDefs.innerHTML = `
      <div style="font-size: 12px; color: var(--text-muted); padding: 8px 0;">
        Nenhuma variação adicionada. Este produto é um produto simples.
      </div>`;
  } else {
    containerDefs.innerHTML = variacoesEmEdicao.map(varObj => {
      const chipsHtml = varObj.valores.map(val => `
        <span class="variation-value-chip">
          <span>${val}</span>
          <span class="variation-value-chip-del" data-del-var="${varObj.id}" data-del-val="${val}" title="Remover valor">×</span>
        </span>
      `).join('');

      const temValores = varObj.valores.length > 0;
      const fotosBlocoHtml = temValores ? `
        <div class="var-values-photos-container">
          <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.5px;">
            Fotos por Variação (Opcional):
          </div>
          ${varObj.valores.map(val => {
            const fotoUrl = varObj.fotos && varObj.fotos[val];
            return `
              <div class="var-value-photo-row">
                <div class="var-value-photo-name">
                  <i data-lucide="tag" style="width: 12px; height: 12px; opacity: 0.5;"></i>
                  <span>${val}</span>
                </div>
                <div class="var-value-photo-actions">
                  ${fotoUrl ? `
                    <img src="${fotoUrl}" class="var-value-photo-thumb" alt="${val}">
                    <button type="button" class="btn-var-photo-action edit" data-edit-val-photo="${varObj.id}" data-val="${val}" title="Reenquadrar foto">
                      <i data-lucide="crop" style="width: 12px; height: 12px;"></i> Editar
                    </button>
                    <button type="button" class="btn-var-photo-action remove" data-rem-val-photo="${varObj.id}" data-val="${val}" title="Remover foto desta variação">
                      <i data-lucide="x" style="width: 12px; height: 12px;"></i> Remover
                    </button>
                  ` : `
                    <button type="button" class="btn-var-photo-action add" data-add-val-photo="${varObj.id}" data-val="${val}">
                      <i data-lucide="camera" style="width: 12px; height: 12px;"></i> Adicionar foto
                    </button>
                  `}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : '';

      return `
        <div class="variation-card" data-var-card="${varObj.id}">
          <div class="variation-card-top">
            <input type="text" class="variation-name-input" placeholder="Tipo (ex: Cor, Tamanho, Aroma...)" value="${varObj.nome}" data-var-id="${varObj.id}" list="sugestoesVariacoes">
            <button type="button" class="btn-remove-var-type" data-remove-var="${varObj.id}" title="Remover este tipo de variação">
              <i data-lucide="trash-2" style="width: 15px; height: 15px;"></i>
            </button>
          </div>
          <div class="variation-values-list">
            ${chipsHtml}
          </div>
          <div class="variation-add-val-row">
            <input type="text" class="variation-val-input" placeholder="Novo valor (ex: Branca, 18 cm...) e aperte Enter" data-input-val="${varObj.id}">
            <button type="button" class="btn-add-val" data-btn-add-val="${varObj.id}">
              <i data-lucide="plus" style="width: 13px; height: 13px;"></i> Adicionar
            </button>
          </div>
          ${fotosBlocoHtml}
        </div>
      `;
    }).join('');

    // Adiciona datalist para auto-completar sugestões comuns
    if (!document.getElementById('sugestoesVariacoes')) {
      const dl = document.createElement('datalist');
      dl.id = 'sugestoesVariacoes';
      dl.innerHTML = `
        <option value="Cor">
        <option value="Tamanho">
        <option value="Aroma">
        <option value="Modelo">
        <option value="Material">
        <option value="Peso">
        <option value="Quantidade">
        <option value="Acabamento">
      `;
      document.body.appendChild(dl);
    }

    // Vincula eventos aos inputs de nome do tipo de variação
    containerDefs.querySelectorAll('.variation-name-input').forEach(input => {
      input.addEventListener('change', e => {
        const id = e.target.getAttribute('data-var-id');
        const varObj = variacoesEmEdicao.find(v => v.id === id);
        if (varObj) {
          varObj.nome = e.target.value.trim();
          recalcularCombinacoesCartesianas();
          renderizarConstrutorVariacoesUI();
        }
      });
    });

    // Vincula botões de remover tipo de variação
    containerDefs.querySelectorAll('[data-remove-var]').forEach(btn => {
      btn.addEventListener('click', () => {
        removerTipoVariacao(btn.getAttribute('data-remove-var'));
      });
    });

    // Vincula botões de adicionar valor
    containerDefs.querySelectorAll('[data-btn-add-val]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-btn-add-val');
        const input = containerDefs.querySelector(`[data-input-val="${id}"]`);
        if (input && input.value.trim()) {
          adicionarValorVariacao(id, input.value);
          input.value = '';
        }
      });
    });

    // Vincula tecla Enter no campo de novo valor
    containerDefs.querySelectorAll('[data-input-val]').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const id = input.getAttribute('data-input-val');
          if (input.value.trim()) {
            adicionarValorVariacao(id, input.value);
            input.value = '';
          }
        }
      });
    });

    // Vincula botões de remoção de cada tag de valor
    containerDefs.querySelectorAll('[data-del-val]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-del-var');
        const val = btn.getAttribute('data-del-val');
        removerValorVariacao(id, val);
      });
    });

    // Vincula botões de fotos por valor de variação
    containerDefs.querySelectorAll('[data-add-val-photo]').forEach(btn => {
      btn.addEventListener('click', () => {
        const varId = btn.getAttribute('data-add-val-photo');
        const val = btn.getAttribute('data-val');
        alvoFotoAtiva = { tipo: 'valor_variacao', varId, val };
        abrirEscolhaOrigemFoto(`Foto para: ${val}`);
      });
    });

    containerDefs.querySelectorAll('[data-edit-val-photo]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const varId = btn.getAttribute('data-edit-val-photo');
        const val = btn.getAttribute('data-val');
        const varObj = variacoesEmEdicao.find(v => v.id === varId);
        if (!varObj) return;

        alvoFotoAtiva = { tipo: 'valor_variacao', varId, val };
        const prodId = document.getElementById('prodEditId')?.value || 'temp_prod';
        let imgFonte = varObj.fotos_originais?.[val];
        if (!imgFonte) {
          imgFonte = await obterImagemOriginal(`${prodId}_val_${varObj.id}_${encodeURIComponent(val)}`);
        }
        if (!imgFonte && varObj.fotos?.[val]) {
          imgFonte = varObj.fotos[val];
        }

        if (!imgFonte) {
          mostrarToast('Nenhuma imagem disponível para reenquadramento.');
          return;
        }

        abrirCropperFoto(imgFonte, ({ croppedDataUrl, originalDataUrl, cropParams }) => {
          varObj.fotos = varObj.fotos || {};
          varObj.fotos[val] = croppedDataUrl;
          varObj.fotos_crop = varObj.fotos_crop || {};
          varObj.fotos_crop[val] = cropParams;
          varObj.fotos_originais = varObj.fotos_originais || {};
          varObj.fotos_originais[val] = originalDataUrl;
          salvarImagemOriginal(`${prodId}_val_${varObj.id}_${encodeURIComponent(val)}`, originalDataUrl).catch(() => {});
          alvoFotoAtiva = null;
          renderizarConstrutorVariacoesUI();
          mostrarToast(`Foto de "${val}" reenquadrada com sucesso!`);
        }, varObj.fotos_crop?.[val]);
      });
    });

    containerDefs.querySelectorAll('[data-rem-val-photo]').forEach(btn => {
      btn.addEventListener('click', () => {
        const varId = btn.getAttribute('data-rem-val-photo');
        const val = btn.getAttribute('data-val');
        const varObj = variacoesEmEdicao.find(v => v.id === varId);
        if (varObj && varObj.fotos) {
          delete varObj.fotos[val];
          if (varObj.fotos_crop) delete varObj.fotos_crop[val];
          if (varObj.fotos_originais) delete varObj.fotos_originais[val];
          const prodId = document.getElementById('prodEditId')?.value || 'temp_prod';
          removerImagemOriginal(`${prodId}_val_${varObj.id}_${encodeURIComponent(val)}`).catch(() => {});
          renderizarConstrutorVariacoesUI();
          mostrarToast(`Foto de "${val}" removida (usando foto principal).`);
        }
      });
    });
  }

  // 2. Renderiza Lista de Combinações Geradas
  if (variantesEmEdicao.length === 0) {
    containerCombs.innerHTML = '';
  } else {
    containerCombs.innerHTML = variantesEmEdicao.map((item, idx) => {
      return `
        <div class="combination-item" data-comb-idx="${idx}">
          <div class="combination-main-row">
            <div class="combination-tag-name">
              <span>${item.nome_combinacao.replace(/\s\/\s/g, ' • ')}</span>
              ${item.sku ? `<span style="font-size: 10px; font-family: monospace; color: var(--text-muted); margin-left: 6px; background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.08);">SKU: ${item.sku}</span>` : ''}
            </div>
            <div class="combination-stock-field">
              <label>Estoque:</label>
              <input type="number" class="combination-stock-input" value="${item.estoque_atual || 0}" min="0" data-comb-stock-idx="${idx}">
            </div>
            <button type="button" class="btn-toggle-comb-details" data-toggle-details="${idx}" title="Configurar preço/custo/SKU específico">
              <i data-lucide="sliders" style="width: 14px; height: 14px;"></i>
            </button>
          </div>
          <div class="combination-extra-fields" id="combExtra_${idx}" style="display: none;">
            <div class="comb-extra-group">
              <label>Preço Específico (R$):</label>
              <input type="text" class="comb-extra-input" placeholder="Padrão do produto" value="${item.preco_venda ? formatarMoedaExibicao(item.preco_venda) : ''}" data-comb-price-idx="${idx}">
            </div>
            <div class="comb-extra-group">
              <label>Custo Específico (R$):</label>
              <input type="text" class="comb-extra-input" placeholder="Padrão do produto" value="${item.preco_custo ? formatarMoedaExibicao(item.preco_custo) : ''}" data-comb-cost-idx="${idx}">
            </div>
            <div class="comb-extra-group">
              <label>SKU da Variante:</label>
              <input type="text" class="comb-extra-input" placeholder="Ex: VEL-000101-BRA-18" value="${item.sku || ''}" data-comb-sku-idx="${idx}" style="font-family: monospace; text-transform: uppercase;">
            </div>
            <div class="comb-extra-group">
              <label>Estoque Mínimo:</label>
              <input type="number" class="comb-extra-input" value="${item.estoque_minimo || 2}" min="0" data-comb-min-idx="${idx}">
            </div>
            <div class="comb-extra-group" style="grid-column: 1 / -1; margin-top: 4px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.08);">
              <label style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px; display: block;">Foto Específica da Combinação (Opcional):</label>
              <div style="display: flex; align-items: center; gap: 8px;">
                ${item.imagem ? `
                  <img src="${item.imagem}" class="var-value-photo-thumb" alt="${item.nome_combinacao}">
                  <button type="button" class="btn-var-photo-action edit" data-edit-comb-photo="${idx}" title="Reenquadrar foto da combinação">
                    <i data-lucide="crop" style="width: 12px; height: 12px;"></i> Editar
                  </button>
                  <button type="button" class="btn-var-photo-action remove" data-rem-comb-photo="${idx}" title="Remover foto da combinação">
                    <i data-lucide="x" style="width: 12px; height: 12px;"></i> Remover
                  </button>
                ` : `
                  <button type="button" class="btn-var-photo-action add" data-add-comb-photo="${idx}">
                    <i data-lucide="camera" style="width: 12px; height: 12px;"></i> Definir foto desta combinação
                  </button>
                `}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Vincula alteração de estoque por combinação
    containerCombs.querySelectorAll('[data-comb-stock-idx]').forEach(input => {
      input.addEventListener('input', e => {
        const idx = parseInt(e.target.getAttribute('data-comb-stock-idx'), 10);
        if (variantesEmEdicao[idx]) {
          variantesEmEdicao[idx].estoque_atual = Math.max(0, parseInt(e.target.value, 10) || 0);
          sincronizarEstoqueTotalVariantes();
        }
      });
    });

    // Vincula botão de detalhes opcionais da combinação
    containerCombs.querySelectorAll('[data-toggle-details]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = btn.getAttribute('data-toggle-details');
        const extraBox = document.getElementById(`combExtra_${idx}`);
        if (extraBox) {
          extraBox.style.display = extraBox.style.display === 'none' ? 'grid' : 'none';
        }
      });
    });

    // Vincula preço específico
    containerCombs.querySelectorAll('[data-comb-price-idx]').forEach(input => {
      input.addEventListener('change', e => {
        const idx = parseInt(e.target.getAttribute('data-comb-price-idx'), 10);
        if (variantesEmEdicao[idx]) {
          const val = parseMonetaryValue(e.target.value);
          variantesEmEdicao[idx].preco_venda = val > 0 ? val : null;
        }
      });
    });

    // Vincula custo específico
    containerCombs.querySelectorAll('[data-comb-cost-idx]').forEach(input => {
      input.addEventListener('change', e => {
        const idx = parseInt(e.target.getAttribute('data-comb-cost-idx'), 10);
        if (variantesEmEdicao[idx]) {
          const val = parseMonetaryValue(e.target.value);
          variantesEmEdicao[idx].preco_custo = val > 0 ? val : null;
        }
      });
    });

    // Vincula SKU
    containerCombs.querySelectorAll('[data-comb-sku-idx]').forEach(input => {
      input.addEventListener('change', e => {
        const idx = parseInt(e.target.getAttribute('data-comb-sku-idx'), 10);
        if (variantesEmEdicao[idx]) {
          variantesEmEdicao[idx].sku = normalizarSku(e.target.value);
          renderizarConstrutorVariacoesUI();
        }
      });
    });

    // Vincula Estoque Mínimo
    containerCombs.querySelectorAll('[data-comb-min-idx]').forEach(input => {
      input.addEventListener('change', e => {
        const idx = parseInt(e.target.getAttribute('data-comb-min-idx'), 10);
        if (variantesEmEdicao[idx]) {
          variantesEmEdicao[idx].estoque_minimo = parseInt(e.target.value, 10) || 2;
        }
      });
    });

    // Vincula botões de fotos da combinação
    containerCombs.querySelectorAll('[data-add-comb-photo]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-add-comb-photo'), 10);
        alvoFotoAtiva = { tipo: 'combinacao', combIdx: idx };
        abrirEscolhaOrigemFoto(`Foto para: ${variantesEmEdicao[idx]?.nome_combinacao || 'Combinação'}`);
      });
    });

    containerCombs.querySelectorAll('[data-edit-comb-photo]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.getAttribute('data-edit-comb-photo'), 10);
        const item = variantesEmEdicao[idx];
        if (!item) return;

        alvoFotoAtiva = { tipo: 'combinacao', combIdx: idx };
        const prodId = document.getElementById('prodEditId')?.value || 'temp_prod';
        let imgFonte = item.imagem_original;
        if (!imgFonte && item.id) {
          imgFonte = await obterImagemOriginal(`${prodId}_comb_${item.id}`);
        }
        if (!imgFonte && item.imagem) {
          imgFonte = item.imagem;
        }

        if (!imgFonte) {
          mostrarToast('Nenhuma imagem disponível para reenquadramento.');
          return;
        }

        abrirCropperFoto(imgFonte, ({ croppedDataUrl, originalDataUrl, cropParams }) => {
          item.imagem = croppedDataUrl;
          item.foto_crop = cropParams;
          item.imagem_original = originalDataUrl;
          salvarImagemOriginal(`${prodId}_comb_${item.id}`, originalDataUrl).catch(() => {});
          alvoFotoAtiva = null;
          renderizarConstrutorVariacoesUI();
          mostrarToast(`Foto de "${item.nome_combinacao}" reenquadrada com sucesso!`);
        }, item.foto_crop);
      });
    });

    containerCombs.querySelectorAll('[data-rem-comb-photo]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-rem-comb-photo'), 10);
        const item = variantesEmEdicao[idx];
        if (item) {
          delete item.imagem;
          delete item.foto_crop;
          delete item.imagem_original;
          const prodId = document.getElementById('prodEditId')?.value || 'temp_prod';
          removerImagemOriginal(`${prodId}_comb_${item.id}`).catch(() => {});
          renderizarConstrutorVariacoesUI();
          mostrarToast(`Foto da combinação removida.`);
        }
      });
    });
  }

  refreshIcons();
}

/**
 * Abre o modal de escolha de origem de foto (Câmera ou Galeria) para variação ou combinação.
 */
function abrirEscolhaOrigemFoto(titulo = 'Definir Imagem') {
  const elTitulo = document.getElementById('tituloOrigemFoto');
  if (elTitulo) elTitulo.innerText = titulo;
  abrirModal('modalOrigemFoto');
}

// ==============================================================================
// 3. ABERTURA E EDIÇÃO DO FORMULÁRIO DE PRODUTO
// ==============================================================================

export function abrirModalProduto() {
  document.getElementById('tituloModalProd').innerText = 'Cadastrar Produto';
  document.getElementById('prodEditId').value = '';
  document.getElementById('prodNome').value = '';
  document.getElementById('prodSubcategoria').value = '';

  const inputProdCat = document.getElementById('prodCategoria');
  const primCat = state.categorias.length > 0 ? (state.categorias[0].nome || state.categorias[0]) : 'Geral';
  if (inputProdCat) {
    inputProdCat.value = primCat;
  }
  renderizarCategoriasFormProduto(primCat, '');

  // SKU automático inicial e Código de Barras
  const skuAuto = gerarSkuAutomaticoProduto('', primCat);
  const inputSku = document.getElementById('prodSku');
  if (inputSku) inputSku.value = skuAuto;
  const badgeSku = document.getElementById('prodSkuBadge');
  if (badgeSku) {
    badgeSku.innerText = 'Gerado automaticamente';
    badgeSku.style.display = 'inline-block';
  }
  const inputCodBarras = document.getElementById('prodCodigoBarras');
  if (inputCodBarras) inputCodBarras.value = '';

  document.getElementById('prodPrecoCusto').value = '';
  document.getElementById('prodPrecoVenda').value = '';
  
  const inputEstoque = document.getElementById('prodEstoque');
  if (inputEstoque) {
    inputEstoque.value = '0';
    inputEstoque.readOnly = false;
    inputEstoque.style.background = '';
  }
  document.getElementById('prodEstoqueMin').value = '2';
  document.getElementById('prodEstoqueVariacoesBadge').style.display = 'none';

  // Reset de variações
  variacoesEmEdicao = [];
  variantesEmEdicao = [];
  fotoOriginalTemporaria = null;
  fotoCropTemporario = null;
  renderizarConstrutorVariacoesUI();

  // Reset de foto
  const inputFoto = document.getElementById('prodFotoBase64');
  if (inputFoto) inputFoto.value = '';
  const imgPreview = document.getElementById('prodPhotoImg');
  if (imgPreview) {
    imgPreview.src = '';
    imgPreview.style.display = 'none';
  }
  const placeholder = document.getElementById('prodPhotoPlaceholder');
  if (placeholder) placeholder.style.display = 'flex';
  const btnRemove = document.getElementById('btnRemovePhoto');
  if (btnRemove) btnRemove.style.display = 'none';
  const btnRecortar = document.getElementById('btnRecortarFoto');
  if (btnRecortar) btnRecortar.style.display = 'none';

  const btnDel = document.getElementById('btnExcluirProduto');
  if (btnDel) btnDel.style.display = 'none';

  abrirModal('modalProduto');
}

export async function editarProduto(id) {
  const p = state.produtos.find(prod => prod.id === id);
  if (!p) return;

  document.getElementById('tituloModalProd').innerText = 'Editar Produto';
  document.getElementById('prodEditId').value = p.id;
  document.getElementById('prodNome').value = p.nome;

  const inputProdCat = document.getElementById('prodCategoria');
  if (inputProdCat) {
    inputProdCat.value = p.categoria || 'Geral';
  }
  const inputProdSubcat = document.getElementById('prodSubcategoria');
  if (inputProdSubcat) {
    inputProdSubcat.value = p.subcategoria || '';
  }
  renderizarCategoriasFormProduto(p.categoria, p.subcategoria || '');

  // SKU e Código de Barras (Preserva SKU existente sem recalcular)
  const inputSku = document.getElementById('prodSku');
  const badgeSku = document.getElementById('prodSkuBadge');
  const inputCodBarras = document.getElementById('prodCodigoBarras');

  if (p.sku) {
    if (inputSku) inputSku.value = p.sku;
    if (badgeSku) badgeSku.style.display = 'none';
  } else {
    // Backfill defensivo no front para produto legado sem SKU
    const skuGerado = gerarSkuAutomaticoProduto(p.nome, p.categoria, p.id);
    if (inputSku) inputSku.value = skuGerado;
    if (badgeSku) {
      badgeSku.innerText = 'Gerado automaticamente';
      badgeSku.style.display = 'inline-block';
    }
  }

  if (inputCodBarras) inputCodBarras.value = p.codigo_barras || '';

  document.getElementById('prodPrecoCusto').value = formatarMoedaExibicao(p.preco_custo);
  document.getElementById('prodPrecoVenda').value = formatarMoedaExibicao(p.preco_venda);
  
  const inputEstoque = document.getElementById('prodEstoque');
  if (inputEstoque) {
    inputEstoque.value = p.estoque_atual;
  }
  document.getElementById('prodEstoqueMin').value = p.estoque_minimo;

  // Carrega variações existentes
  variacoesEmEdicao = Array.isArray(p.variacoes) ? JSON.parse(JSON.stringify(p.variacoes)) : [];
  variantesEmEdicao = Array.isArray(p.variantes) ? JSON.parse(JSON.stringify(p.variantes)) : [];
  fotoCropTemporario = p.foto_crop || null;
  fotoOriginalTemporaria = null;

  recalcularCombinacoesCartesianas();
  renderizarConstrutorVariacoesUI();

  // Carrega preview de foto
  const inputFoto = document.getElementById('prodFotoBase64');
  const imgPreview = document.getElementById('prodPhotoImg');
  const placeholder = document.getElementById('prodPhotoPlaceholder');
  const btnRemove = document.getElementById('btnRemovePhoto');
  const btnRecortar = document.getElementById('btnRecortarFoto');

  if (p.imagem) {
    if (inputFoto) inputFoto.value = p.imagem;
    if (imgPreview) {
      imgPreview.src = p.imagem;
      imgPreview.style.display = 'block';
    }
    if (placeholder) placeholder.style.display = 'none';
    if (btnRemove) btnRemove.style.display = 'inline-flex';
    if (btnRecortar) btnRecortar.style.display = 'inline-flex';
  } else {
    if (inputFoto) inputFoto.value = '';
    if (imgPreview) {
      imgPreview.src = '';
      imgPreview.style.display = 'none';
    }
    if (placeholder) placeholder.style.display = 'flex';
    if (btnRemove) btnRemove.style.display = 'none';
    if (btnRecortar) btnRecortar.style.display = 'none';
  }

  const btnDel = document.getElementById('btnExcluirProduto');
  if (btnDel) btnDel.style.display = 'flex';

  abrirModal('modalProduto');
}

// ==============================================================================
// 4. PERSISTÊNCIA DO PRODUTO (LOCAL-FIRST & OUTBOX COM VARIANTES)
// ==============================================================================

export function salvarProduto() {
  const id = document.getElementById('prodEditId').value;
  const nome = document.getElementById('prodNome').value.trim();
  const categoria = document.getElementById('prodCategoria').value || 'Geral';
  const subcategoria = document.getElementById('prodSubcategoria').value.trim() || null;
  const preco_custo = parseMonetaryValue(document.getElementById('prodPrecoCusto').value);
  const preco_venda = parseMonetaryValue(document.getElementById('prodPrecoVenda').value);
  const estoque_minimo = parseInt(document.getElementById('prodEstoqueMin').value, 10) || 0;
  const imagem = document.getElementById('prodFotoBase64')?.value || null;

  if (!nome || preco_venda <= 0) {
    mostrarToast('Preencha o nome e um preço de venda válido.');
    return;
  }

  // Validação e normalização de SKU comercial e Código de Barras
  let sku = normalizarSku(document.getElementById('prodSku')?.value);
  const codigo_barras = document.getElementById('prodCodigoBarras')?.value?.trim() || null;

  if (!sku) {
    sku = gerarSkuAutomaticoProduto(nome, categoria, id || null);
  }

  // 1. Validação de Unicidade do SKU Base (Namespace global da loja)
  const validacaoBase = validarUnicidadeSku(sku, id || null);
  if (!validacaoBase.valido) {
    mostrarToast(validacaoBase.erro);
    return;
  }

  // Verifica se o produto possui variações válidas ativas
  const temVariacoesAtivas = variacoesEmEdicao.some(v => v.nome.trim() && v.valores.length > 0) && variantesEmEdicao.length > 0;
  
  // 2. Validação e normalização de SKUs das variantes vendáveis
  if (temVariacoesAtivas) {
    const skusVariantesSet = new Set();
    for (let i = 0; i < variantesEmEdicao.length; i++) {
      const comb = variantesEmEdicao[i];
      let varSku = normalizarSku(comb.sku);
      if (!varSku) {
        varSku = gerarSkuVariante(sku, comb.combinacao, i);
      }
      comb.sku = varSku;

      // Impede duas variantes do mesmo produto com o mesmo SKU
      if (skusVariantesSet.has(varSku)) {
        mostrarToast(`SKU duplicado na variante "${comb.nome_combinacao}": ${varSku}`);
        return;
      }
      skusVariantesSet.add(varSku);

      // Impede que variante utilize exatamente o SKU base do produto
      if (varSku === sku) {
        mostrarToast(`O SKU da variante "${comb.nome_combinacao}" não pode ser idêntico ao SKU base do produto.`);
        return;
      }

      // Validação global contra outros produtos e variantes do catálogo
      const validacaoVar = validarUnicidadeSku(varSku, id || null, comb.id);
      if (!validacaoVar.valido) {
        mostrarToast(validacaoVar.erro);
        return;
      }
    }
  }

  let estoque_atual = 0;
  if (temVariacoesAtivas) {
    estoque_atual = variantesEmEdicao.reduce((acc, v) => acc + (parseInt(v.estoque_atual, 10) || 0), 0);
  } else {
    estoque_atual = parseInt(document.getElementById('prodEstoque').value, 10) || 0;
  }

  let itemSalvo = null;
  const agoraIso = new Date().toISOString();

  if (id) {
    const p = state.produtos.find(prod => prod.id === id);
    // Prepara cópias limpas sem fotos originais pesadas para o state e banco
    const variacoesLimpos = variacoesEmEdicao.map(v => {
      const vCopy = { ...v };
      delete vCopy.fotos_originais;
      return vCopy;
    });

    const variantesLimpos = variantesEmEdicao.map(comb => {
      const cCopy = { ...comb };
      delete cCopy.imagem_original;
      return cCopy;
    });

    if (p) {
      p.nome = nome;
      p.categoria = categoria;
      p.subcategoria = subcategoria;
      p.sku = sku;
      p.codigo_barras = codigo_barras;
      p.preco_custo = preco_custo;
      p.preco_venda = preco_venda;
      p.estoque_atual = estoque_atual;
      p.estoque_minimo = estoque_minimo;
      p.imagem = imagem;
      p.foto_crop = fotoCropTemporario || p.foto_crop || null;
      p.tem_variacoes = temVariacoesAtivas;
      p.variacoes = temVariacoesAtivas ? variacoesLimpos : [];
      p.variantes = temVariacoesAtivas ? variantesLimpos : [];
      p.updated_at = agoraIso;

      // Sincroniza nome nas vendas locais
      state.vendas.forEach(v => {
        if (v.produto_id === id) {
          v.nome_produto = nome;
          v.subcategoria = subcategoria;
        }
      });
      itemSalvo = { ...p };
    }
  } else {
    const variacoesLimpos = variacoesEmEdicao.map(v => {
      const vCopy = { ...v };
      delete vCopy.fotos_originais;
      return vCopy;
    });

    const variantesLimpos = variantesEmEdicao.map(comb => {
      const cCopy = { ...comb };
      delete cCopy.imagem_original;
      return cCopy;
    });

    const novo = {
      id: crypto.randomUUID(),
      nome,
      categoria,
      subcategoria,
      sku,
      codigo_barras,
      preco_custo,
      preco_venda,
      estoque_atual,
      estoque_minimo,
      imagem,
      foto_crop: fotoCropTemporario || null,
      tem_variacoes: temVariacoesAtivas,
      variacoes: temVariacoesAtivas ? variacoesLimpos : [],
      variantes: temVariacoesAtivas ? variantesLimpos : [],
      ativo: true,
      created_at: agoraIso,
      updated_at: agoraIso
    };
    state.produtos.unshift(novo);
    itemSalvo = { ...novo };
  }

  if (itemSalvo) {
    // Salva imagem recortada e imagem original de alta resolução no IndexedDB
    if (imagem) {
      salvarImagemLocal(itemSalvo.id, imagem).catch(() => {});
    }
    if (fotoOriginalTemporaria) {
      salvarImagemOriginal(itemSalvo.id, fotoOriginalTemporaria).catch(() => {});
    }

    // Salva imagens originais de variações no IndexedDB para permitir reenquadramento
    if (Array.isArray(variacoesEmEdicao)) {
      variacoesEmEdicao.forEach(v => {
        if (v.fotos && v.fotos_originais) {
          Object.entries(v.fotos_originais).forEach(([val, origData]) => {
            if (origData) {
              salvarImagemOriginal(`${itemSalvo.id}_val_${v.id}_${encodeURIComponent(val)}`, origData).catch(() => {});
            }
          });
        }
      });
    }

    // Salva imagens originais de combinações no IndexedDB
    if (Array.isArray(variantesEmEdicao)) {
      variantesEmEdicao.forEach(comb => {
        if (comb.imagem && comb.imagem_original) {
          salvarImagemOriginal(`${itemSalvo.id}_comb_${comb.id}`, comb.imagem_original).catch(() => {});
        }
      });
    }

    // Enfileira mutação persistente na Outbox
    enfileirarMutacao('PRODUTO_UPSERT', 'produtos', itemSalvo.id, itemSalvo);
  }

  salvarLocal();
  fecharModalAtual();
  mostrarToast('Produto salvo com sucesso!');
  renderizarEstoque();

  if (onProdutoAlteradoCallback) {
    onProdutoAlteradoCallback();
  }

  logSync('LOCAL', `Produto ${itemSalvo?.id} (${nome}) com variações=${temVariacoesAtivas} salvo e enfileirado.`);
  processarOutbox();
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
    removerImagemLocal(id).catch(() => {});

    enfileirarMutacao('PRODUTO_DELETE', 'produtos', id, null);
    salvarLocal();
    fecharModalAtual();
    mostrarToast(`Produto "${nome}" excluído.`);
    renderizarEstoque();

    if (onProdutoAlteradoCallback) {
      onProdutoAlteradoCallback();
    }

    processarOutbox();
  }
}

// ==============================================================================
// 5. EVENTOS DE FOTO, ENQUADRAMENTO E CRIAÇÃO RÁPIDA INLINE
// ==============================================================================

export function configurarEventosFotoProduto() {
  const btnCamera = document.getElementById('btnCameraPhoto');
  const btnGallery = document.getElementById('btnGalleryPhoto');
  const inputCamera = document.getElementById('inputPhotoCamera');
  const inputGallery = document.getElementById('inputPhotoGallery');
  const btnRemove = document.getElementById('btnRemovePhoto');
  const btnRecortar = document.getElementById('btnRecortarFoto');
  const inputFoto = document.getElementById('prodFotoBase64');
  const imgPreview = document.getElementById('prodPhotoImg');
  const placeholder = document.getElementById('prodPhotoPlaceholder');

  btnCamera?.addEventListener('click', () => inputCamera?.click());
  btnGallery?.addEventListener('click', () => inputGallery?.click());

  // Abertura do Cropper Nativo ao selecionar arquivo
  const processarArquivoComCropper = (file) => {
    if (!file) return;
    abrirCropperFoto(file, ({ croppedDataUrl, originalDataUrl, cropParams }) => {
      if (inputFoto) inputFoto.value = croppedDataUrl;
      if (imgPreview) {
        imgPreview.src = croppedDataUrl;
        imgPreview.style.display = 'block';
      }
      if (placeholder) placeholder.style.display = 'none';
      if (btnRemove) btnRemove.style.display = 'inline-flex';
      if (btnRecortar) btnRecortar.style.display = 'inline-flex';

      fotoOriginalTemporaria = originalDataUrl;
      fotoCropTemporario = cropParams;
    });
  };

  inputCamera?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) processarArquivoComCropper(file);
    e.target.value = '';
  });

  inputGallery?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) processarArquivoComCropper(file);
    e.target.value = '';
  });

  // Reenquadramento de foto existente
  btnRecortar?.addEventListener('click', async () => {
    const idAtual = document.getElementById('prodEditId')?.value;
    let imgFonte = fotoOriginalTemporaria;

    if (!imgFonte && idAtual) {
      imgFonte = await obterImagemOriginal(idAtual);
    }
    if (!imgFonte && inputFoto?.value) {
      imgFonte = inputFoto.value;
    }

    if (!imgFonte) {
      mostrarToast('Nenhuma imagem disponível para reenquadramento.');
      return;
    }

    abrirCropperFoto(imgFonte, ({ croppedDataUrl, originalDataUrl, cropParams }) => {
      if (inputFoto) inputFoto.value = croppedDataUrl;
      if (imgPreview) {
        imgPreview.src = croppedDataUrl;
      }
      fotoOriginalTemporaria = originalDataUrl;
      fotoCropTemporario = cropParams;
    }, fotoCropTemporario);
  });

  // Remoção de foto
  btnRemove?.addEventListener('click', () => {
    const idAtual = document.getElementById('prodEditId')?.value;
    if (idAtual) {
      removerImagemLocal(idAtual).catch(() => {});
    }
    if (inputFoto) inputFoto.value = '';
    if (imgPreview) {
      imgPreview.src = '';
      imgPreview.style.display = 'none';
    }
    if (placeholder) placeholder.style.display = 'flex';
    if (btnRemove) btnRemove.style.display = 'none';
    if (btnRecortar) btnRecortar.style.display = 'none';
    fotoOriginalTemporaria = null;
    fotoCropTemporario = null;
    mostrarToast('Foto removida.');
  });

  // Botão "+ Adicionar Variação" no formulário
  document.getElementById('btnAddVariacao')?.addEventListener('click', () => {
    adicionarTipoVariacao();
  });

  // Botões de criação rápida inline
  document.getElementById('btnNovaCategoriaInline')?.addEventListener('click', () => {
    criarCategoriaRapida();
  });

  document.getElementById('btnNovaSubcategoriaInline')?.addEventListener('click', () => {
    criarSubcategoriaRapida();
  });

  // Eventos do Modal de Origem de Foto para Variação/Combinação (Câmera ou Galeria)
  const inputVarCamera = document.getElementById('inputVarPhotoCamera');
  const inputVarGallery = document.getElementById('inputVarPhotoGallery');

  document.getElementById('btnOrigemFotoCamera')?.addEventListener('click', () => {
    fecharModalAtual();
    inputVarCamera?.click();
  });

  document.getElementById('btnOrigemFotoGaleria')?.addEventListener('click', () => {
    fecharModalAtual();
    inputVarGallery?.click();
  });

  document.getElementById('btnCancelarOrigemFoto')?.addEventListener('click', () => {
    fecharModalAtual();
    alvoFotoAtiva = null;
  });

  document.getElementById('btnFecharModalOrigemFoto')?.addEventListener('click', () => {
    fecharModalAtual();
    alvoFotoAtiva = null;
  });

  const processarArquivoFotoVariacao = (file) => {
    if (!file || !alvoFotoAtiva) return;
    abrirCropperFoto(file, ({ croppedDataUrl, originalDataUrl, cropParams }) => {
      const prodId = document.getElementById('prodEditId')?.value || 'temp_prod';

      if (alvoFotoAtiva.tipo === 'valor_variacao') {
        const varObj = variacoesEmEdicao.find(v => v.id === alvoFotoAtiva.varId);
        if (varObj) {
          varObj.fotos = varObj.fotos || {};
          varObj.fotos[alvoFotoAtiva.val] = croppedDataUrl;
          varObj.fotos_crop = varObj.fotos_crop || {};
          varObj.fotos_crop[alvoFotoAtiva.val] = cropParams;
          varObj.fotos_originais = varObj.fotos_originais || {};
          varObj.fotos_originais[alvoFotoAtiva.val] = originalDataUrl;
          salvarImagemOriginal(`${prodId}_val_${varObj.id}_${encodeURIComponent(alvoFotoAtiva.val)}`, originalDataUrl).catch(() => {});
        }
      } else if (alvoFotoAtiva.tipo === 'combinacao') {
        const item = variantesEmEdicao[alvoFotoAtiva.combIdx];
        if (item) {
          item.imagem = croppedDataUrl;
          item.foto_crop = cropParams;
          item.imagem_original = originalDataUrl;
          salvarImagemOriginal(`${prodId}_comb_${item.id}`, originalDataUrl).catch(() => {});
        }
      }

      alvoFotoAtiva = null;
      renderizarConstrutorVariacoesUI();
      mostrarToast('Foto definida com sucesso!');
    });
  };

  inputVarCamera?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) processarArquivoFotoVariacao(file);
    e.target.value = '';
  });

  inputVarGallery?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) processarArquivoFotoVariacao(file);
    e.target.value = '';
  });
}

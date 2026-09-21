// js/catalogo.js — Módulo de Catálogo Visual / Vitrine de Produtos & Cropper Nativo 1:1
// Versão: v23.0

import { state, salvarLocal } from './state.js';
import { formatarMoedaExibicao, mostrarToast, abrirModal, fecharModalAtual, refreshIcons } from './utils.js';
import { editarProduto } from './estoque.js';
import { salvarImagemOriginal, obterImagemOriginal } from './indexed_db.js';

let onQuickSellCallback = null;

export function setOnCatalogQuickSellCallback(fn) {
  onQuickSellCallback = fn;
}

// ==============================================================================
// 1. CROPPER NATIVO 1:1 (TOUCH / PINCH / PAN / ZOOM SEM DEPENDÊNCIAS EXTERNAS)
// ==============================================================================

const cropperState = {
  imgElem: null,
  imgOriginal: null,
  originalDataUrl: '',
  sourceWidth: 0,
  sourceHeight: 0,
  zoom: 1,
  minZoom: 1,
  maxZoom: 3.5,
  panX: 0,
  panY: 0,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  initialPanX: 0,
  initialPanY: 0,
  pinchStartDist: null,
  initialZoom: 1,
  viewportSize: 260,
  onConfirmCallback: null
};

/**
 * Abre o modal de recorte 1:1 com a imagem fornecida (DataURL ou File).
 * @param {string|File} source - Arquivo ou DataURL
 * @param {Function} onConfirm - Callback({ croppedDataUrl, originalDataUrl, cropParams })
 * @param {Object} [cropParamsExistentes] - Parâmetros { panX, panY, zoom } prévios
 */
export async function abrirCropperFoto(source, onConfirm, cropParamsExistentes = null) {
  cropperState.onConfirmCallback = onConfirm;

  let dataUrl = '';
  if (typeof source === 'string') {
    dataUrl = source;
  } else if (source instanceof File || source instanceof Blob) {
    dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Falha ao ler arquivo.'));
      reader.readAsDataURL(source);
    });
  }

  if (!dataUrl) {
    mostrarToast('Não foi possível carregar a imagem para ajuste.');
    return;
  }

  cropperState.originalDataUrl = dataUrl;

  const img = new Image();
  img.onload = () => {
    cropperState.imgOriginal = img;
    cropperState.sourceWidth = img.naturalWidth || img.width;
    cropperState.sourceHeight = img.naturalHeight || img.height;

    // Calcula viewport no DOM
    const viewport = document.getElementById('cropperViewport');
    const vpSize = viewport ? (viewport.clientWidth || 260) : 260;
    cropperState.viewportSize = vpSize;

    // Calcula zoom inicial de cobertura (Cover 1:1)
    const scaleX = vpSize / cropperState.sourceWidth;
    const scaleY = vpSize / cropperState.sourceHeight;
    const coverScale = Math.max(scaleX, scaleY);

    cropperState.minZoom = 1;
    cropperState.maxZoom = 3.5;

    if (cropParamsExistentes && cropParamsExistentes.zoom) {
      cropperState.zoom = Math.min(Math.max(cropParamsExistentes.zoom, 1), 3.5);
      cropperState.panX = cropParamsExistentes.panX || 0;
      cropperState.panY = cropParamsExistentes.panY || 0;
    } else {
      cropperState.zoom = 1;
      // Centraliza inicialmente
      const displayWidth = cropperState.sourceWidth * coverScale;
      const displayHeight = cropperState.sourceHeight * coverScale;
      cropperState.panX = (vpSize - displayWidth) / 2;
      cropperState.panY = (vpSize - displayHeight) / 2;
    }

    const imgDisplay = document.getElementById('cropperImage');
    if (imgDisplay) {
      imgDisplay.src = dataUrl;
      cropperState.imgElem = imgDisplay;
    }

    const slider = document.getElementById('cropperZoomSlider');
    if (slider) {
      slider.value = cropperState.zoom;
    }

    atualizarCropperTransform();
    abrirModal('modalRecorteFoto');
  };

  img.onerror = () => {
    mostrarToast('Falha ao decodificar imagem para recorte.');
  };

  img.src = dataUrl;
}

/**
 * Atualiza visualmente a imagem dentro do viewport 1:1 e gera a prévia instantânea.
 */
function atualizarCropperTransform() {
  if (!cropperState.imgElem || !cropperState.sourceWidth) return;

  const vpSize = cropperState.viewportSize || 260;
  const scaleX = vpSize / cropperState.sourceWidth;
  const scaleY = vpSize / cropperState.sourceHeight;
  const baseScale = Math.max(scaleX, scaleY);
  const totalScale = baseScale * cropperState.zoom;

  const curWidth = cropperState.sourceWidth * totalScale;
  const curHeight = cropperState.sourceHeight * totalScale;

  // Limita pan para não deixar bordas pretas vazias
  const minPanX = vpSize - curWidth;
  const minPanY = vpSize - curHeight;
  cropperState.panX = Math.min(0, Math.max(minPanX, cropperState.panX));
  cropperState.panY = Math.min(0, Math.max(minPanY, cropperState.panY));

  cropperState.imgElem.style.width = `${cropperState.sourceWidth}px`;
  cropperState.imgElem.style.height = `${cropperState.sourceHeight}px`;
  cropperState.imgElem.style.transform = `translate(${cropperState.panX}px, ${cropperState.panY}px) scale(${totalScale})`;

  // Atualiza mini preview em tempo real
  atualizarMiniCanvasPreview(totalScale);
}

/**
 * Renderiza o canvas de prévia do card em tempo real.
 */
function atualizarMiniCanvasPreview(totalScale) {
  const canvas = document.getElementById('cropperCanvasPreview');
  if (!canvas || !cropperState.imgOriginal) return;

  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);

  const vpSize = cropperState.viewportSize || 260;
  const factor = size / vpSize;

  const sx = (-cropperState.panX / totalScale);
  const sy = (-cropperState.panY / totalScale);
  const sSize = (vpSize / totalScale);

  try {
    ctx.drawImage(
      cropperState.imgOriginal,
      Math.max(0, sx),
      Math.max(0, sy),
      Math.min(cropperState.sourceWidth, sSize),
      Math.min(cropperState.sourceHeight, sSize),
      0,
      0,
      size,
      size
    );
  } catch (err) {}
}

/**
 * Confirma o enquadramento, gerando o arquivo WebP otimizado 1:1 de 600x600 px.
 */
function confirmarRecorteFoto() {
  if (!cropperState.imgOriginal || !cropperState.onConfirmCallback) {
    fecharModalAtual();
    return;
  }

  const vpSize = cropperState.viewportSize || 260;
  const scaleX = vpSize / cropperState.sourceWidth;
  const scaleY = vpSize / cropperState.sourceHeight;
  const baseScale = Math.max(scaleX, scaleY);
  const totalScale = baseScale * cropperState.zoom;

  // Coordenadas na imagem original
  const sx = Math.max(0, -cropperState.panX / totalScale);
  const sy = Math.max(0, -cropperState.panY / totalScale);
  const sWidth = Math.min(cropperState.sourceWidth - sx, vpSize / totalScale);
  const sHeight = Math.min(cropperState.sourceHeight - sy, vpSize / totalScale);
  const targetCropSize = Math.min(sWidth, sHeight);

  // Canvas de alta fidelidade 600x600 px
  const outSize = 600;
  const canvas = document.createElement('canvas');
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext('2d');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Fundo neutro
  ctx.fillStyle = '#161f2e';
  ctx.fillRect(0, 0, outSize, outSize);

  try {
    ctx.drawImage(
      cropperState.imgOriginal,
      sx,
      sy,
      targetCropSize,
      targetCropSize,
      0,
      0,
      outSize,
      outSize
    );
  } catch (err) {
    console.warn('[Cropper] Falha no canvas crop:', err);
  }

  let croppedDataUrl = '';
  try {
    croppedDataUrl = canvas.toDataURL('image/webp', 0.85);
    if (!croppedDataUrl.startsWith('data:image/webp')) {
      croppedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    }
  } catch (e) {
    croppedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
  }

  const cropParams = {
    panX: cropperState.panX,
    panY: cropperState.panY,
    zoom: cropperState.zoom,
    sourceWidth: cropperState.sourceWidth,
    sourceHeight: cropperState.sourceHeight
  };

  const callback = cropperState.onConfirmCallback;
  fecharModalAtual();

  callback({
    croppedDataUrl,
    originalDataUrl: cropperState.originalDataUrl,
    cropParams
  });

  mostrarToast('Foto enquadrada com sucesso!');
}

/**
 * Inicializa os ouvintes de toque e mouse para o Cropper 1:1.
 */
export function inicializarEventosCropper() {
  const viewport = document.getElementById('cropperViewport');
  const slider = document.getElementById('cropperZoomSlider');
  const btnZoomIn = document.getElementById('btnZoomIn');
  const btnZoomOut = document.getElementById('btnZoomOut');
  const btnConfirmar = document.getElementById('btnConfirmarRecorte');
  const btnCancelar = document.getElementById('btnCancelarRecorte');
  const btnFechar = document.getElementById('btnFecharModalRecorte');

  // Slider de Zoom
  slider?.addEventListener('input', e => {
    cropperState.zoom = parseFloat(e.target.value) || 1;
    atualizarCropperTransform();
  });

  // Botões de Zoom Step (+ e -)
  btnZoomIn?.addEventListener('click', () => {
    cropperState.zoom = Math.min(cropperState.maxZoom, cropperState.zoom + 0.2);
    if (slider) slider.value = cropperState.zoom;
    atualizarCropperTransform();
  });

  btnZoomOut?.addEventListener('click', () => {
    cropperState.zoom = Math.max(cropperState.minZoom, cropperState.zoom - 0.2);
    if (slider) slider.value = cropperState.zoom;
    atualizarCropperTransform();
  });

  btnConfirmar?.addEventListener('click', confirmarRecorteFoto);
  btnCancelar?.addEventListener('click', fecharModalAtual);
  btnFechar?.addEventListener('click', fecharModalAtual);

  if (!viewport) return;

  // --- ARRASTE VIA MOUSE ---
  viewport.addEventListener('mousedown', e => {
    cropperState.isDragging = true;
    cropperState.dragStartX = e.clientX;
    cropperState.dragStartY = e.clientY;
    cropperState.initialPanX = cropperState.panX;
    cropperState.initialPanY = cropperState.panY;
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!cropperState.isDragging) return;
    const dx = e.clientX - cropperState.dragStartX;
    const dy = e.clientY - cropperState.dragStartY;
    cropperState.panX = cropperState.initialPanX + dx;
    cropperState.panY = cropperState.initialPanY + dy;
    atualizarCropperTransform();
  });

  window.addEventListener('mouseup', () => {
    cropperState.isDragging = false;
  });

  // --- ARRASTE E GESTO DE PINÇA (TOUCH & PINCH-TO-ZOOM NO MOBILE) ---
  viewport.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      cropperState.isDragging = true;
      cropperState.dragStartX = e.touches[0].clientX;
      cropperState.dragStartY = e.touches[0].clientY;
      cropperState.initialPanX = cropperState.panX;
      cropperState.initialPanY = cropperState.panY;
      cropperState.pinchStartDist = null;
    } else if (e.touches.length === 2) {
      cropperState.isDragging = false;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      cropperState.pinchStartDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      cropperState.initialZoom = cropperState.zoom;
    }
  }, { passive: true });

  viewport.addEventListener('touchmove', e => {
    if (e.touches.length === 1 && cropperState.isDragging) {
      const dx = e.touches[0].clientX - cropperState.dragStartX;
      const dy = e.touches[0].clientY - cropperState.dragStartY;
      cropperState.panX = cropperState.initialPanX + dx;
      cropperState.panY = cropperState.initialPanY + dy;
      atualizarCropperTransform();
      e.preventDefault();
    } else if (e.touches.length === 2 && cropperState.pinchStartDist) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const ratio = dist / cropperState.pinchStartDist;
      const novoZoom = Math.min(cropperState.maxZoom, Math.max(cropperState.minZoom, cropperState.initialZoom * ratio));
      cropperState.zoom = novoZoom;
      if (slider) slider.value = novoZoom;
      atualizarCropperTransform();
      e.preventDefault();
    }
  }, { passive: false });

  viewport.addEventListener('touchend', () => {
    cropperState.isDragging = false;
    cropperState.pinchStartDist = null;
  });
}

/**
 * Fallback de compressão simples para ambientes legados.
 */
export function comprimirImagem(file, maxWidth = 600, maxHeight = 600, quality = 0.8) {
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

// ==============================================================================
// 2. RENDERIZAÇÃO DA VITRINE VISUAL (CATÁLOGO)
// ==============================================================================

export function renderizarCatalogo() {
  const container = document.getElementById('catalogGrid');
  const counterElem = document.getElementById('catalogCounter');
  if (!container) return;

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

    const thumbHtml = p.imagem
      ? `<img src="${p.imagem}" alt="${p.nome}" class="catalog-thumb-img" loading="lazy">`
      : `<div class="catalog-thumb-placeholder">
           <i data-lucide="package" style="width: 28px; height: 28px; opacity: 0.35;"></i>
         </div>`;

    const subBadgeHtml = p.subcategoria
      ? `<span class="category-badge" style="font-size: 9.5px; padding: 2px 6px; background: rgba(56, 189, 248, 0.12); color: #38bdf8; border-color: rgba(56, 189, 248, 0.25);">${p.subcategoria}</span>`
      : '';

    const varIndicatorHtml = p.tem_variacoes
      ? `<span style="font-size: 10px; color: var(--accent); font-weight: 600; display: inline-flex; align-items: center; gap: 3px;">
           <i data-lucide="layers" style="width: 11px; height: 11px;"></i> ${p.variantes?.length || 0} variações
         </span>`
      : '';

    card.innerHTML = `
      <div class="catalog-thumb-box">
        ${thumbHtml}
        <span class="catalog-stock-pill ${stockClass}">${stockText}</span>
      </div>
      <div class="catalog-info">
        <div class="catalog-title" title="${p.nome}">${p.nome}</div>
        <div style="display: flex; align-items: center; gap: 6px; margin: 2px 0;">
          ${subBadgeHtml}
          ${varIndicatorHtml}
        </div>
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
 * Abre modal com visualização detalhada do produto da vitrine.
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
  if (catElem) {
    catElem.innerText = p.subcategoria ? `${p.categoria} › ${p.subcategoria}` : (p.categoria || 'Geral');
  }

  const skuElem = document.getElementById('catalogoDetalheSku');
  if (skuElem) {
    if (p.sku) {
      skuElem.innerText = `SKU: ${p.sku}`;
      skuElem.style.display = 'inline-block';
    } else {
      skuElem.style.display = 'none';
    }
  }

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
 * Inicializa os botões de ação do catálogo.
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

  // Inicializa eventos do cropper
  inicializarEventosCropper();
}


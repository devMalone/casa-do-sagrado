// js/categorias.js — Gerenciamento Dinâmico e Hierárquico de Categorias e Subcategorias
// Versão: v23.0

import { state, salvarLocal, enfileirarMutacao } from './state.js';
import { mostrarToast, refreshIcons, abrirModal, fecharModalAtual, pedirConfirmacao } from './utils.js';
import { processarOutbox, logSync } from './sync_engine.js';

let onCategoriaAlteradaCallback = null;

export function setOnCategoriaAlteradaCallback(fn) {
  onCategoriaAlteradaCallback = fn;
}

/**
 * Normaliza o array de categorias para garantir compatibilidade entre strings antigas
 * ["Católico", "Umbanda"] e o formato estruturado com subcategorias [{ nome, subcategorias }].
 */
export function normalizarCategorias(listaRaw) {
  if (!Array.isArray(listaRaw)) return [];
  return listaRaw.map(item => {
    if (typeof item === 'string') {
      return { nome: item.trim(), subcategorias: [] };
    }
    if (item && typeof item === 'object') {
      return {
        nome: String(item.nome || '').trim(),
        subcategorias: Array.isArray(item.subcategorias)
          ? item.subcategorias.map(s => String(s).trim()).filter(Boolean)
          : []
      };
    }
    return null;
  }).filter(c => c && c.nome);
}

/**
 * Retorna a lista de nomes de categorias ativas.
 */
export function obterNomesCategorias() {
  const norm = normalizarCategorias(state.categorias);
  return norm.map(c => c.nome);
}

/**
 * Retorna as subcategorias vinculadas a uma categoria pai.
 */
export function obterSubcategoriasDaCategoria(nomeCat) {
  if (!nomeCat) return [];
  const norm = normalizarCategorias(state.categorias);
  const encontrada = norm.find(c => c.nome.toLowerCase() === String(nomeCat).toLowerCase());
  return encontrada ? encontrada.subcategorias : [];
}

/**
 * Renderiza todas as interfaces de categoria e subcategoria do aplicativo.
 */
export function renderizarCategoriasUI() {
  const normCats = normalizarCategorias(state.categorias);
  // Mantém state.categorias sempre na estrutura canônica
  state.categorias = normCats;

  // 1. Pílulas de filtro de Categorias na Vitrine e no Estoque
  const pillContainers = [
    document.getElementById('categoryPills'),
    document.getElementById('catalogCategoryPills')
  ].filter(Boolean);

  pillContainers.forEach(container => {
    let html = `<div class="pill ${state.categoriaFiltro === 'todos' ? 'active' : ''}" data-cat="todos">Todos</div>`;
    normCats.forEach(cat => {
      const active = state.categoriaFiltro === cat.nome ? 'active' : '';
      html += `<div class="pill ${active}" data-cat="${cat.nome}">${cat.nome}</div>`;
    });
    container.innerHTML = html;

    container.querySelectorAll('.pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const cat = pill.getAttribute('data-cat');
        filtrarCategoria(cat);
      });
    });
  });

  // 2. Pílulas de filtro de Subcategorias (visíveis quando a categoria ativa tem subcategorias)
  renderizarSubcategoriasFiltrosUI();

  // 3. Chips de Categoria e Subcategoria no Modal de Produto
  renderizarCategoriasFormProduto();

  // 4. Modal dedicado de Gerenciamento de Categorias & Subcategorias
  renderizarModalGerenciarCategorias();

  refreshIcons();
}

/**
 * Renderiza a barra secundária de subcategorias na vitrine e estoque.
 */
function renderizarSubcategoriasFiltrosUI() {
  const subcatContainers = [
    { wrapper: document.getElementById('catalogSubcatWrapper'), pills: document.getElementById('catalogSubcategoryPills') },
    { wrapper: document.getElementById('stockSubcatWrapper'), pills: document.getElementById('stockSubcategoryPills') }
  ];

  const subcatsAtivas = state.categoriaFiltro !== 'todos' ? obterSubcategoriasDaCategoria(state.categoriaFiltro) : [];

  subcatContainers.forEach(({ wrapper, pills }) => {
    if (!wrapper || !pills) return;

    if (subcatsAtivas.length === 0) {
      wrapper.style.display = 'none';
      pills.innerHTML = '';
      return;
    }

    wrapper.style.display = 'block';
    let html = `<div class="pill ${state.subcategoriaFiltro === 'todas' ? 'active' : ''}" data-subcat="todas">Todas</div>`;
    subcatsAtivas.forEach(sub => {
      const active = state.subcategoriaFiltro === sub ? 'active' : '';
      html += `<div class="pill ${active}" data-subcat="${sub}">${sub}</div>`;
    });
    pills.innerHTML = html;

    pills.querySelectorAll('.pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const sub = pill.getAttribute('data-subcat');
        filtrarSubcategoria(sub);
      });
    });
  });
}

/**
 * Renderiza a seleção de categorias e subcategorias no formulário do produto.
 */
export function renderizarCategoriasFormProduto(catPreselecionada = null, subcatPreselecionada = null) {
  const chipsContainer = document.getElementById('prodCategoryChips');
  const inputProdCat = document.getElementById('prodCategoria');
  const normCats = normalizarCategorias(state.categorias);

  if (!chipsContainer || !inputProdCat) return;

  let valorSelecionado = catPreselecionada || inputProdCat.value;
  if ((!valorSelecionado || !normCats.some(c => c.nome === valorSelecionado)) && normCats.length > 0) {
    valorSelecionado = normCats[0].nome;
  }
  inputProdCat.value = valorSelecionado || '';

  if (normCats.length === 0) {
    chipsContainer.innerHTML = '<span style="font-size: 12px; color: var(--text-muted);">Nenhuma categoria ativa. Crie uma no botão acima.</span>';
  } else {
    chipsContainer.innerHTML = normCats.map(cat => {
      const active = cat.nome === valorSelecionado ? 'active' : '';
      return `<div class="cat-select-chip ${active}" data-cat="${cat.nome}">${cat.nome}</div>`;
    }).join('');

    chipsContainer.querySelectorAll('.cat-select-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chipsContainer.querySelectorAll('.cat-select-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const novaCat = chip.getAttribute('data-cat');
        inputProdCat.value = novaCat;
        renderizarSubcategoriasFormProduto(novaCat, null);
      });
    });
  }

  // Renderiza subcategorias correspondentes à categoria selecionada
  renderizarSubcategoriasFormProduto(valorSelecionado, subcatPreselecionada);
}

/**
 * Renderiza os chips de subcategoria para a categoria atualmente selecionada.
 */
export function renderizarSubcategoriasFormProduto(nomeCategoria, subcatSelecionada = null) {
  const container = document.getElementById('prodSubcategoryChips');
  const inputSubcat = document.getElementById('prodSubcategoria');
  if (!container || !inputSubcat) return;

  const subcats = obterSubcategoriasDaCategoria(nomeCategoria);
  let valorSubcat = subcatSelecionada !== null ? subcatSelecionada : (inputSubcat.value || '');

  // Se a subcategoria previamente selecionada não pertence a esta categoria, reseta
  if (valorSubcat && !subcats.includes(valorSubcat)) {
    valorSubcat = '';
  }
  inputSubcat.value = valorSubcat;

  if (subcats.length === 0) {
    container.innerHTML = `
      <span style="font-size: 11.5px; color: var(--text-muted);">
        Nenhuma subcategoria vinculada a esta categoria (opcional).
      </span>`;
    return;
  }

  let html = `
    <div class="cat-select-chip ${!valorSubcat ? 'active' : ''}" data-subcat="">
      <span>(Nenhuma)</span>
    </div>
  `;

  subcats.forEach(sub => {
    const active = sub === valorSubcat ? 'active' : '';
    html += `<div class="cat-select-chip ${active}" data-subcat="${sub}">${sub}</div>`;
  });

  container.innerHTML = html;

  container.querySelectorAll('.cat-select-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('.cat-select-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      inputSubcat.value = chip.getAttribute('data-subcat');
    });
  });
}

/**
 * Filtra produtos por categoria principal.
 */
export function filtrarCategoria(cat) {
  state.categoriaFiltro = cat;
  state.subcategoriaFiltro = 'todas';

  document.querySelectorAll('.pills-bar:not(.subcat-pills) .pill[data-cat]').forEach(p => {
    if (p.getAttribute('data-cat') === cat) {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });

  renderizarSubcategoriasFiltrosUI();
  if (onCategoriaAlteradaCallback) onCategoriaAlteradaCallback();
}

/**
 * Filtra produtos por subcategoria.
 */
export function filtrarSubcategoria(sub) {
  state.subcategoriaFiltro = sub;
  document.querySelectorAll('.pills-bar.subcat-pills .pill[data-subcat]').forEach(p => {
    if (p.getAttribute('data-subcat') === sub) {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });
  if (onCategoriaAlteradaCallback) onCategoriaAlteradaCallback();
}

/**
 * Salva categorias no LocalStorage e enfileira na Outbox persistente.
 */
export function salvarCategorias() {
  state.categorias = normalizarCategorias(state.categorias);
  salvarLocal();
  renderizarCategoriasUI();
  if (onCategoriaAlteradaCallback) onCategoriaAlteradaCallback();

  enfileirarMutacao('CONFIG_UPSERT', 'configuracoes', 'categorias', {
    chave: 'categorias',
    valor: state.categorias
  });

  logSync('LOCAL', 'Categorias e subcategorias salvas localmente e enfileiradas.');
  processarOutbox();
}

/**
 * Criação rápida de categoria inline (sem sair do modal de produto).
 */
export function criarCategoriaRapida(nomeInformado = null) {
  let nome = nomeInformado;
  if (!nome) {
    nome = window.prompt('Digite o nome da nova Categoria:');
  }
  if (!nome) return;
  nome = nome.trim();
  if (!nome) return;

  const norm = normalizarCategorias(state.categorias);
  if (norm.some(c => c.nome.toLowerCase() === nome.toLowerCase())) {
    mostrarToast('Esta categoria já existe.');
    return;
  }

  norm.push({ nome, subcategorias: [] });
  state.categorias = norm;
  salvarCategorias();
  renderizarCategoriasFormProduto(nome, null);
  mostrarToast(`Categoria "${nome}" adicionada!`);
}

/**
 * Criação rápida de subcategoria inline (sem sair do modal de produto).
 */
export function criarSubcategoriaRapida(catPaiInformada = null, nomeSubcatInformado = null) {
  let catPai = catPaiInformada;
  if (!catPai) {
    catPai = document.getElementById('prodCategoria')?.value;
  }
  if (!catPai) {
    mostrarToast('Selecione uma categoria principal primeiro.');
    return;
  }

  let subcat = nomeSubcatInformado;
  if (!subcat) {
    subcat = window.prompt(`Nova subcategoria para "${catPai}":`);
  }
  if (!subcat) return;
  subcat = subcat.trim();
  if (!subcat) return;

  const norm = normalizarCategorias(state.categorias);
  const catObj = norm.find(c => c.nome.toLowerCase() === catPai.toLowerCase());
  if (!catObj) {
    mostrarToast('Categoria principal não encontrada.');
    return;
  }

  if (catObj.subcategorias.some(s => s.toLowerCase() === subcat.toLowerCase())) {
    mostrarToast('Esta subcategoria já existe nesta categoria.');
    return;
  }

  catObj.subcategorias.push(subcat);
  state.categorias = norm;
  salvarCategorias();
  renderizarCategoriasFormProduto(catPai, subcat);
  mostrarToast(`Subcategoria "${subcat}" vinculada a "${catPai}"!`);
}

/**
 * Adiciona categoria via input tradicional no modal de categorias.
 */
export function adicionarCategoria() {
  const input = document.getElementById('inputNovaCategoria');
  if (!input) return;
  const nome = input.value.trim();
  if (!nome) {
    mostrarToast('Digite o nome da categoria.');
    return;
  }

  const norm = normalizarCategorias(state.categorias);
  if (norm.some(c => c.nome.toLowerCase() === nome.toLowerCase())) {
    mostrarToast('Esta categoria já existe.');
    return;
  }

  norm.push({ nome, subcategorias: [] });
  state.categorias = norm;
  input.value = '';
  salvarCategorias();
  mostrarToast(`Categoria "${nome}" adicionada!`);
}

/**
 * Remove categoria com confirmação in-app.
 */
export async function removerCategoria(nome) {
  const confirmou = await pedirConfirmacao({
    titulo: 'Remover Categoria',
    mensagem: `Deseja remover a categoria "${nome}" e suas subcategorias?`,
    textoConfirmar: 'Sim, remover',
    perigo: true
  });

  if (confirmou) {
    const norm = normalizarCategorias(state.categorias);
    state.categorias = norm.filter(c => c.nome.toLowerCase() !== nome.toLowerCase());
    if (state.categoriaFiltro === nome) {
      state.categoriaFiltro = 'todos';
      state.subcategoriaFiltro = 'todas';
    }
    salvarCategorias();
    mostrarToast(`Categoria "${nome}" removida.`);
  }
}

/**
 * Remove uma subcategoria vinculada a uma categoria pai.
 */
export function removerSubcategoria(catPai, nomeSubcat) {
  const norm = normalizarCategorias(state.categorias);
  const catObj = norm.find(c => c.nome.toLowerCase() === catPai.toLowerCase());
  if (!catObj) return;

  catObj.subcategorias = catObj.subcategorias.filter(s => s !== nomeSubcat);
  state.categorias = norm;
  salvarCategorias();
  mostrarToast(`Subcategoria "${nomeSubcat}" removida.`);
}

/**
 * Renderiza a lista detalhada de categorias e subcategorias no modal dedicado.
 */
function renderizarModalGerenciarCategorias() {
  const chipsList = document.getElementById('listaCategoriasChips');
  if (!chipsList) return;

  const norm = normalizarCategorias(state.categorias);
  if (norm.length === 0) {
    chipsList.innerHTML = '<span style="font-size: 12px; color: var(--text-muted);">Nenhuma categoria cadastrada.</span>';
    return;
  }

  chipsList.innerHTML = norm.map(cat => {
    const subBadges = cat.subcategorias.map(s => `
      <span class="cat-sub-chip" style="background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8; font-size: 11px; padding: 2px 8px; border-radius: 12px; display: inline-flex; align-items: center; gap: 4px;">
        <span>${s}</span>
        <span class="subcat-del-btn" data-cat="${cat.nome}" data-subcat="${s}" style="cursor: pointer; opacity: 0.7;" title="Remover subcategoria">×</span>
      </span>
    `).join('');

    return `
      <div class="cat-manager-row" style="background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="font-size: 13.5px; color: var(--text);">${cat.nome}</strong>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button type="button" class="btn-text-action add-sub-btn" data-cat="${cat.nome}" style="font-size: 11px; color: var(--accent); background: none; border: none; cursor: pointer;">
              + Subcategoria
            </button>
            <span class="cat-chip-delete" data-cat="${cat.nome}" title="Excluir categoria principal" style="cursor: pointer; color: var(--danger); padding: 4px;">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </span>
          </div>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 5px; align-items: center;">
          ${subBadges || '<span style="font-size: 11px; color: var(--text-muted);">Sem subcategorias</span>'}
        </div>
      </div>
    `;
  }).join('');

  // Eventos de remoção de categoria
  chipsList.querySelectorAll('.cat-chip-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      removerCategoria(btn.getAttribute('data-cat'));
    });
  });

  // Eventos de remoção de subcategoria
  chipsList.querySelectorAll('.subcat-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.getAttribute('data-cat');
      const sub = btn.getAttribute('data-subcat');
      removerSubcategoria(cat, sub);
    });
  });

  // Eventos de adição de subcategoria rápida no modal
  chipsList.querySelectorAll('.add-sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.getAttribute('data-cat');
      criarSubcategoriaRapida(cat);
    });
  });

  refreshIcons();
}

export function abrirModalCategorias() {
  renderizarCategoriasUI();
  abrirModal('modalCategorias');
}

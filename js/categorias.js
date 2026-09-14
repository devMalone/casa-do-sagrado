// js/categorias.js — Gerenciamento Dinâmico de Categorias

import { state, salvarLocal } from './state.js';
import { mostrarToast, refreshIcons, abrirModal, fecharModalAtual, pedirConfirmacao } from './utils.js';

let onCategoriaAlteradaCallback = null;

export function setOnCategoriaAlteradaCallback(fn) {
  onCategoriaAlteradaCallback = fn;
}

export function renderizarCategoriasUI() {
  // 1. Pílulas de filtro no catálogo
  const pillsBar = document.getElementById('categoryPills');
  if (pillsBar) {
    let html = `<div class="pill ${state.categoriaFiltro === 'todos' ? 'active' : ''}" data-cat="todos">Todos</div>`;
    state.categorias.forEach(cat => {
      const active = state.categoriaFiltro === cat ? 'active' : '';
      html += `<div class="pill ${active}" data-cat="${cat}">${cat}</div>`;
    });
    pillsBar.innerHTML = html;

    // Attach listeners
    pillsBar.querySelectorAll('.pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const cat = pill.getAttribute('data-cat');
        filtrarCategoria(cat, pill);
      });
    });
  }

  // 2. Select do modal de produtos
  const selectProd = document.getElementById('prodCategoria');
  if (selectProd) {
    const valAtual = selectProd.value;
    selectProd.innerHTML = state.categorias.map(cat => `<option value="${cat}">${cat}</option>`).join('');
    if (state.categorias.includes(valAtual)) {
      selectProd.value = valAtual;
    }
  }

  // 3. Chips no modal dedicado de categorias
  const chipsList = document.getElementById('listaCategoriasChips');
  if (chipsList) {
    if (state.categorias.length === 0) {
      chipsList.innerHTML = '<span style="font-size: 12px; color: var(--text-muted);">Nenhuma categoria cadastrada.</span>';
    } else {
      chipsList.innerHTML = state.categorias.map(cat => `
        <span class="cat-chip">
          <span>${cat}</span>
          <span class="cat-chip-delete" data-cat="${cat}" title="Remover categoria">
            <i data-lucide="x" style="width: 14px; height: 14px;"></i>
          </span>
        </span>
      `).join('');

      chipsList.querySelectorAll('.cat-chip-delete').forEach(btn => {
        btn.addEventListener('click', () => {
          removerCategoria(btn.getAttribute('data-cat'));
        });
      });
    }
  }

  refreshIcons();
}

export function filtrarCategoria(cat, elem) {
  state.categoriaFiltro = cat;
  document.querySelectorAll('#categoryPills .pill').forEach(p => p.classList.remove('active'));
  if (elem) elem.classList.add('active');
  if (onCategoriaAlteradaCallback) onCategoriaAlteradaCallback();
}

export function salvarCategorias() {
  salvarLocal();
  renderizarCategoriasUI();
  if (onCategoriaAlteradaCallback) onCategoriaAlteradaCallback();

  if (state.supabase) {
    state.supabase.from('casa_configuracoes').upsert({
      chave: 'categorias',
      valor: state.categorias,
      updated_at: new Date().toISOString()
    }).catch(err => console.warn('[Sync] Erro ao sincronizar categorias na nuvem:', err));
  }
}

export function adicionarCategoria() {
  const input = document.getElementById('inputNovaCategoria');
  if (!input) return;
  const nome = input.value.trim();
  
  if (!nome) {
    mostrarToast('Digite o nome da categoria.');
    return;
  }
  
  if (state.categorias.some(c => c.toLowerCase() === nome.toLowerCase())) {
    mostrarToast('Esta categoria já existe.');
    return;
  }

  state.categorias.push(nome);
  input.value = '';
  salvarCategorias();
  mostrarToast(`Categoria "${nome}" adicionada!`);
}

export async function removerCategoria(nome) {
  const confirmou = await pedirConfirmacao({
    titulo: 'Remover Categoria',
    mensagem: `Tem certeza que deseja remover a categoria "${nome}"?`,
    textoConfirmar: 'Sim, remover',
    perigo: true
  });

  if (confirmou) {
    state.categorias = state.categorias.filter(c => c !== nome);
    if (state.categoriaFiltro === nome) {
      state.categoriaFiltro = 'todos';
    }
    salvarCategorias();
    mostrarToast(`Categoria "${nome}" removida.`);
  }
}

export function abrirModalCategorias() {
  renderizarCategoriasUI();
  abrirModal('modalCategorias');
}

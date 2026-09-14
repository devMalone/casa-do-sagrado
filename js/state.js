// js/state.js — Gerenciador de Estado e Persistência Local-First

export const state = {
  produtos: [],
  vendas: [],
  categorias: ['Católico', 'Umbanda/Quimbanda', 'Holístico', 'Geral'],
  config: {
    tetoReserva: 1500.00,
    percentualReserva: 30
  },
  operador: localStorage.getItem('casa_operador') || null,
  categoriaFiltro: 'todos',
  buscaFiltro: '',
  modalStack: [],
  vendaEmAndamento: null,
  metodoPgtoSelecionado: 'Pix',
  supabase: null,
  isOnline: false
};

export function carregarDadosLocais() {
  const prods = localStorage.getItem('casa_produtos');
  const sales = localStorage.getItem('casa_vendas');
  const cats = localStorage.getItem('casa_categorias');
  const cfg = localStorage.getItem('casa_config');

  state.produtos = prods ? JSON.parse(prods) : [];
  state.vendas = sales ? JSON.parse(sales) : [];
  
  if (cats) {
    try { state.categorias = JSON.parse(cats); } catch (e) {}
  }
  
  if (cfg) {
    try { state.config = { ...state.config, ...JSON.parse(cfg) }; } catch (e) {}
  }

  salvarLocal();
}

export function salvarLocal() {
  localStorage.setItem('casa_produtos', JSON.stringify(state.produtos));
  localStorage.setItem('casa_vendas', JSON.stringify(state.vendas));
  localStorage.setItem('casa_categorias', JSON.stringify(state.categorias));
  localStorage.setItem('casa_config', JSON.stringify(state.config));
}

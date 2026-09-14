// js/state.js — Gerenciador de Estado e Persistência Local-First

export const state = {
  produtos: [],
  vendas: [],
  categorias: ['Católico', 'Umbanda/Quimbanda', 'Holístico', 'Geral'],
  config: {
    tetoReserva: 1500.00,
    percentualReserva: 30,
    custosFixos: {
      itens: [],
      diasUteisMes: 26
    }
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

  // Garante identificador em vendas legadas ou sem ID
  state.vendas.forEach((v, idx) => {
    if (!v.id) {
      v.id = `venda_${Date.now()}_${idx}`;
    }
  });
  
  if (cats) {
    try { state.categorias = JSON.parse(cats); } catch (e) {}
  }
  
  if (cfg) {
    try {
      const parsed = JSON.parse(cfg);
      state.config = {
        ...state.config,
        ...parsed,
        custosFixos: {
          itens: (parsed.custosFixos && Array.isArray(parsed.custosFixos.itens)) ? parsed.custosFixos.itens : [],
          diasUteisMes: (parsed.custosFixos && parsed.custosFixos.diasUteisMes) ? Math.max(1, parseInt(parsed.custosFixos.diasUteisMes, 10)) : 26
        }
      };
    } catch (e) {}
  }

  salvarLocal();
}

export function salvarLocal() {
  localStorage.setItem('casa_produtos', JSON.stringify(state.produtos));
  localStorage.setItem('casa_vendas', JSON.stringify(state.vendas));
  localStorage.setItem('casa_categorias', JSON.stringify(state.categorias));
  localStorage.setItem('casa_config', JSON.stringify(state.config));
}

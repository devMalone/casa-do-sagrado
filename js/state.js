// js/state.js — Gerenciador de Estado, Persistência Local-First e Fila Outbox Idempotente
// Versão: v22.0 (Arquitetura Comercial Multi-Dispositivo e Idempotência Estrita)

import { persistirOutboxIndexedDB, carregarOutboxIndexedDB } from './indexed_db.js';

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
  subcategoriaFiltro: 'todas',
  buscaFiltro: '',
  modalStack: [],
  vendaEmAndamento: null,
  carrinho: [], // Sacola de compras multi-item (Local-First)
  metodoPgtoSelecionado: 'Pix',
  supabase: null,
  isOnline: navigator.onLine,
  syncQueue: [], // Fila Outbox persistente de mutações pendentes
  tombstones: new Set(), // Conjunto de IDs excluídos para prevenir ressurreição
  deviceId: null // Identificador único deste terminal
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function garantirUUID(valor) {
  if (valor && typeof valor === 'string' && UUID_REGEX.test(valor)) {
    return valor;
  }
  return crypto.randomUUID();
}

export async function carregarDadosLocais() {
  // 1. Identificador único do dispositivo
  let devId = localStorage.getItem('casa_device_id');
  if (!devId || !UUID_REGEX.test(devId)) {
    devId = crypto.randomUUID();
    localStorage.setItem('casa_device_id', devId);
  }
  state.deviceId = devId;

  // 2. Tombstones locais persistidos
  const tombstonesSalvos = localStorage.getItem('casa_tombstones');
  if (tombstonesSalvos) {
    try {
      const parsed = JSON.parse(tombstonesSalvos);
      if (Array.isArray(parsed)) {
        state.tombstones = new Set(parsed);
      }
    } catch (e) {
      state.tombstones = new Set();
    }
  }

  // 3. Fila persistente de sincronização (Outbox) - LocalStorage + fallback IndexedDB
  const filaSalva = localStorage.getItem('casa_sync_queue');
  if (filaSalva) {
    try {
      state.syncQueue = JSON.parse(filaSalva);
      if (!Array.isArray(state.syncQueue)) state.syncQueue = [];
    } catch (e) {
      state.syncQueue = [];
    }
  }

  // Se a fila do localStorage estava vazia, verifica se há backup no IndexedDB
  if (state.syncQueue.length === 0) {
    try {
      const filaIdb = await carregarOutboxIndexedDB();
      if (Array.isArray(filaIdb) && filaIdb.length > 0) {
        state.syncQueue = filaIdb;
      }
    } catch (err) {}
  }

  // 4. Produtos
  const prods = localStorage.getItem('casa_produtos');
  if (prods) {
    try {
      const parsedProds = JSON.parse(prods);
      state.produtos = Array.isArray(parsedProds) ? parsedProds : [];
      // Higieniza IDs inválidos legados e filtra produtos com tombstone local
      state.produtos = state.produtos.filter(p => {
        if (!p.id || !UUID_REGEX.test(p.id)) {
          p.id = crypto.randomUUID();
        }
        return !state.tombstones.has(p.id);
      });
    } catch (e) {
      state.produtos = [];
    }
  } else {
    state.produtos = [];
  }

  // 5. Vendas
  const sales = localStorage.getItem('casa_vendas');
  if (sales) {
    try {
      const parsedSales = JSON.parse(sales);
      state.vendas = Array.isArray(parsedSales) ? parsedSales : [];
      // Higieniza IDs legados, garante pedido_id e descarta vendas estornadas do histórico ativo
      state.vendas = state.vendas.filter(v => {
        if (!v.id || !UUID_REGEX.test(v.id)) {
          v.id = crypto.randomUUID();
        }
        if (!v.pedido_id) {
          v.pedido_id = v.id;
        }
        if (!v.numero_pedido) {
          v.numero_pedido = '#CS-' + (v.pedido_id ? v.pedido_id.substring(0, 6).toUpperCase() : '0000');
        }
        return v.estornada !== true;
      });
    } catch (e) {
      state.vendas = [];
    }
  } else {
    state.vendas = [];
  }

  // 6. Carrinho / Sacola de Compras Local-First
  const cartSalvo = localStorage.getItem('casa_carrinho');
  if (cartSalvo) {
    try {
      const parsedCart = JSON.parse(cartSalvo);
      state.carrinho = Array.isArray(parsedCart) ? parsedCart : [];
    } catch (e) {
      state.carrinho = [];
    }
  } else {
    state.carrinho = [];
  }

  // 7. Categorias
  const cats = localStorage.getItem('casa_categorias');
  if (cats) {
    try {
      const parsedCats = JSON.parse(cats);
      if (Array.isArray(parsedCats) && parsedCats.length > 0) {
        state.categorias = parsedCats;
      }
    } catch (e) {}
  }

  // 8. Configurações
  const cfg = localStorage.getItem('casa_config');
  if (cfg) {
    try {
      const parsed = JSON.parse(cfg);
      state.config = {
        ...state.config,
        ...parsed,
        tetoReserva: parseFloat(parsed.tetoReserva || parsed.teto_meta) || 1500.00,
        percentualReserva: parseFloat(parsed.percentualReserva || parsed.percentual) || 30,
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
  try {
    localStorage.setItem('casa_produtos', JSON.stringify(state.produtos));
    localStorage.setItem('casa_vendas', JSON.stringify(state.vendas));
    localStorage.setItem('casa_carrinho', JSON.stringify(state.carrinho));
    localStorage.setItem('casa_categorias', JSON.stringify(state.categorias));
    localStorage.setItem('casa_config', JSON.stringify(state.config));
    localStorage.setItem('casa_sync_queue', JSON.stringify(state.syncQueue));
    localStorage.setItem('casa_tombstones', JSON.stringify([...state.tombstones]));

    // Espelhamento assíncrono não-bloqueante no IndexedDB
    persistirOutboxIndexedDB(state.syncQueue).catch(() => {});
  } catch (err) {
    console.warn('[State] Alerta ao persistir localStorage:', err);
  }
}

// --- GERENCIAMENTO DA FILA OUTBOX (MUTAÇÕES OFFLINE / RESILIENTES) ---

/**
 * Enfileira uma mutação com ID de idempotência único para envio seguro ao Supabase.
 * @param {'PRODUTO_UPSERT'|'PRODUTO_DELETE'|'VENDA_TRANSACIONAL'|'ESTORNO_TRANSACIONAL'|'VENDAS_CLEAR'|'CONFIG_UPSERT'} tipo
 * @param {'produtos'|'vendas'|'configuracoes'} entidade
 * @param {string} id - ID do registro alvo
 * @param {any} dados - Carga de dados (payload)
 * @param {string} [operacaoIdExistente] - Opcional: reutiliza operacao_id em caso de retry
 * @returns {string} operation_id único
 */
export function enfileirarMutacao(tipo, entidade, id, dados, operacaoIdExistente = null) {
  const agora = Date.now();
  const operationId = operacaoIdExistente || crypto.randomUUID();

  // Se for exclusão de produto, registra tombstone imediatamente
  if (tipo === 'PRODUTO_DELETE' && id) {
    state.tombstones.add(id);
    // Elimina qualquer UPSERT anterior pendente para o mesmo produto
    state.syncQueue = state.syncQueue.filter(j => !(j.entidade === 'produtos' && String(j.id) === String(id)));
  } else if (tipo === 'PRODUTO_UPSERT') {
    // Se o produto estava em tombstone, remove-o (ressuscitação explícita por nova criação)
    if (id) state.tombstones.delete(id);
    const indexExistente = state.syncQueue.findIndex(j => j.entidade === 'produtos' && String(j.id) === String(id) && j.tipo === 'PRODUTO_UPSERT');
    if (indexExistente >= 0) {
      state.syncQueue[indexExistente].dados = dados;
      state.syncQueue[indexExistente].timestamp = agora;
      salvarLocal();
      return state.syncQueue[indexExistente].operation_id;
    }
  } else if (tipo === 'CONFIG_UPSERT') {
    const chave = dados?.chave;
    const indexExistente = state.syncQueue.findIndex(j => j.tipo === 'CONFIG_UPSERT' && j.dados?.chave === chave);
    if (indexExistente >= 0) {
      state.syncQueue[indexExistente].dados = dados;
      state.syncQueue[indexExistente].timestamp = agora;
      salvarLocal();
      return state.syncQueue[indexExistente].operation_id;
    }
  }

  const job = {
    jobId: crypto.randomUUID(),
    operation_id: operationId,
    tipo,
    entidade,
    id: id || null,
    dados: dados || null,
    timestamp: agora,
    retentativas: 0,
    ultimo_erro: null,
    status: 'pendente',
    deviceId: state.deviceId
  };

  state.syncQueue.push(job);
  salvarLocal();
  return job.operation_id;
}

export function removerMutacaoDaFila(jobId) {
  state.syncQueue = state.syncQueue.filter(j => j.jobId !== jobId);
  salvarLocal();
}

export function obterFilaPendencias() {
  return state.syncQueue;
}

export function temMutacaoPendente(entidade, id) {
  if (!id) return false;
  return state.syncQueue.some(j => j.entidade === entidade && String(j.id) === String(id));
}

export function adicionarTombstone(id) {
  if (!id) return;
  state.tombstones.add(id);
  salvarLocal();
}

export function ehTombstone(id) {
  if (!id) return false;
  return state.tombstones.has(id);
}

// ==============================================================================
// GERENCIAMENTO DA SACOLA / CARRINHO DE COMPRAS MULTI-ITEM (LOCAL-FIRST)
// ==============================================================================

/**
 * Adiciona um produto ou combinação de variação à sacola.
 * Se o mesmo item já estiver presente, consolida a quantidade até o saldo disponível.
 */
export function adicionarAoCarrinho(produto, variante = null, quantidade = 1) {
  if (!produto) return { sucesso: false, mensagem: 'Produto inválido.' };

  const estoqueMax = variante ? (variante.estoque_atual || 0) : (produto.estoque_atual || 0);
  if (estoqueMax <= 0) {
    return { sucesso: false, mensagem: 'Item esgotado no estoque.' };
  }

  const varId = variante ? variante.id : null;
  const itemExistente = state.carrinho.find(it => it.produto_id === produto.id && it.variante_id === varId);

  if (itemExistente) {
    const novaQtd = itemExistente.quantidade + quantidade;
    if (novaQtd > estoqueMax) {
      itemExistente.quantidade = estoqueMax;
      salvarLocal();
      return {
        sucesso: true,
        atingiuLimite: true,
        mensagem: `Quantidade ajustada ao limite de estoque disponível (${estoqueMax} un).`
      };
    }
    itemExistente.quantidade = novaQtd;
  } else {
    const precoUnit = Number(variante?.preco_venda !== undefined && variante?.preco_venda !== null ? variante.preco_venda : produto.preco_venda) || 0;
    const custoUnit = Number(variante?.preco_custo !== undefined && variante?.preco_custo !== null ? variante.preco_custo : produto.preco_custo) || 0;
    const fotoFinal = (variante && variante.imagem) ? variante.imagem : (produto.imagem || null);
    const skuFinal = (variante && variante.sku) ? variante.sku : (produto.sku || null);

    state.carrinho.push({
      item_id: crypto.randomUUID(),
      produto_id: produto.id,
      nome: produto.nome,
      nome_produto: produto.nome,
      categoria: produto.categoria || 'Geral',
      subcategoria: produto.subcategoria || null,
      variante_id: varId,
      variacao_nome: variante ? variante.nome_combinacao : null,
      variacao_atributos: variante ? (variante.combinacao || null) : null,
      sku: skuFinal,
      preco_unitario: precoUnit,
      preco_custo: custoUnit,
      quantidade: Math.min(quantidade, estoqueMax),
      imagem: fotoFinal,
      estoque_disponivel: estoqueMax
    });
  }

  salvarLocal();
  return { sucesso: true, mensagem: 'Item adicionado à sacola!' };
}

export function removerDoCarrinho(prodOrItemId, varianteId = null) {
  state.carrinho = state.carrinho.filter(it => {
    if (it.item_id === prodOrItemId) return false;
    if (it.produto_id === prodOrItemId && (it.variante_id || null) === (varianteId || null)) return false;
    return true;
  });
  salvarLocal();
}

export function ajustarQtdCarrinho(prodOrItemId, varianteOrDelta, deltaOpt = null) {
  let item = null;
  let delta = 0;

  if (typeof varianteOrDelta === 'number') {
    delta = varianteOrDelta;
    item = state.carrinho.find(it => it.item_id === prodOrItemId);
  } else {
    const varianteId = varianteOrDelta || null;
    delta = typeof deltaOpt === 'number' ? deltaOpt : 0;
    item = state.carrinho.find(it => it.produto_id === prodOrItemId && (it.variante_id || null) === (varianteId || null));
  }

  if (!item) return;

  const prod = state.produtos.find(p => p.id === item.produto_id);
  let estoqueMax = item.estoque_disponivel || 999;
  if (prod) {
    if (item.variante_id && prod.variantes) {
      const vObj = prod.variantes.find(v => v.id === item.variante_id);
      if (vObj) estoqueMax = vObj.estoque_atual || 0;
    } else {
      estoqueMax = prod.estoque_atual || 0;
    }
    item.estoque_disponivel = estoqueMax;
  }

  const novaQtd = item.quantidade + delta;
  if (novaQtd <= 0) {
    removerDoCarrinho(item.item_id);
    return;
  }
  if (novaQtd > estoqueMax) {
    item.quantidade = estoqueMax;
    salvarLocal();
    return;
  }
  item.quantidade = novaQtd;
  salvarLocal();
}

export function limparCarrinho() {
  state.carrinho = [];
  salvarLocal();
}

export function obterTotaisCarrinho() {
  let subtotal = 0;
  let custoTotal = 0;
  let totalUnidades = 0;

  state.carrinho.forEach(item => {
    const qtd = item.quantidade || 1;
    const preco = item.preco_unitario || 0;
    const custo = item.preco_custo || 0;
    subtotal += qtd * preco;
    custoTotal += qtd * custo;
    totalUnidades += qtd;
  });

  const total = subtotal; // Pronto para descontos futuros
  const lucroBruto = total - custoTotal;
  const pctReserva = (state.config.percentualReserva || 30) / 100;
  const reservaTotal = lucroBruto > 0 ? (lucroBruto * pctReserva) : 0;

  return {
    totalItens: state.carrinho.length,
    totalItensLinhas: state.carrinho.length,
    totalUnidades,
    subtotal,
    desconto: 0,
    total,
    custoTotal,
    lucroBruto,
    reservaTotal,
    reservaCalculada: reservaTotal
  };
}

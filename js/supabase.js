// js/supabase.js — Integração com Nuvem Supabase e WebSocket Realtime

import { state, salvarLocal } from './state.js';
import { mostrarToast, fecharModalAtual, refreshIcons, pedirConfirmacao, forcarAtualizacaoLocal } from './utils.js';

export const DEFAULT_SUPABASE_URL = 'https://gzkfzgbysodflayeejgy.supabase.co';
export const DEFAULT_SUPABASE_KEY = 'sb_publishable_Pineihb_QYU9SoOKWfa37g_11PXYZR9';

let appRenderCallback = null;
let realtimeChannel = null;

export function setAppRenderCallback(fn) {
  appRenderCallback = fn;
}

export function atualizarUIStatusNuvem(conectado) {
  const dot = document.getElementById('syncStatusDot');
  const txt = document.getElementById('statusConexaoTxt');
  const btn = document.getElementById('btnSalvarSupabase');

  if (conectado) {
    if (dot) dot.classList.add('online');
    if (txt) {
      txt.innerText = 'Conectado em tempo real';
      txt.style.color = 'var(--success)';
    }
    if (btn) {
      btn.className = 'btn-cancel';
      btn.style.width = 'auto';
      btn.style.padding = '0 14px';
      btn.style.height = '34px';
      btn.style.fontSize = '12px';
      btn.innerHTML = '<i data-lucide="power" style="width: 14px; height: 14px;"></i> <span>Desconectar</span>';
    }
  } else {
    if (dot) dot.classList.remove('online');
    if (txt) {
      txt.innerText = 'Desconectado';
      txt.style.color = 'var(--text-muted)';
    }
    if (btn) {
      btn.className = 'btn-main';
      btn.style.width = 'auto';
      btn.style.padding = '0 14px';
      btn.style.height = '34px';
      btn.style.fontSize = '12px';
      btn.innerHTML = '<i data-lucide="plug" style="width: 14px; height: 14px;"></i> <span>Conectar</span>';
    }
  }
  refreshIcons();
}

export function iniciarSupabaseSeConfigurado() {
  const url = localStorage.getItem('casa_supabase_url') || DEFAULT_SUPABASE_URL;
  const key = localStorage.getItem('casa_supabase_key') || DEFAULT_SUPABASE_KEY;

  const urlInput = document.getElementById('cfgSupabaseUrl');
  const keyInput = document.getElementById('cfgSupabaseKey');
  if (urlInput) urlInput.value = url;
  if (keyInput) keyInput.value = key;

  // Se o usuário optou por desconectar, respeita a decisão
  if (localStorage.getItem('casa_supabase_desconectado') === 'true') {
    atualizarUIStatusNuvem(false);
    return;
  }

  if (url && key && window.supabase) {
    conectarClienteSupabase(url, key);
  } else {
    atualizarUIStatusNuvem(false);
  }
}

function conectarClienteSupabase(url, key) {
  try {
    state.supabase = window.supabase.createClient(url, key);
    atualizarUIStatusNuvem(true);
    conectarRealtime();
    baixarDadosIniciaisNuvem();
  } catch (e) {
    console.error('[Supabase] Falha ao inicializar:', e);
    const txt = document.getElementById('statusConexaoTxt');
    if (txt) {
      txt.innerText = 'Erro ao conectar';
      txt.style.color = 'var(--danger)';
    }
    atualizarUIStatusNuvem(false);
  }
}

export function desconectarSupabase() {
  if (realtimeChannel) {
    try {
      realtimeChannel.unsubscribe();
    } catch (e) {}
    realtimeChannel = null;
  }
  state.supabase = null;
  localStorage.setItem('casa_supabase_desconectado', 'true');
  atualizarUIStatusNuvem(false);
  mostrarToast('Nuvem desconectada. Operando no modo local.');
}

export function conectarSupabase() {
  const url = document.getElementById('cfgSupabaseUrl')?.value.trim() || localStorage.getItem('casa_supabase_url') || DEFAULT_SUPABASE_URL;
  const key = document.getElementById('cfgSupabaseKey')?.value.trim() || localStorage.getItem('casa_supabase_key') || DEFAULT_SUPABASE_KEY;

  if (!url || !key) {
    mostrarToast('Preencha a URL e a Chave do Supabase.');
    return;
  }

  localStorage.setItem('casa_supabase_url', url);
  localStorage.setItem('casa_supabase_key', key);
  localStorage.removeItem('casa_supabase_desconectado');

  mostrarToast('Conectando ao Supabase...');
  conectarClienteSupabase(url, key);
}

export function alternarConexaoSupabase() {
  if (state.supabase) {
    desconectarSupabase();
  } else {
    conectarSupabase();
  }
}

export const salvarConfigSupabase = alternarConexaoSupabase;

/**
 * Salva ou atualiza um produto no Supabase com resiliência total.
 * Se a coluna 'imagem' ainda não existir no banco (erro PGRST204),
 * retira o campo 'imagem' e retenta imediatamente, garantindo que o produto
 * e seu estoque NUNCA deixem de sincronizar entre os aparelhos.
 */
export async function salvarProdutoNuvem(prod) {
  if (!state.supabase || !prod) return false;
  try {
    const { error } = await state.supabase.from('casa_produtos').upsert([prod]);
    if (error) {
      console.warn('[Sync] Upsert completo de produto falhou:', error);
      // Fallback gracioso: coluna 'imagem' ausente no schema cache
      if (error.code === 'PGRST204' || (error.message && error.message.includes('imagem'))) {
        console.info('[Sync] Coluna imagem ausente na nuvem. Salvando dados cadastrais e estoque...');
        const sanitizado = { ...prod };
        delete sanitizado.imagem;
        const { error: errRetry } = await state.supabase.from('casa_produtos').upsert([sanitizado]);
        if (errRetry) {
          console.error('[Sync] Falha crítica ao salvar produto sem imagem:', errRetry);
          return false;
        }
        return true;
      }
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Sync] Exceção ao salvar produto na nuvem:', err);
    return false;
  }
}

export function conectarRealtime() {
  if (!state.supabase) return;

  if (realtimeChannel) {
    try {
      state.supabase.removeChannel(realtimeChannel);
    } catch (e) {}
    realtimeChannel = null;
  }

  realtimeChannel = state.supabase.channel('casa-sagrado-channel');

  realtimeChannel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'casa_produtos' }, payload => {
      sincronizarProdutoRealtime(payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'casa_vendas' }, payload => {
      sincronizarVendaRealtime(payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'casa_configuracoes' }, payload => {
      sincronizarConfigRealtime(payload);
    })
    // Broadcast em tempo real para forçar atualização em massa em todos os aparelhos
    .on('broadcast', { event: 'comando_forcar_update' }, async (event) => {
      const solicitante = event.payload?.solicitante || 'Administrador';
      console.log('[Realtime] Comando remoto de atualização recebido de:', solicitante);
      mostrarToast(`Atualização lançada por ${solicitante}! Atualizando aplicativo...`);
      setTimeout(async () => {
        await forcarAtualizacaoLocal(false);
      }, 1500);
    })
    .subscribe((status) => {
      console.log('[Realtime] Status do canal:', status);
      const dot = document.getElementById('syncStatusDot');
      if (status === 'SUBSCRIBED') {
        if (dot) dot.classList.add('online');
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        if (dot) dot.classList.remove('online');
      }
    });
}

function sincronizarProdutoRealtime(payload) {
  if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
    const item = payload.new;
    const idx = state.produtos.findIndex(p => p.id === item.id);
    if (idx >= 0) {
      // Se a imagem veio vazia da nuvem mas existe em cache local, preserva
      const imgLocal = state.produtos[idx].imagem;
      state.produtos[idx] = { ...state.produtos[idx], ...item };
      if (!state.produtos[idx].imagem && imgLocal) {
        state.produtos[idx].imagem = imgLocal;
      }
    } else {
      state.produtos.unshift(item);
    }
    salvarLocal();
    if (appRenderCallback) appRenderCallback();
  } else if (payload.eventType === 'DELETE') {
    const idRemovido = payload.old?.id;
    if (idRemovido) {
      state.produtos = state.produtos.filter(p => p.id !== idRemovido);
      salvarLocal();
      if (appRenderCallback) appRenderCallback();
    }
  }
}

function sincronizarVendaRealtime(payload) {
  if (payload.eventType === 'INSERT') {
    const novaVenda = payload.new;
    if (!state.vendas.some(v => v.id === novaVenda.id)) {
      state.vendas.unshift(novaVenda);
      salvarLocal();
      if (appRenderCallback) appRenderCallback();
    }
  } else if (payload.eventType === 'UPDATE') {
    const vendaAtualizada = payload.new;
    const idx = state.vendas.findIndex(v => v.id === vendaAtualizada.id);
    if (idx >= 0) {
      state.vendas[idx] = { ...state.vendas[idx], ...vendaAtualizada };
      salvarLocal();
      if (appRenderCallback) appRenderCallback();
    }
  } else if (payload.eventType === 'DELETE') {
    const idRemovido = payload.old?.id;
    if (idRemovido) {
      state.vendas = state.vendas.filter(v => v.id !== idRemovido);
      salvarLocal();
      if (appRenderCallback) appRenderCallback();
    }
  }
}

function sincronizarConfigRealtime(payload) {
  if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
    const c = payload.new;
    if (!c || !c.chave) return;
    if (c.chave === 'categorias' && Array.isArray(c.valor)) {
      state.categorias = c.valor;
    } else if (c.chave === 'fundo_reserva' && c.valor) {
      state.config = { ...state.config, ...c.valor };
    } else if (c.chave === 'custos_fixos' && c.valor) {
      state.config.custosFixos = {
        itens: Array.isArray(c.valor.itens) ? c.valor.itens : [],
        diasUteisMes: Math.max(1, parseInt(c.valor.diasUteisMes, 10) || 26)
      };
    }
    salvarLocal();
    if (appRenderCallback) appRenderCallback();
  }
}

export async function lancarAtualizacaoGeral() {
  const confirmou = await pedirConfirmacao({
    titulo: 'Lançar Atualização Geral',
    mensagem: 'Deseja disparar uma limpeza de cache e atualização para todos os dispositivos conectados? Todos os terminais sincronizados serão atualizados para a versão mais recente.',
    textoConfirmar: 'Sim, atualizar todos',
    perigo: false
  });

  if (!confirmou) return;

  mostrarToast('Disparando atualização para os dispositivos...');

  const timestamp = Date.now();
  const solicitante = state.operador || 'Operador';

  if (state.supabase) {
    try {
      // 1. Grava na nuvem para atualizar quem abrir o app depois
      await state.supabase.from('casa_configuracoes').upsert([{
        chave: 'versao_app',
        valor: { timestamp, solicitante, versao: 'v20.1' },
        updated_at: new Date().toISOString()
      }]);

      // 2. Dispara broadcast em tempo real para quem está com o app aberto agora
      if (realtimeChannel) {
        await realtimeChannel.send({
          type: 'broadcast',
          event: 'comando_forcar_update',
          payload: { solicitante, timestamp }
        });
      }
    } catch (e) {
      console.warn('[Broadcast] Falha ao enviar broadcast:', e);
    }
  }

  // 3. Atualiza o aparelho atual também
  setTimeout(async () => {
    localStorage.setItem('casa_last_remote_update', timestamp.toString());
    await forcarAtualizacaoLocal(false);
  }, 1000);
}

/**
 * Reconciliação bi-direcional completa:
 * - Baixa produtos, vendas e configurações da nuvem.
 * - Detecta produtos/vendas criados localmente que não subiram e sobe-os automaticamente.
 * - Respeita coleções vazias legítimas e preserva fotos em cache local.
 */
export async function baixarDadosIniciaisNuvem() {
  if (!state.supabase) return;
  try {
    // 0. Verifica se houve um lançamento de atualização recente
    const { data: cfgVersao } = await state.supabase.from('casa_configuracoes').select('*').eq('chave', 'versao_app').maybeSingle();
    if (cfgVersao && cfgVersao.valor && cfgVersao.valor.timestamp) {
      const lastUpdateLocal = parseInt(localStorage.getItem('casa_last_remote_update') || '0', 10);
      if (cfgVersao.valor.timestamp > lastUpdateLocal) {
        localStorage.setItem('casa_last_remote_update', cfgVersao.valor.timestamp.toString());
        mostrarToast('Nova versão detectada na nuvem. Atualizando app...');
        setTimeout(async () => {
          await forcarAtualizacaoLocal(false);
        }, 1200);
        return;
      }
    }

    // 1. Baixa configurações (categorias, meta de reserva e custos fixos)
    const { data: configs } = await state.supabase.from('casa_configuracoes').select('*');
    if (configs && configs.length > 0) {
      configs.forEach(c => {
        if (c.chave === 'categorias' && Array.isArray(c.valor) && c.valor.length > 0) {
          state.categorias = c.valor;
        }
        if (c.chave === 'fundo_reserva' && c.valor) {
          state.config = { ...state.config, ...c.valor };
        }
        if (c.chave === 'custos_fixos' && c.valor) {
          state.config.custosFixos = {
            itens: Array.isArray(c.valor.itens) ? c.valor.itens : [],
            diasUteisMes: Math.max(1, parseInt(c.valor.diasUteisMes, 10) || 26)
          };
        }
      });
      salvarLocal();
    }

    // 2. Reconciliação de Produtos (Nuvem ⇄ Local)
    const { data: prods, error: errProds } = await state.supabase.from('casa_produtos').select('*');
    if (!errProds && Array.isArray(prods)) {
      const idsNuvem = new Set(prods.map(p => p.id));
      
      // Se temos produtos locais que NÃO estão na nuvem (ex: erro anterior de coluna ou cadastro offline), envia-os!
      const locaisNaoSincronizados = state.produtos.filter(p => !idsNuvem.has(p.id));
      if (locaisNaoSincronizados.length > 0) {
        console.log(`[Sync] Enviando ${locaisNaoSincronizados.length} produto(s) pendente(s) para a nuvem...`);
        for (const p of locaisNaoSincronizados) {
          await salvarProdutoNuvem(p);
        }
        const { data: prodsAtualizados } = await state.supabase.from('casa_produtos').select('*');
        if (prodsAtualizados) {
          state.produtos = prodsAtualizados.map(np => {
            const localMatch = state.produtos.find(lp => lp.id === np.id);
            if (localMatch && localMatch.imagem && !np.imagem) {
              return { ...np, imagem: localMatch.imagem };
            }
            return np;
          });
        }
      } else if (prods.length > 0) {
        // Nuvem tem produtos: atualiza local preservando fotos locais se houver
        state.produtos = prods.map(np => {
          const localMatch = state.produtos.find(lp => lp.id === np.id);
          if (localMatch && localMatch.imagem && !np.imagem) {
            return { ...np, imagem: localMatch.imagem };
          }
          return np;
        });
      } else if (prods.length === 0 && state.produtos.length === 0) {
        state.produtos = [];
      }
      salvarLocal();
    }

    // 3. Reconciliação de Vendas (Nuvem ⇄ Local)
    const { data: sales, error: errSales } = await state.supabase.from('casa_vendas').select('*').order('created_at', { ascending: false });
    if (!errSales && Array.isArray(sales)) {
      const idsSalesNuvem = new Set(sales.map(s => s.id));
      const vendasLocaisNaoSubiram = state.vendas.filter(v => v.id && !idsSalesNuvem.has(v.id));
      if (vendasLocaisNaoSubiram.length > 0) {
        console.log(`[Sync] Enviando ${vendasLocaisNaoSubiram.length} venda(s) pendente(s) para a nuvem...`);
        for (const v of vendasLocaisNaoSubiram) {
          try { await state.supabase.from('casa_vendas').insert([v]); } catch (e) {}
        }
        const { data: salesAtualizadas } = await state.supabase.from('casa_vendas').select('*').order('created_at', { ascending: false });
        if (salesAtualizadas) {
          state.vendas = salesAtualizadas;
        }
      } else {
        state.vendas = sales;
      }
      salvarLocal();
    }

    if (appRenderCallback) appRenderCallback();
  } catch (err) {
    console.warn('[Sync] Falha ao carregar dados iniciais da nuvem:', err);
  }
}

/**
 * Sincronização silenciosa acionada em retorno do foco ou heartbeat
 */
export async function sincronizarTudoSilenciosamente() {
  if (!state.supabase || document.visibilityState === 'hidden') return;
  try {
    await baixarDadosIniciaisNuvem();
  } catch (e) {
    console.debug('[Sync] Sync silencioso:', e);
  }
}

/**
 * Força sincronização imediata manual com toast feedback
 */
export async function forcarSincronizacaoManual() {
  if (!state.supabase) {
    mostrarToast('Supabase não conectado. Conecte primeiro.');
    return;
  }
  mostrarToast('Sincronizando com a nuvem...');
  try {
    await baixarDadosIniciaisNuvem();
    mostrarToast(`Nuvem sincronizada! ${state.produtos.length} produtos e ${state.vendas.length} vendas.`);
  } catch (err) {
    mostrarToast('Falha na sincronização. Verifique a internet.');
  }
}

export function exportarBackupJSON() {
  const backup = {
    produtos: state.produtos,
    vendas: state.vendas,
    categorias: state.categorias,
    config: state.config,
    exportadoEm: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `backup_casa_do_sagrado_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

export function exportarRelatorioCSV() {
  if (!state.vendas || state.vendas.length === 0) {
    mostrarToast('Nenhuma venda registrada para exportar.');
    return;
  }

  const cabecalhos = [
    'Data',
    'Hora',
    'Produto',
    'Categoria',
    'Quantidade',
    'Preco Unitario (R$)',
    'Custo Unitario (R$)',
    'Valor Total (R$)',
    'Custo Total (R$)',
    'Lucro Bruto (R$)',
    'Reserva (R$)',
    'Forma Pagamento',
    'Operador',
    'ID Venda'
  ];

  const escapeCSV = (str) => {
    if (str == null) return '""';
    const s = String(str).replace(/"/g, '""');
    return `"${s}"`;
  };

  const formatarNumCSV = (num) => {
    if (num == null || isNaN(num)) return '0,00';
    return Number(num).toFixed(2).replace('.', ',');
  };

  const linhas = [cabecalhos.map(escapeCSV).join(';')];

  state.vendas.forEach(v => {
    const prod = state.produtos.find(p => p.id === v.produto_id);
    const cat = prod ? prod.categoria : 'Geral';
    const nome = prod ? prod.nome : (v.nome_produto || 'Produto');
    const d = new Date(v.created_at);
    const dataStr = !isNaN(d) ? d.toLocaleDateString('pt-BR') : '';
    const horaStr = !isNaN(d) ? d.toLocaleTimeString('pt-BR') : '';
    const qtd = parseInt(v.quantidade, 10) || 1;
    const custoUnit = prod ? prod.preco_custo : ((v.custo_total || 0) / qtd);

    const linha = [
      escapeCSV(dataStr),
      escapeCSV(horaStr),
      escapeCSV(nome),
      escapeCSV(cat),
      qtd,
      formatarNumCSV(v.valor_unitario),
      formatarNumCSV(custoUnit),
      formatarNumCSV(v.valor_total),
      formatarNumCSV(v.custo_total),
      formatarNumCSV(v.lucro_bruto),
      formatarNumCSV(v.valor_reserva_30),
      escapeCSV(v.metodo_pagamento || 'Outro'),
      escapeCSV(v.operador || 'Operador'),
      escapeCSV(v.id || '')
    ];
    linhas.push(linha.join(';'));
  });

  const conteudoCSV = '\uFEFF' + linhas.join('\r\n');
  const blob = new Blob([conteudoCSV], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const hoje = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `relatorio_vendas_casa_sagrado_${hoje}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  mostrarToast('Relatório CSV para Excel / IA baixado com sucesso!');
}

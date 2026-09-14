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

export function iniciarSupabaseSeConfigurado() {
  const url = localStorage.getItem('casa_supabase_url') || DEFAULT_SUPABASE_URL;
  const key = localStorage.getItem('casa_supabase_key') || DEFAULT_SUPABASE_KEY;

  const urlInput = document.getElementById('cfgSupabaseUrl');
  const keyInput = document.getElementById('cfgSupabaseKey');
  if (urlInput) urlInput.value = url;
  if (keyInput) keyInput.value = key;

  if (url && key && window.supabase) {
    try {
      state.supabase = window.supabase.createClient(url, key);
      const dot = document.getElementById('syncStatusDot');
      if (dot) dot.classList.add('online');
      
      const txt = document.getElementById('statusConexaoTxt');
      if (txt) {
        txt.innerText = 'Conectado em tempo real';
        txt.style.color = 'var(--success)';
      }
      
      conectarRealtime();
      baixarDadosIniciaisNuvem();
    } catch (e) {
      console.error('[Supabase] Falha ao inicializar:', e);
      const txt = document.getElementById('statusConexaoTxt');
      if (txt) {
        txt.innerText = 'Erro ao conectar';
        txt.style.color = 'var(--danger)';
      }
    }
  }
}

export function salvarConfigSupabase() {
  const url = document.getElementById('cfgSupabaseUrl').value.trim();
  const key = document.getElementById('cfgSupabaseKey').value.trim();

  if (!url || !key) {
    mostrarToast('Preencha a URL e a Chave do Supabase.');
    return;
  }

  localStorage.setItem('casa_supabase_url', url);
  localStorage.setItem('casa_supabase_key', key);

  fecharModalAtual();
  mostrarToast('Conectando ao Supabase...');
  iniciarSupabaseSeConfigurado();
}

export function conectarRealtime() {
  if (!state.supabase) return;

  realtimeChannel = state.supabase.channel('casa-sagrado-channel');

  realtimeChannel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'casa_produtos' }, payload => {
      sincronizarProdutoRealtime(payload);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'casa_vendas' }, payload => {
      sincronizarVendaRealtime(payload.new);
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
    .subscribe();
}

function sincronizarProdutoRealtime(payload) {
  if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
    const item = payload.new;
    const idx = state.produtos.findIndex(p => p.id === item.id);
    if (idx >= 0) {
      state.produtos[idx] = { ...state.produtos[idx], ...item };
    } else {
      state.produtos.unshift(item);
    }
    salvarLocal();
    if (appRenderCallback) appRenderCallback();
  }
}

function sincronizarVendaRealtime(novaVenda) {
  if (!state.vendas.some(v => v.id === novaVenda.id)) {
    state.vendas.unshift(novaVenda);
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
        valor: { timestamp, solicitante, versao: 'v9' },
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

    // 1. Baixa configurações (categorias e meta de reserva)
    const { data: configs } = await state.supabase.from('casa_configuracoes').select('*');
    if (configs && configs.length > 0) {
      configs.forEach(c => {
        if (c.chave === 'categorias' && Array.isArray(c.valor) && c.valor.length > 0) {
          state.categorias = c.valor;
        }
        if (c.chave === 'fundo_reserva' && c.valor) {
          state.config = { ...state.config, ...c.valor };
        }
      });
      salvarLocal();
    }

    // 2. Baixa produtos
    const { data: prods } = await state.supabase.from('casa_produtos').select('*');
    if (prods && prods.length > 0) {
      state.produtos = prods;
      salvarLocal();
    }

    // 3. Baixa vendas
    const { data: sales } = await state.supabase.from('casa_vendas').select('*').order('created_at', { ascending: false });
    if (sales && sales.length > 0) {
      state.vendas = sales;
      salvarLocal();
    }

    if (appRenderCallback) appRenderCallback();
  } catch (err) {
    console.warn('[Sync] Falha ao carregar dados iniciais da nuvem:', err);
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

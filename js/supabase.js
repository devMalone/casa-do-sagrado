// js/supabase.js — Camada Central de Persistência, Conexão e Realtime
// Versão: v23.4.1 (Arquitetura Comercial com Autoridade do Servidor e Bloqueio de Downgrade)

import { state, salvarLocal, temMutacaoPendente, adicionarTombstone, ehTombstone, garantirUUID } from './state.js';
import { mostrarToast, refreshIcons, pedirConfirmacao, forcarAtualizacaoLocal } from './utils.js';
import { reconciliarComServidor, processarOutbox, logSync, setSyncEngineRenderCallback, setNovoReleaseCallback } from './sync_engine.js';
import { obterImagemLocal } from './indexed_db.js';
import { APP_VERSION, BUILD_ID, DB_SCHEMA_VERSION, CACHE_NAME, compararVersoesSemanticas, consultarVersaoServidor, obterUltimoRequestIdProcessado, salvarUltimoRequestIdProcessado } from './version.js';

export const DEFAULT_SUPABASE_URL = 'https://gzkfzgbysodflayeejgy.supabase.co';
export const DEFAULT_SUPABASE_KEY = 'sb_publishable_Pineihb_QYU9SoOKWfa37g_11PXYZR9';

let appRenderCallback = null;
let realtimeChannel = null;

// Conecta reconciliação periódica à detecção de pedido global de atualização
setNovoReleaseCallback((payload) => {
  tratarPedidoGlobalAtualizacao(payload);
});

export function setAppRenderCallback(fn) {
  appRenderCallback = fn;
  setSyncEngineRenderCallback(fn);
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
    logSync('RECONNECT', 'Iniciando cliente Supabase...');
    state.supabase = window.supabase.createClient(url, key);
    atualizarUIStatusNuvem(true);
    conectarRealtime();
    reconciliarComServidor();
  } catch (e) {
    logSync('ERROR', 'Falha ao inicializar Supabase:', e);
    const txt = document.getElementById('statusConexaoTxt');
    if (txt) {
      txt.innerText = 'Erro ao conectar';
      txt.style.color = 'var(--danger)';
    }
    atualizarUIStatusNuvem(false);
  }
}

export function desconectarSupabase() {
  if (realtimeChannel && state.supabase) {
    try {
      state.supabase.removeChannel(realtimeChannel);
    } catch (e) {}
    realtimeChannel = null;
  }
  state.supabase = null;
  localStorage.setItem('casa_supabase_desconectado', 'true');
  atualizarUIStatusNuvem(false);
  mostrarToast('Nuvem desconectada. Operando no modo local.');
  logSync('LOCAL', 'Desconectado manualmente pelo usuário.');
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

// ==============================================================================
// CONEXÃO REALTIME BIDIRECIONAL E MONITORAMENTO
// ==============================================================================

export function conectarRealtime() {
  if (!state.supabase) return;

  if (realtimeChannel) {
    try {
      state.supabase.removeChannel(realtimeChannel);
    } catch (e) {}
    realtimeChannel = null;
  }

  logSync('REALTIME', 'Abrindo canal WebSocket Realtime (casa-sagrado-channel)...');
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'casa_tombstones' }, payload => {
      sincronizarTombstoneRealtime(payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'casa_intelligence_sync_state' }, payload => {
      sincronizarIntelligenceSyncStateRealtime(payload);
    })
    .on('broadcast', { event: 'app_update_request' }, async (event) => {
      const payload = event.payload || {};
      logSync('REALTIME', 'Broadcast app_update_request recebido:', payload);
      tratarPedidoGlobalAtualizacao(payload);
    })
    .on('broadcast', { event: 'comando_forcar_update' }, async (event) => {
      const payload = event.payload || {};
      logSync('REALTIME', 'Broadcast legado comando_forcar_update recebido:', payload);
      tratarPedidoGlobalAtualizacao(payload);
    })
    .subscribe((status) => {
      logSync('REALTIME', 'Status da subscrição Realtime:', status);
      const dot = document.getElementById('syncStatusDot');
      if (status === 'SUBSCRIBED') {
        if (dot) dot.classList.add('online');
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        if (dot) dot.classList.remove('online');
      }
    });
}

export function garantirConexaoRealtime(forcarReconexao = false) {
  if (!state.supabase) return;
  const isSocketConnected = state.supabase.realtime && typeof state.supabase.realtime.isConnected === 'function'
    ? state.supabase.realtime.isConnected()
    : true;

  const canalInvalido = !realtimeChannel || realtimeChannel.state === 'closed' || realtimeChannel.state === 'errored';

  if (forcarReconexao || canalInvalido || !isSocketConnected) {
    logSync('RECONNECT', 'Restabelecendo canal Realtime após suspensão ou alternância de rede...');
    conectarRealtime();
  }
}

// ==============================================================================
// TRATAMENTO DE EVENTOS REALTIME RECEBIDOS
// ==============================================================================

async function sincronizarProdutoRealtime(payload) {
  logSync('REALTIME', 'Evento produto:', payload.eventType, payload.new?.nome || payload.old?.id);

  if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
    const item = payload.new;
    if (!item || !item.id) return;

    // Se este produto foi marcado com tombstone local, ignora
    if (ehTombstone(item.id)) return;

    // Se temos mutação pendente local na fila outbox para este mesmo produto, preserva versão local
    if (temMutacaoPendente('produtos', item.id)) {
      logSync('REALTIME', `Ignorando evento para produto ${item.id} pois há alteração local pendente.`);
      return;
    }

    const idx = state.produtos.findIndex(p => p.id === item.id);
    if (idx >= 0) {
      // Conflito por timestamp do servidor
      const localUpdated = new Date(state.produtos[idx].updated_at || 0).getTime();
      const remoteUpdated = new Date(item.updated_at || 0).getTime();
      if (localUpdated > remoteUpdated) {
        logSync('REALTIME', `Ignorando produto ${item.id} com timestamp remoto mais antigo.`);
        return;
      }

      // Preserva foto local se a remota for vazia
      const imgLocal = state.produtos[idx].imagem;
      state.produtos[idx] = { ...state.produtos[idx], ...item };
      if (!state.produtos[idx].imagem && imgLocal) {
        state.produtos[idx].imagem = imgLocal;
      }
    } else {
      // Se não há imagem no payload, tenta recuperar do cache local
      if (!item.imagem) {
        const imgCache = await obterImagemLocal(item.id);
        if (imgCache) item.imagem = imgCache;
      }
      state.produtos.unshift(item);
    }
    salvarLocal();
    if (appRenderCallback) appRenderCallback();
  } else if (payload.eventType === 'DELETE') {
    const idRemovido = payload.old?.id;
    if (idRemovido) {
      logSync('REALTIME', `Removendo produto excluído remotamente: ${idRemovido}`);
      adicionarTombstone(idRemovido);
      state.produtos = state.produtos.filter(p => p.id !== idRemovido);
      salvarLocal();
      if (appRenderCallback) appRenderCallback();
    }
  }
}

function sincronizarVendaRealtime(payload) {
  logSync('REALTIME', 'Evento venda:', payload.eventType, payload.new?.id || payload.old?.id);

  if (payload.eventType === 'INSERT') {
    const novaVenda = payload.new;
    if (!novaVenda || !novaVenda.id) return;
    if (novaVenda.estornada === true) return; // Não exibe vendas já estornadas

    novaVenda.pedido_id = novaVenda.pedido_id || novaVenda.id;
    novaVenda.numero_pedido = novaVenda.numero_pedido || ('#CS-' + (novaVenda.pedido_id ? novaVenda.pedido_id.substring(0, 6).toUpperCase() : '0000'));

    if (!state.vendas.some(v => v.id === novaVenda.id)) {
      state.vendas.unshift(novaVenda);
      state.vendas.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      salvarLocal();
      if (appRenderCallback) appRenderCallback();
    }
  } else if (payload.eventType === 'UPDATE') {
    const vendaAtualizada = payload.new;
    if (!vendaAtualizada || !vendaAtualizada.id) return;

    vendaAtualizada.pedido_id = vendaAtualizada.pedido_id || vendaAtualizada.id;
    vendaAtualizada.numero_pedido = vendaAtualizada.numero_pedido || ('#CS-' + (vendaAtualizada.pedido_id ? vendaAtualizada.pedido_id.substring(0, 6).toUpperCase() : '0000'));

    // Se a venda foi estornada remotamente, expurga do histórico ativo
    if (vendaAtualizada.estornada === true) {
      logSync('REALTIME', `Venda ${vendaAtualizada.id} estornada remotamente. Removendo do histórico ativo.`);
      state.vendas = state.vendas.filter(v => v.id !== vendaAtualizada.id);
      salvarLocal();
      if (appRenderCallback) appRenderCallback();
      return;
    }

    const idx = state.vendas.findIndex(v => v.id === vendaAtualizada.id);
    if (idx >= 0) {
      state.vendas[idx] = { ...state.vendas[idx], ...vendaAtualizada };
      salvarLocal();
      if (appRenderCallback) appRenderCallback();
    }
  } else if (payload.eventType === 'DELETE') {
    const idRemovido = payload.old?.id;
    if (idRemovido) {
      logSync('REALTIME', `Removendo venda deletada remotamente: ${idRemovido}`);
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
    logSync('REALTIME', 'Configuração atualizada remotamente:', c.chave);

    if (c.chave === 'app_update_request' && c.valor) {
      tratarPedidoGlobalAtualizacao(c.valor);
      return;
    }

    if (c.chave === 'categorias' && Array.isArray(c.valor)) {
      state.categorias = c.valor;
    } else if (c.chave === 'fundo_reserva' && c.valor) {
      state.config = {
        ...state.config,
        tetoReserva: parseFloat(c.valor.tetoReserva || c.valor.teto_meta) || state.config.tetoReserva,
        percentualReserva: parseFloat(c.valor.percentualReserva || c.valor.percentual) || state.config.percentualReserva
      };
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

function sincronizarTombstoneRealtime(payload) {
  if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
    const t = payload.new;
    if (t && t.registro_id) {
      logSync('REALTIME', `Tombstone recebido: ${t.entidade} ${t.registro_id}`);
      adicionarTombstone(t.registro_id);
      if (t.entidade === 'produtos') {
        state.produtos = state.produtos.filter(p => p.id !== t.registro_id);
        salvarLocal();
        if (appRenderCallback) appRenderCallback();
      }
    }
  }
}

// ==============================================================================
// GESTÃO DE PEDIDOS GLOBAIS DE ATUALIZAÇÃO E DIAGNÓSTICO
// ==============================================================================

/**
 * Trata o recebimento de um pedido global de atualização vindo de outro terminal.
 * IMPORTANTE: O pedido NÃO contém versão da aplicação! Ele apenas sinaliza para
 * cada terminal consultar a autoridade máxima: o SERVIDOR / DEPLOY (version.json).
 */
export async function tratarPedidoGlobalAtualizacao(requestPayload) {
  if (!requestPayload || !requestPayload.request_id) return;

  const ultimoId = obterUltimoRequestIdProcessado();
  if (requestPayload.request_id === ultimoId) {
    return;
  }
  salvarUltimoRequestIdProcessado(requestPayload.request_id);

  // Se o pedido foi gerado por este próprio dispositivo, não repete
  if (requestPayload.requested_by_device && requestPayload.requested_by_device === state.deviceId) {
    return;
  }

  const solicitante = requestPayload.operador || 'Outro terminal';
  logSync('UPDATE', `Pedido global de atualização recebido (${requestPayload.request_id}) solicitado por: ${solicitante}`);

  state.ultimoPedidoAtualizacao = requestPayload;
  atualizarUIDiagnosticoVersao();

  // Proteção do PDV: se o operador estiver realizando operação crítica, exibe aviso não-bloqueante
  const modaisCriticos = ['modalVendaRapida', 'modalVariantesVenda', 'modalProduto', 'modalConfirmacao'];
  const emOperacaoCritica = state.modalStack.some(id => modaisCriticos.includes(id)) || !!state.vendaEmAndamento;

  if (emOperacaoCritica) {
    mostrarToast(`Solicitação de atualização recebida de ${solicitante}. Toque em Buscar Versão após concluir a venda.`);
    return;
  }

  mostrarToast(`Solicitação de atualização recebida de ${solicitante}. Consultando servidor...`);
  setTimeout(async () => {
    await forcarAtualizacaoLocal(false);
  }, 1000);
}

/**
 * Dispara uma solicitação global para que todos os terminais conectados
 * consultem o servidor diretamente. NUNCA envia a versão deste terminal!
 */
export async function solicitarAtualizacaoGlobal() {
  const confirmou = await pedirConfirmacao({
    titulo: 'Solicitar Atualização Global',
    mensagem: 'Deseja solicitar que todos os terminais conectados verifiquem se há uma versão mais recente no servidor? Cada aparelho consultará diretamente o servidor e atualizará apenas se houver nova versão disponível.',
    textoConfirmar: 'Sim, solicitar a todos',
    perigo: false
  });

  if (!confirmou) return;

  mostrarToast('Solicitando atualização para os terminais...');
  const requestId = crypto.randomUUID();
  const solicitante = state.operador || 'Operador';

  // PAYLOAD SEM NÚMERO DE VERSÃO: Apenas um sinalizador com UUID e timestamp
  const requestPayload = {
    request_id: requestId,
    requested_at: new Date().toISOString(),
    requested_by_device: state.deviceId,
    operador: solicitante
  };

  salvarUltimoRequestIdProcessado(requestId);
  state.ultimoPedidoAtualizacao = requestPayload;

  if (state.supabase) {
    try {
      await state.supabase.from('casa_configuracoes').upsert([{
        chave: 'app_update_request',
        valor: requestPayload,
        updated_at: new Date().toISOString()
      }]);

      if (realtimeChannel) {
        await realtimeChannel.send({
          type: 'broadcast',
          event: 'app_update_request',
          payload: requestPayload
        });
      }
      logSync('BROADCAST', 'Pedido global de atualização enviado com sucesso:', requestPayload);
    } catch (e) {
      logSync('ERROR', 'Falha ao publicar pedido global no Supabase:', e);
    }
  }

  // O próprio terminal emissor também consulta o servidor
  await forcarAtualizacaoLocal(true);
}

// Alias para compatibilidade com eventuais chamadas existentes
export const lancarAtualizacaoGeral = solicitarAtualizacaoGlobal;

/**
 * Atualiza o painel visual de diagnóstico do modalSync em tempo real.
 */
export async function atualizarUIDiagnosticoVersao() {
  const elLocal = document.getElementById('diagVersaoLocal');
  const elPub = document.getElementById('diagVersaoPublicada');
  const elBadge = document.getElementById('badgeStatusVersao');
  const elSw = document.getElementById('diagStatusSW');
  const elRel = document.getElementById('diagReleaseId');

  if (elLocal) elLocal.innerText = `v${APP_VERSION} (${BUILD_ID})`;

  if (elSw) {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      elSw.innerText = 'Ativo (Controlando)';
      elSw.style.color = '#10b981';
    } else if ('serviceWorker' in navigator) {
      elSw.innerText = 'Ativo (Não controlando)';
      elSw.style.color = '#f59e0b';
    } else {
      elSw.innerText = 'Inativo / Não suportado';
      elSw.style.color = 'var(--text-muted)';
    }
  }

  // Consulta o SERVIDOR diretamente (version.json sem cache)
  const servidor = await consultarVersaoServidor();
  if (servidor && servidor.version) {
    state.versaoServidor = servidor;
    if (elPub) elPub.innerText = `v${servidor.version} (${servidor.build_id || 'deploy'})`;

    const comp = compararVersoesSemanticas(servidor.version, APP_VERSION);
    if (elBadge) {
      if (comp === 0 && (!servidor.build_id || servidor.build_id === BUILD_ID)) {
        elBadge.className = 'badge-status-sheets sucesso';
        elBadge.innerText = 'Atualizado';
      } else if (comp > 0 || (comp === 0 && servidor.build_id && servidor.build_id !== BUILD_ID)) {
        elBadge.className = 'badge-status-sheets erro';
        elBadge.innerText = 'Atualização disponível';
      } else {
        elBadge.className = 'badge-status-sheets alerta';
        elBadge.innerText = 'Downgrade bloqueado';
      }
    }
  } else {
    if (elPub) elPub.innerText = `v${APP_VERSION} (Servidor offline)`;
    if (elBadge) {
      elBadge.className = 'badge-status-sheets sucesso';
      elBadge.innerText = 'Atualizado (Offline)';
    }
  }

  // Metadados do último pedido global de atualização
  let ult = state.ultimoPedidoAtualizacao;
  if (!ult && state.supabase) {
    try {
      const { data } = await state.supabase
        .from('casa_configuracoes')
        .select('valor')
        .eq('chave', 'app_update_request')
        .maybeSingle();
      if (data && data.valor) {
        ult = data.valor;
        state.ultimoPedidoAtualizacao = ult;
      }
    } catch (e) {}
  }

  if (elRel) {
    if (ult && ult.requested_at) {
      const d = new Date(ult.requested_at);
      const horaStr = !isNaN(d) ? d.toLocaleTimeString('pt-BR') : '';
      elRel.innerText = `${horaStr} (${ult.operador || 'Operador'})`;
    } else {
      elRel.innerText = 'Nenhum recente';
    }
  }
}

export async function carregarStatusVersaoRemota() {
  await atualizarUIDiagnosticoVersao();
}

export async function sincronizarTudoSilenciosamente() {
  if (!state.supabase || document.visibilityState === 'hidden') return;
  garantirConexaoRealtime();
  await processarOutbox();
  await reconciliarComServidor();
}

export async function forcarSincronizacaoManual() {
  if (!state.supabase) {
    mostrarToast('Supabase não conectado. Conecte primeiro.');
    return;
  }
  mostrarToast('Sincronizando com a nuvem...');
  try {
    garantirConexaoRealtime();
    await reconciliarComServidor();
    mostrarToast(`Nuvem sincronizada! ${state.produtos.length} produtos e ${state.vendas.length} vendas.`);
  } catch (err) {
    mostrarToast('Falha na sincronização. Verifique a internet.');
  }
}

// ==============================================================================
// BACKUP COMPLETO E RESTAURAÇÃO DE DADOS
// ==============================================================================

/**
 * Exporta backup JSON com metadados estruturados de versão, schema e origem.
 */
export function exportarBackupJSON() {
  const backup = {
    formato: 'CASA_DO_SAGRADO_BACKUP',
    app_versao: `v${APP_VERSION}`,
    schema_versao: DB_SCHEMA_VERSION,
    exportado_em: new Date().toISOString(),
    origem: 'Casa do Sagrado — PWA',
    produtos: state.produtos,
    vendas: state.vendas,
    categorias: state.categorias,
    config: state.config,
    tombstones: [...state.tombstones],
    syncQueue: state.syncQueue
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `backup_casa_do_sagrado_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  mostrarToast('Backup exportado com sucesso!');
}

/**
 * Processa e restaura um arquivo de backup JSON com validação estrita de integridade.
 * @param {File} file - Arquivo JSON selecionado
 */
export async function restaurarBackupJSON(file) {
  if (!file) return;

  try {
    const texto = await file.text();
    let backupObj = null;

    try {
      backupObj = JSON.parse(texto);
    } catch (errJson) {
      mostrarToast('Arquivo inválido. O arquivo selecionado não é um JSON válido.');
      return;
    }

    if (!backupObj || typeof backupObj !== 'object') {
      mostrarToast('Estrutura de backup não reconhecida.');
      return;
    }

    const produtosValidos = Array.isArray(backupObj.produtos) ? backupObj.produtos : [];
    const vendasValidas = Array.isArray(backupObj.vendas) ? backupObj.vendas : [];
    const categoriasValidas = Array.isArray(backupObj.categorias) ? backupObj.categorias : [];
    const configValida = backupObj.config && typeof backupObj.config === 'object' ? backupObj.config : null;

    const totalProdutos = produtosValidos.length;
    const totalVendas = vendasValidas.length;

    const confirmou = await pedirConfirmacao({
      titulo: 'Restaurar Backup de Dados?',
      mensagem: `O arquivo contém ${totalProdutos} produto(s) e ${totalVendas} venda(s). Deseja restaurar estes dados e mesclá-los de forma segura com o sistema?`,
      textoConfirmar: 'Sim, restaurar',
      perigo: false
    });

    if (!confirmou) return;

    mostrarToast('Restaurando dados do backup...');

    // 1. Sanitiza produtos do backup e mescla evitando duplicatas
    const idsProdutosExistentes = new Set(state.produtos.map(p => p.id));
    produtosValidos.forEach(p => {
      p.id = garantirUUID(p.id);
      if (!idsProdutosExistentes.has(p.id)) {
        state.produtos.push(p);
        idsProdutosExistentes.add(p.id);
      }
    });

    // 2. Sanitiza vendas e mescla
    const idsVendasExistentes = new Set(state.vendas.map(v => v.id));
    vendasValidas.forEach(v => {
      v.id = garantirUUID(v.id);
      if (!idsVendasExistentes.has(v.id) && v.estornada !== true) {
        state.vendas.push(v);
        idsVendasExistentes.add(v.id);
      }
    });

    // 3. Categorias
    if (categoriasValidas.length > 0) {
      const catsUnicas = new Set([...state.categorias, ...categoriasValidas]);
      state.categorias = [...catsUnicas];
    }

    // 4. Configurações
    if (configValida) {
      state.config = {
        ...state.config,
        ...configValida
      };
    }

    // 5. Persiste localmente
    salvarLocal();

    if (appRenderCallback) {
      appRenderCallback();
    }

    mostrarToast(`Backup restaurado! ${state.produtos.length} produtos e ${state.vendas.length} vendas ativas.`);

    // 6. Se estiver conectado à nuvem, dispara ciclo de reconciliação
    if (state.supabase) {
      reconciliarComServidor();
    }
  } catch (err) {
    logSync('ERROR', 'Erro ao restaurar backup JSON:', err);
    mostrarToast('Ocorreu um erro ao restaurar o backup.');
  }
}

// ==============================================================================
// EXPORTAÇÃO DE RELATÓRIO CSV PARA EXCEL E IA
// ==============================================================================

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
    'Subcategoria',
    'Variacao / Combinacao',
    'Atributos da Variacao',
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
    if (v.estornada === true) return;

    const prod = state.produtos.find(p => p.id === v.produto_id);
    const cat = prod ? prod.categoria : 'Geral';
    const subcat = v.subcategoria || (prod ? prod.subcategoria : '') || '';
    const nomeBase = prod ? prod.nome : (v.nome_produto || 'Produto');
    const varNome = v.variacao_nome || '';
    const nomeCompleto = varNome ? `${nomeBase} - ${varNome}` : nomeBase;
    const varAtributosStr = v.variacao_atributos ? JSON.stringify(v.variacao_atributos) : '';

    const d = new Date(v.created_at);
    const dataStr = !isNaN(d) ? d.toLocaleDateString('pt-BR') : '';
    const horaStr = !isNaN(d) ? d.toLocaleTimeString('pt-BR') : '';
    const qtd = parseInt(v.quantidade, 10) || 1;
    const custoUnit = prod ? prod.preco_custo : ((v.custo_total || 0) / qtd);

    const linha = [
      escapeCSV(dataStr),
      escapeCSV(horaStr),
      escapeCSV(nomeCompleto),
      escapeCSV(cat),
      escapeCSV(subcat),
      escapeCSV(varNome),
      escapeCSV(varAtributosStr),
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
  mostrarToast('Relatório CSV baixado com sucesso!');
}

// ==============================================================================
// 14. BASE DE INTELIGÊNCIA: SINCRONIZAÇÃO GOOGLE SHEETS (UNIDIRECIONAL)
// ==============================================================================

export function atualizarUIGoogleSheets(estado) {
  const badge = document.getElementById('badgeStatusGoogleSheets');
  const txtUltima = document.getElementById('txtSheetsUltimaSync');
  const txtStatus = document.getElementById('txtSheetsStatus');
  const boxErro = document.getElementById('boxSheetsErro');
  const btnTxt = document.getElementById('btnSyncGoogleSheetsTxt');
  const btnSync = document.getElementById('btnSyncGoogleSheetsAgora');

  if (!badge || !txtUltima || !txtStatus) return;

  const status = estado?.status || 'ocioso';
  badge.className = `badge-status-sheets ${status}`;

  if (status === 'sucesso') {
    badge.innerText = 'Sincronizado';
    txtStatus.innerText = 'Sincronizado com Sucesso';
    txtStatus.style.color = 'var(--success)';
  } else if (status === 'sincronizando') {
    badge.innerText = 'Sincronizando...';
    txtStatus.innerText = 'Sincronizando com Google Sheets...';
    txtStatus.style.color = '#f59e0b';
  } else if (status === 'erro') {
    badge.innerText = 'Falha';
    txtStatus.innerText = 'Falha na Sincronização';
    txtStatus.style.color = 'var(--danger)';
  } else {
    badge.innerText = 'Ocioso';
    txtStatus.innerText = 'Ocioso';
    txtStatus.style.color = 'var(--text-muted)';
  }

  if (estado?.last_success_at) {
    try {
      const d = new Date(estado.last_success_at);
      txtUltima.innerText = !isNaN(d) ? d.toLocaleString('pt-BR') : estado.last_success_at;
    } catch {
      txtUltima.innerText = estado.last_success_at;
    }
  } else {
    txtUltima.innerText = 'Nunca';
  }

  if (boxErro) {
    if (status === 'erro' && estado?.error_message) {
      boxErro.style.display = 'block';
      boxErro.innerText = estado.error_message;
    } else {
      boxErro.style.display = 'none';
      boxErro.innerText = '';
    }
  }

  if (btnSync && btnTxt) {
    if (status === 'sincronizando') {
      btnSync.disabled = true;
      btnSync.style.opacity = '0.7';
      btnTxt.innerText = 'Sincronizando...';
    } else {
      btnSync.disabled = false;
      btnSync.style.opacity = '1';
      btnTxt.innerText = 'Sincronizar Google Sheets Agora';
    }
  }
}

export async function carregarStatusGoogleSheets() {
  if (!state.supabase) {
    atualizarUIGoogleSheets({ status: 'ocioso' });
    return;
  }

  try {
    const { data, error } = await state.supabase
      .from('casa_intelligence_sync_state')
      .select('*')
      .eq('id', 'google_sheets')
      .maybeSingle();

    if (!error && data) {
      atualizarUIGoogleSheets(data);
    } else {
      atualizarUIGoogleSheets({ status: 'ocioso' });
    }
  } catch (e) {
    logSync('ERROR', 'Falha ao consultar status do Google Sheets:', e);
  }
}

export function sincronizarIntelligenceSyncStateRealtime(payload) {
  const registro = payload.new || payload.old;
  if (registro && registro.id === 'google_sheets') {
    logSync('REALTIME', 'Atualização de estado Google Sheets recebida:', registro.status);
    atualizarUIGoogleSheets(registro);
  }
}

export async function sincronizarGoogleSheets(modo = 'incremental') {
  if (!state.supabase) {
    mostrarToast('Conecte-se ao Supabase para sincronizar com o Google Sheets.');
    return;
  }

  if (!navigator.onLine) {
    mostrarToast('Dispositivo offline. A sincronização com Google Sheets requer internet.');
    return;
  }

  if (modo === 'full_rebuild') {
    const aceitou = await pedirConfirmacao(
      'Deseja reconstruir toda a planilha do zero? Todos os dados existentes no Google Sheets serão limpos e repopulados a partir do Supabase.',
      'Sim, Reconstruir',
      'Cancelar'
    );
    if (!aceitou) return;
  }

  atualizarUIGoogleSheets({ status: 'sincronizando' });
  mostrarToast(modo === 'full_rebuild' ? 'Iniciando reconstrução completa do Google Sheets...' : 'Sincronizando com Google Sheets...');

  try {
    let resultado = null;

    // 1. Tenta via client SDK invoke
    if (state.supabase.functions && typeof state.supabase.functions.invoke === 'function') {
      const { data, error } = await state.supabase.functions.invoke('sync-google-sheets', {
        body: { modo }
      });
      if (error) throw error;
      resultado = data;
    } else {
      // 2. Fallback direto HTTP para o endpoint da function
      const url = localStorage.getItem('casa_supabase_url') || DEFAULT_SUPABASE_URL;
      const key = localStorage.getItem('casa_supabase_key') || DEFAULT_SUPABASE_KEY;
      const res = await fetch(`${url}/functions/v1/sync-google-sheets`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'apikey': key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ modo })
      });
      resultado = await res.json();
      if (!res.ok) {
        throw new Error(resultado?.erro || resultado?.message || `HTTP ${res.status}`);
      }
    }

    if (resultado?.sucesso) {
      mostrarToast(resultado.mensagem || 'Google Sheets sincronizado com sucesso!');
    } else {
      throw new Error(resultado?.erro || 'Erro ao sincronizar com Google Sheets');
    }
  } catch (err) {
    const msg = err.message || String(err);
    logSync('ERROR', 'Erro ao executar sync-google-sheets:', msg);
    mostrarToast(`Erro ao sincronizar com Google Sheets: ${msg}`, true);
  } finally {
    await carregarStatusGoogleSheets();
  }
}


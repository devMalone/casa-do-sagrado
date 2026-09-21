// js/sync_engine.js — Motor Central de Sincronização, Outbox Idempotente e Reconciliação
// Versão: v23.4 (Arquitetura Comercial Transacional e Multi-Dispositivo Resiliente)

import { state, salvarLocal, removerMutacaoDaFila, temMutacaoPendente, adicionarTombstone, ehTombstone } from './state.js';
import { salvarImagemLocal, obterImagemLocal } from './indexed_db.js';

let processandoFila = false;
let retryTimer = null;
let appRenderCallback = null;
let novoReleaseCallback = null;

export function setSyncEngineRenderCallback(fn) {
  appRenderCallback = fn;
}

export function setNovoReleaseCallback(fn) {
  novoReleaseCallback = fn;
}

// --- LOGS DE DIAGNÓSTICO PADRONIZADOS ---
export function logSync(categoria, ...args) {
  const time = new Date().toLocaleTimeString('pt-BR');
  console.log(`[SYNC][${categoria}][${time}]`, ...args);
}

// ==============================================================================
// 1. SUPABASE STORAGE: UPLOAD E GESTÃO DE FOTOGRAFIAS
// ==============================================================================

/**
 * Converte DataURL Base64 em Blob para upload no Storage.
 */
function dataURLParaBlob(dataUrl) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Faz upload de imagem de produto para o bucket 'casa-produtos' do Supabase Storage.
 * Salva localmente em IndexedDB antes para garantir disponibilidade offline imediata.
 * @param {string} produtoId - UUID do produto
 * @param {string} dataUrl - Imagem em Base64
 * @returns {Promise<string>} URL pública remota ou o próprio DataURL em caso de fallback
 */
export async function sincronizarFotoStorage(produtoId, dataUrl) {
  if (!produtoId || !dataUrl) return null;

  // 1. Persiste imediatamente no IndexedDB local
  await salvarImagemLocal(produtoId, dataUrl);

  // Se a imagem já for uma URL pública HTTP, não precisa de novo upload
  if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
    return dataUrl;
  }

  // 2. Se houver conexão com o Supabase, tenta upload para o Storage
  if (state.supabase && navigator.onLine) {
    try {
      logSync('STORAGE', `Enviando foto do produto ${produtoId} para o Supabase Storage...`);
      const blob = dataURLParaBlob(dataUrl);
      const filePath = `produtos/${produtoId}.webp`;

      const { data, error } = await state.supabase.storage
        .from('casa-produtos')
        .upload(filePath, blob, {
          contentType: 'image/webp',
          upsert: true
        });

      if (!error && data) {
        const { data: publicUrlData } = state.supabase.storage
          .from('casa-produtos')
          .getPublicUrl(filePath);

        if (publicUrlData && publicUrlData.publicUrl) {
          logSync('STORAGE', `Upload concluído com sucesso: ${publicUrlData.publicUrl}`);
          return publicUrlData.publicUrl;
        }
      } else if (error) {
        logSync('STORAGE', 'Aviso ao enviar imagem para o Storage (mantendo cache local):', error.message);
      }
    } catch (err) {
      logSync('STORAGE', 'Falha no upload para Storage. Operando com cache local IndexedDB:', err);
    }
  }

  // Fallback seguro: retorna o DataURL original para não quebrar a vitrine
  return dataUrl;
}

// ==============================================================================
// 2. PROCESSADOR DA FILA OUTBOX (MUTAÇÕES OFFLINE → NUVEM COM IDEMPOTÊNCIA)
// ==============================================================================

export async function processarOutbox() {
  if (!state.supabase || processandoFila) return;
  if (!navigator.onLine) {
    logSync('OUTBOX', 'Dispositivo offline. Fila aguardando restabelecimento de rede.');
    return;
  }

  const fila = [...state.syncQueue];
  if (fila.length === 0) return;

  processandoFila = true;
  logSync('OUTBOX', `Processando ${fila.length} mutação(ões) pendente(s)...`);

  let houveAlteracao = false;

  for (const job of fila) {
    let sucesso = false;
    job.status = 'processando';

    try {
      if (job.tipo === 'PRODUTO_UPSERT') {
        const prod = job.dados;
        if (prod) {
          // Se a imagem for base64 e estivermos online, tenta subir para Storage
          if (prod.imagem && prod.imagem.startsWith('data:image')) {
            const urlRemota = await sincronizarFotoStorage(prod.id, prod.imagem);
            if (urlRemota && urlRemota.startsWith('http')) {
              prod.imagem = urlRemota;
              // Atualiza também no state local
              const pLocal = state.produtos.find(p => p.id === prod.id);
              if (pLocal) pLocal.imagem = urlRemota;
              salvarLocal();
            }
          }

          // Sincroniza fotos de valores de variação para o Supabase Storage se estiverem em base64
          if (Array.isArray(prod.variacoes)) {
            for (const v of prod.variacoes) {
              if (v.fotos && typeof v.fotos === 'object') {
                for (const [valNome, valFoto] of Object.entries(v.fotos)) {
                  if (valFoto && valFoto.startsWith('data:image')) {
                    const safeVal = encodeURIComponent(valNome).replace(/%/g, '_');
                    const urlRemota = await sincronizarFotoStorage(`${prod.id}_val_${v.id}_${safeVal}`, valFoto);
                    if (urlRemota && urlRemota.startsWith('http')) {
                      v.fotos[valNome] = urlRemota;
                      salvarLocal();
                    }
                  }
                }
              }
            }
          }

          // Sincroniza fotos de combinações de variante se estiverem em base64
          if (Array.isArray(prod.variantes)) {
            for (const comb of prod.variantes) {
              if (comb.imagem && comb.imagem.startsWith('data:image')) {
                const urlRemota = await sincronizarFotoStorage(`${prod.id}_comb_${comb.id}`, comb.imagem);
                if (urlRemota && urlRemota.startsWith('http')) {
                  comb.imagem = urlRemota;
                  salvarLocal();
                }
              }
            }
          }

          const payload = {
            id: prod.id,
            nome: prod.nome,
            categoria: prod.categoria || 'Geral',
            subcategoria: prod.subcategoria || null,
            sku: prod.sku || null,
            codigo_barras: prod.codigo_barras || null,
            preco_custo: prod.preco_custo,
            preco_venda: prod.preco_venda,
            estoque_atual: prod.estoque_atual,
            estoque_minimo: prod.estoque_minimo,
            ativo: prod.ativo !== false,
            imagem: prod.imagem || null,
            foto_crop: prod.foto_crop || null,
            tem_variacoes: !!prod.tem_variacoes,
            variacoes: prod.variacoes || [],
            variantes: prod.variantes || [],
            updated_at: prod.updated_at || new Date().toISOString()
          };

          const { error } = await state.supabase.from('casa_produtos').upsert([payload]);
          if (!error) {
            sucesso = true;
          } else {
            logSync('ERROR', `Falha no upsert do produto ${prod.id}:`, error);
            // Fallback caso colunas novas ou imagem estejam indisponíveis (retrocompatibilidade)
            if (error.code === 'PGRST204' || (error.message && (error.message.includes('imagem') || error.message.includes('variantes') || error.message.includes('subcategoria') || error.message.includes('sku') || error.message.includes('codigo_barras')))) {
              const fallbackPayload = {
                id: prod.id,
                nome: prod.nome,
                categoria: prod.categoria || 'Geral',
                preco_custo: prod.preco_custo,
                preco_venda: prod.preco_venda,
                estoque_atual: prod.estoque_atual,
                estoque_minimo: prod.estoque_minimo,
                ativo: prod.ativo !== false,
                updated_at: prod.updated_at || new Date().toISOString()
              };
              if (prod.imagem && !error.message.includes('imagem')) fallbackPayload.imagem = prod.imagem;
              const { error: errRetry } = await state.supabase.from('casa_produtos').upsert([fallbackPayload]);
              sucesso = !errRetry;
            }
          }
        }
      } else if (job.tipo === 'PRODUTO_DELETE') {
        // Exclusão com RPC Transacional de Tombstone
        const { data, error } = await state.supabase.rpc('casa_excluir_produto_transacional', {
          p_operacao_id: job.operation_id,
          p_produto_id: job.id
        });

        if (!error && data?.sucesso) {
          sucesso = true;
        } else {
          // Fallback caso a RPC ainda não tenha sido executada no banco
          const { error: errDel } = await state.supabase.from('casa_produtos').delete().eq('id', job.id);
          sucesso = !errDel;
        }
      } else if (job.tipo === 'VENDA_TRANSACIONAL') {
        // VENDA ATÔMICA COM RPC TRANSACIONAL E LOCK FOR UPDATE (SUPORTA VARIANTES E SKU)
        const v = job.dados;
        const rpcParams = {
          p_operacao_id: job.operation_id,
          p_venda_id: v.id,
          p_produto_id: v.produto_id,
          p_qtd: v.quantidade,
          p_metodo_pagamento: v.metodo_pagamento || 'Pix',
          p_operador: v.operador || 'Operador',
          p_valor_unitario: v.valor_unitario,
          p_valor_total: v.valor_total,
          p_custo_total: v.custo_total,
          p_lucro_bruto: v.lucro_bruto,
          p_valor_reserva_30: v.valor_reserva_30,
          p_subcategoria: v.subcategoria || null,
          p_variante_id: v.variante_id || null,
          p_variacao_nome: v.variacao_nome || null,
          p_variacao_atributos: v.variacao_atributos || null,
          p_sku: v.sku || null
        };

        let { data, error } = await state.supabase.rpc('casa_registrar_venda_transacional', rpcParams);

        // Se der erro de assinatura não encontrada (PGRST202), tenta chamada legada
        if (error && error.code === 'PGRST202') {
          const legacyParams = {
            p_operacao_id: job.operation_id,
            p_venda_id: v.id,
            p_produto_id: v.produto_id,
            p_qtd: v.quantidade,
            p_metodo_pagamento: v.metodo_pagamento || 'Pix',
            p_operador: v.operador || 'Operador',
            p_valor_unitario: v.valor_unitario,
            p_valor_total: v.valor_total,
            p_custo_total: v.custo_total,
            p_lucro_bruto: v.lucro_bruto,
            p_valor_reserva_30: v.valor_reserva_30
          };
          const retryRes = await state.supabase.rpc('casa_registrar_venda_transacional', legacyParams);
          if (!retryRes.error && retryRes.data?.sucesso) {
            data = retryRes.data;
            error = null;
          } else if (retryRes.error && retryRes.error.code === 'PGRST202') {
            const { error: errFallback } = await state.supabase.from('casa_vendas').insert([v]);
            sucesso = !errFallback;
            if (sucesso) error = null;
          }
        }

        if (!error && data?.sucesso) {
          sucesso = true;
          logSync('OUTBOX', `Venda transacional ${v.id} aceita pelo banco. Novo estoque: ${data.novo_estoque}`);
        } else {
          logSync('ERROR', `Erro na venda transacional ${v.id}:`, error || data);
          // Se o erro foi estoque insuficiente no servidor
          if (error && error.message && error.message.includes('Estoque insuficiente')) {
            job.status = 'falha_definitiva';
            job.ultimo_erro = error.message;
            logSync('ERROR', `Venda ${v.id} rejeitada por estoque insuficiente no servidor.`);
            // Remove da fila para não travar o fluxo
            removerMutacaoDaFila(job.jobId);
            houveAlteracao = true;
            continue;
          }
        }
      } else if (job.tipo === 'ESTORNO_TRANSACIONAL') {
        // ESTORNO ATÔMICO COM RPC TRANSACIONAL
        const { data, error } = await state.supabase.rpc('casa_estornar_venda_transacional', {
          p_operacao_id: job.operation_id,
          p_venda_id: job.id,
          p_operador: job.dados?.operador || state.operador || 'Operador'
        });

        if (!error && data?.sucesso) {
          sucesso = true;
          logSync('OUTBOX', `Estorno ${job.id} concluído com sucesso no banco.`);
        } else {
          logSync('ERROR', `Erro no estorno transacional ${job.id}:`, error || data);
          if (error && (error.code === 'PGRST202' || error.message?.includes('casa_estornar_venda_transacional'))) {
            // Fallback se a RPC ainda não existe
            const { error: errDel } = await state.supabase.from('casa_vendas').delete().eq('id', job.id);
            sucesso = !errDel;
          }
        }
      } else if (job.tipo === 'VENDAS_CLEAR') {
        const { error } = await state.supabase.from('casa_vendas').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        sucesso = !error;
      } else if (job.tipo === 'CONFIG_UPSERT') {
        const { error } = await state.supabase.from('casa_configuracoes').upsert({
          chave: job.dados.chave,
          valor: job.dados.valor,
          updated_at: new Date().toISOString()
        });
        sucesso = !error;
      }

      if (sucesso) {
        logSync('OUTBOX', `Job ${job.jobId} (${job.tipo}) sincronizado com sucesso.`);
        removerMutacaoDaFila(job.jobId);
        houveAlteracao = true;
      } else {
        job.retentativas = (job.retentativas || 0) + 1;
        job.status = 'pendente';
        logSync('OUTBOX', `Job ${job.jobId} (${job.tipo}) falhou (tentativa ${job.retentativas}).`);
        salvarLocal();
        break; // Interrompe para manter ordem sequencial estrita
      }
    } catch (err) {
      logSync('ERROR', `Exceção ao processar job ${job.jobId}:`, err);
      job.retentativas = (job.retentativas || 0) + 1;
      job.status = 'pendente';
      salvarLocal();
      break;
    }
  }

  processandoFila = false;

  if (houveAlteracao && appRenderCallback) {
    appRenderCallback();
  }

  // Se restaram jobs na fila e estivermos online, agenda retry com backoff simples
  if (state.syncQueue.length > 0 && navigator.onLine) {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      processarOutbox();
    }, 6000);
  }
}

// ==============================================================================
// 3. ROTINA CENTRALIZADA DE RECONCILIAÇÃO COM O SERVIDOR
// ==============================================================================

/**
 * Executa a convergência definitiva entre o dispositivo local e o Supabase:
 * 1. Processa operações locais pendentes (Outbox).
 * 2. Consulta tombstones remotos para expurgar deleções.
 * 3. Reconcilia configurações, produtos e vendas sem ressuscitar zumbis.
 * 4. Respeita mutações locais pendentes e timestamps updated_at.
 */
export async function reconciliarComServidor() {
  if (!state.supabase) return;
  logSync('RECONCILE', 'Iniciando ciclo formal de reconciliação com o servidor...');

  try {
    // Passo 1: Descarrega fila Outbox
    await processarOutbox();

    // Passo 2: Reconciliação de Tombstones Remotos
    try {
      const { data: tombstones } = await state.supabase
        .from('casa_tombstones')
        .select('*');

      if (Array.isArray(tombstones) && tombstones.length > 0) {
        let removeuAlgum = false;
        tombstones.forEach(t => {
          adicionarTombstone(t.registro_id);
          if (t.entidade === 'produtos') {
            const antes = state.produtos.length;
            state.produtos = state.produtos.filter(p => p.id !== t.registro_id);
            if (state.produtos.length < antes) removeuAlgum = true;
          }
        });
        if (removeuAlgum) {
          logSync('RECONCILE', 'Produtos purgados via tombstones do servidor.');
          salvarLocal();
        }
      }
    } catch (e) {
      // Se tabela casa_tombstones ainda não existe, prossegue normalmente
    }

    // Passo 3: Reconciliação de Configurações
    const { data: configs } = await state.supabase.from('casa_configuracoes').select('*');
    if (Array.isArray(configs)) {
      configs.forEach(c => {
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
        } else if (c.chave === 'app_update_request' && c.valor) {
          if (novoReleaseCallback) {
            novoReleaseCallback(c.valor);
          }
        }
      });
      salvarLocal();
    }

    // Passo 4: Reconciliação de Produtos (com proteção contra sobrescrita e zumbis)
    const { data: prodsRemotos, error: errProds } = await state.supabase.from('casa_produtos').select('*');
    if (!errProds && Array.isArray(prodsRemotos)) {
      const mapaRemoto = new Map(prodsRemotos.map(p => [p.id, p]));

      // Produtos que estão na nuvem:
      const listaAtualizada = [];
      for (const pRemoto of prodsRemotos) {
        // Se este produto foi marcado com tombstone neste dispositivo, ignora
        if (ehTombstone(pRemoto.id)) continue;

        const localExistente = state.produtos.find(p => p.id === pRemoto.id);

        // Se há mutação pendente na Outbox para este produto, preserva a versão local!
        if (temMutacaoPendente('produtos', pRemoto.id) && localExistente) {
          listaAtualizada.push(localExistente);
          continue;
        }

        // Resolução de Conflito: Last-Write-Wins qualificado pelo updated_at do servidor
        if (localExistente) {
          const tLocal = new Date(localExistente.updated_at || 0).getTime();
          const tRemoto = new Date(pRemoto.updated_at || 0).getTime();

          if (tLocal > tRemoto) {
            listaAtualizada.push(localExistente);
            continue;
          }
        }

        // Tenta recuperar imagem do cache IndexedDB se remota for nula
        let fotoFinal = pRemoto.imagem || (localExistente ? localExistente.imagem : null);
        if (!fotoFinal) {
          fotoFinal = await obterImagemLocal(pRemoto.id);
        }

        listaAtualizada.push({
          ...pRemoto,
          imagem: fotoFinal
        });
      }

      // Produtos locais ausentes no servidor:
      // SÓ mantém se houver criação pendente na Outbox!
      const pendenciasCriacao = state.syncQueue.filter(j => j.tipo === 'PRODUTO_UPSERT' && j.entidade === 'produtos');
      const idsPendentes = new Set(pendenciasCriacao.map(j => j.id));
      const criadosOffline = state.produtos.filter(p => !mapaRemoto.has(p.id) && idsPendentes.has(p.id));

      state.produtos = [...criadosOffline, ...listaAtualizada];
      salvarLocal();
      logSync('RECONCILE', `Produtos convergidos: ${state.produtos.length} ativos.`);
    }

    // Passo 5: Reconciliação de Vendas (filtrando estornadas)
    const { data: salesRemotas, error: errSales } = await state.supabase
      .from('casa_vendas')
      .select('*')
      .order('created_at', { ascending: false });

    if (!errSales && Array.isArray(salesRemotas)) {
      const mapaVendasRemotas = new Map(salesRemotas.map(s => [s.id, s]));

      // Vendas ativas no servidor (descarta estornadas)
      const vendasAtivasRemotas = salesRemotas.filter(s => s.estornada !== true);

      // Vendas locais criadas offline ainda não confirmadas
      const pendenciasVendas = state.syncQueue.filter(j => j.tipo === 'VENDA_TRANSACIONAL');
      const idsVendasPendentes = new Set(pendenciasVendas.map(j => j.id));
      const vendasCriadasOffline = state.vendas.filter(v => !mapaVendasRemotas.has(v.id) && idsVendasPendentes.has(v.id));

      state.vendas = [...vendasCriadasOffline, ...vendasAtivasRemotas];
      state.vendas.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      salvarLocal();
      logSync('RECONCILE', `Vendas convergidas: ${state.vendas.length} no histórico.`);
    }

    // Passo 6: Rerenderiza a interface com os dados reconciliados
    if (appRenderCallback) {
      appRenderCallback();
    }

    logSync('RECONCILE', 'Ciclo de reconciliação finalizado com sucesso.');
  } catch (err) {
    logSync('ERROR', 'Exceção durante reconciliação com o servidor:', err);
  }
}

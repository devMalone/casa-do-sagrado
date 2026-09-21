// js/version.js — Fonte Única da Verdade para Versionamento do Frontend
// Versão Atual: v24.3 (Build: 20260921-075600)

export const APP_VERSION = '24.3';
export const BUILD_ID = '20260921-075600';
export const DB_SCHEMA_VERSION = 24;
export const CACHE_NAME = 'casa-sagrado-v24.3';

/**
 * Retorna as informações completas de versão e release da aplicação local instalada.
 */
export function obterInfoVersaoLocal() {
  return {
    version: APP_VERSION,
    buildId: BUILD_ID,
    dbSchemaVersion: DB_SCHEMA_VERSION,
    cacheName: CACHE_NAME
  };
}

/**
 * Compara semanticamente duas versões de software (ex: "23.4" vs "23.10" ou "23.3.1").
 * Retorna:
 *   1 se v1 for maior que v2 (v1 > v2)
 *  -1 se v1 for menor que v2 (v1 < v2)
 *   0 se v1 for igual a v2 (v1 === v2)
 */
export function compararVersoesSemanticas(v1, v2) {
  if (!v1 && !v2) return 0;
  if (!v1) return -1;
  if (!v2) return 1;

  const limpar = (v) => v.toString().replace(/^v/i, '').trim();
  const partes1 = limpar(v1).split('.').map(p => parseInt(p, 10) || 0);
  const partes2 = limpar(v2).split('.').map(p => parseInt(p, 10) || 0);
  const maxLen = Math.max(partes1.length, partes2.length);

  for (let i = 0; i < maxLen; i++) {
    const num1 = partes1[i] || 0;
    const num2 = partes2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * Consulta a autoridade máxima de versão: o SERVIDOR / DEPLOY real.
 * Bypassa qualquer cache local com cache: 'no-store' e timestamp dinâmico.
 * @returns {Promise<{ version: string, build_id: string, published_at: string } | null>}
 */
export async function consultarVersaoServidor() {
  if (!navigator.onLine) {
    return null;
  }

  try {
    const url = `./version.json?_t=${Date.now()}`;
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache'
      }
    });

    if (!res.ok) {
      console.warn('[UPDATE] Falha ao consultar version.json do servidor (status ' + res.status + ')');
      return null;
    }

    const data = await res.json();
    if (data && data.version) {
      return {
        version: data.version.toString().replace(/^v/i, '').trim(),
        build_id: data.build_id || '',
        published_at: data.published_at || ''
      };
    }
    return null;
  } catch (err) {
    console.warn('[UPDATE] Erro ao buscar version.json do servidor:', err);
    return null;
  }
}

/**
 * Obtém o último request_id de pedido global processado por este terminal.
 */
export function obterUltimoRequestIdProcessado() {
  return localStorage.getItem('casa_last_processed_update_request_id') || null;
}

/**
 * Registra o request_id que já foi devidamente processado por este terminal.
 */
export function salvarUltimoRequestIdProcessado(requestId) {
  if (requestId) {
    localStorage.setItem('casa_last_processed_update_request_id', requestId);
  }
}



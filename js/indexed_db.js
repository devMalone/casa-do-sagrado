// js/indexed_db.js — Camada de Armazenamento Local Robusto (IndexedDB)
// Versão: v22.0
// Finalidade: Armazenamento local de alta capacidade para Blobs/DataURLs de fotos de produtos
// e espelhamento resiliente da fila Outbox, evitando estourar a cota de 5MB do LocalStorage no iOS Safari.

const DB_NAME = 'casa_sagrado_db';
const DB_VERSION = 2;
const STORE_IMAGENS = 'imagens';
const STORE_ORIGINAIS = 'imagens_originais';
const STORE_OUTBOX = 'outbox_backup';

let dbPromise = null;

/**
 * Inicializa a conexão com o banco IndexedDB de forma segura e defensiva.
 * Retorna null em caso de ambiente sem suporte ou bloqueado (ex: modo anônimo restrito).
 */
export function obterConexaoIndexedDB() {
  if (dbPromise) return dbPromise;

  if (typeof window === 'undefined' || !window.indexedDB) {
    console.warn('[IndexedDB] API IndexedDB não suportada neste ambiente.');
    return Promise.resolve(null);
  }

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_IMAGENS)) {
          db.createObjectStore(STORE_IMAGENS, { keyPath: 'produto_id' });
        }
        if (!db.objectStoreNames.contains(STORE_ORIGINAIS)) {
          db.createObjectStore(STORE_ORIGINAIS, { keyPath: 'produto_id' });
        }
        if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
          db.createObjectStore(STORE_OUTBOX, { keyPath: 'jobId' });
        }
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onerror = (event) => {
        console.warn('[IndexedDB] Erro ao abrir banco local:', event.target.error);
        resolve(null);
      };

      request.onblocked = () => {
        console.warn('[IndexedDB] Abertura de banco bloqueada por outra aba.');
        resolve(null);
      };
    } catch (err) {
      console.warn('[IndexedDB] Falha ao inicializar IndexedDB:', err);
      resolve(null);
    }
  });

  return dbPromise;
}

// --- REPOSITÓRIO DE FOTOGRAFIAS LOCAL (CACHE OFFLINE DE IMAGENS) ---

/**
 * Salva a imagem de um produto no IndexedDB.
 * @param {string} produtoId - UUID do produto
 * @param {string} dataUrl - Data URL Base64 ou Blob
 */
export async function salvarImagemLocal(produtoId, dataUrl) {
  if (!produtoId || !dataUrl) return false;
  try {
    const db = await obterConexaoIndexedDB();
    if (!db) return false;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_IMAGENS, 'readwrite');
      const store = tx.objectStore(STORE_IMAGENS);
      const req = store.put({
        produto_id: produtoId,
        data: dataUrl,
        atualizado_em: new Date().toISOString()
      });

      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn('[IndexedDB] Falha ao gravar imagem local:', err);
    return false;
  }
}

/**
 * Recupera a imagem de um produto armazenada no IndexedDB.
 * @param {string} produtoId
 * @returns {Promise<string|null>}
 */
export async function obterImagemLocal(produtoId) {
  if (!produtoId) return null;
  try {
    const db = await obterConexaoIndexedDB();
    if (!db) return null;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_IMAGENS, 'readonly');
      const store = tx.objectStore(STORE_IMAGENS);
      const req = store.get(produtoId);

      req.onsuccess = (e) => {
        const item = e.target.result;
        resolve(item ? item.data : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}

/**
 * Remove a imagem de um produto do IndexedDB.
 * @param {string} produtoId
 */
export async function removerImagemLocal(produtoId) {
  if (!produtoId) return false;
  try {
    const db = await obterConexaoIndexedDB();
    if (!db) return false;

    // Remove do cache de fotos da vitrine e do repositório de fotos originais
    removerImagemOriginal(produtoId).catch(() => {});

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_IMAGENS, 'readwrite');
      const store = tx.objectStore(STORE_IMAGENS);
      const req = store.delete(produtoId);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch (err) {
    return false;
  }
}

// --- REPOSITÓRIO DE FOTOGRAFIAS ORIGINAIS (ALTA DEFINIÇÃO PARA REENQUADRAMENTO) ---

/**
 * Salva a imagem original sem cortes para permitir reedição sem perda sucessiva de qualidade.
 * @param {string} produtoId
 * @param {string} dataUrl
 */
export async function salvarImagemOriginal(produtoId, dataUrl) {
  if (!produtoId || !dataUrl) return false;
  try {
    const db = await obterConexaoIndexedDB();
    if (!db) return false;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_ORIGINAIS, 'readwrite');
      const store = tx.objectStore(STORE_ORIGINAIS);
      const req = store.put({
        produto_id: produtoId,
        data: dataUrl,
        atualizado_em: new Date().toISOString()
      });

      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn('[IndexedDB] Falha ao gravar imagem original:', err);
    return false;
  }
}

/**
 * Recupera a imagem original de um produto para reenquadramento.
 * @param {string} produtoId
 * @returns {Promise<string|null>}
 */
export async function obterImagemOriginal(produtoId) {
  if (!produtoId) return null;
  try {
    const db = await obterConexaoIndexedDB();
    if (!db) return null;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_ORIGINAIS, 'readonly');
      const store = tx.objectStore(STORE_ORIGINAIS);
      const req = store.get(produtoId);

      req.onsuccess = (e) => {
        const item = e.target.result;
        resolve(item ? item.data : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}

/**
 * Remove a foto original do produto.
 * @param {string} produtoId
 */
export async function removerImagemOriginal(produtoId) {
  if (!produtoId) return false;
  try {
    const db = await obterConexaoIndexedDB();
    if (!db) return false;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_ORIGINAIS, 'readwrite');
      const store = tx.objectStore(STORE_ORIGINAIS);
      const req = store.delete(produtoId);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch (err) {
    return false;
  }
}

// --- ESPELHO RESILIENTE DA OUTBOX ---

/**
 * Persiste uma cópia da fila Outbox no IndexedDB para sobrevivência a fechamento severo do app.
 * @param {Array} jobs
 */
export async function persistirOutboxIndexedDB(jobs) {
  if (!Array.isArray(jobs)) return false;
  try {
    const db = await obterConexaoIndexedDB();
    if (!db) return false;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORE_OUTBOX);
      store.clear();
      jobs.forEach(j => store.put(j));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (err) {
    return false;
  }
}

/**
 * Carrega a fila Outbox persistida no IndexedDB.
 * @returns {Promise<Array>}
 */
export async function carregarOutboxIndexedDB() {
  try {
    const db = await obterConexaoIndexedDB();
    if (!db) return [];

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_OUTBOX, 'readonly');
      const store = tx.objectStore(STORE_OUTBOX);
      const req = store.getAll();
      req.onsuccess = (e) => resolve(Array.isArray(e.target.result) ? e.target.result : []);
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    return [];
  }
}

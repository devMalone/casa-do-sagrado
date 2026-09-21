import { state } from './state.js';
import { APP_VERSION, BUILD_ID, DB_SCHEMA_VERSION, CACHE_NAME, compararVersoesSemanticas, consultarVersaoServidor } from './version.js';

export function aplicarMascaraMoeda(input) {
  let digits = input.value.replace(/\D/g, '');
  if (!digits) { input.value = ''; return; }
  let cents = parseInt(digits, 10);
  let val = (cents / 100).toFixed(2);
  let parts = val.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  input.value = parts.join(',');
}

export function parseMonetaryValue(str) {
  if (!str) return 0;
  if (typeof str === 'number') return isNaN(str) ? 0 : str;
  const cleaned = str.toString().replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : Math.round(val * 100) / 100;
}

export function formatarMoedaExibicao(val) {
  const n = typeof val === 'number' ? val : parseFloat(val) || 0;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function abrirModal(modalId) {
  const m = document.getElementById(modalId);
  if (!m) return;
  m.classList.add('active');
  state.modalStack.push(modalId);
  history.pushState({ modal: modalId }, '');
  if (window.lucide) window.lucide.createIcons();
}

export function fecharModalAtual() {
  if (state.modalStack.length > 0) {
    const modalId = state.modalStack.pop();
    document.getElementById(modalId)?.classList.remove('active');
  }
}

export function mostrarToast(msg) {
  const toast = document.getElementById('appToast');
  if (!toast) return;
  document.getElementById('toastMsg').innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

export function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

export async function forcarAtualizacaoLocal(mostrarAviso = true) {
  if (!navigator.onLine) {
    if (mostrarAviso) {
      mostrarToast('Sem conexão com a internet. Não foi possível verificar atualizações.');
    }
    return false;
  }

  if (mostrarAviso) {
    mostrarToast('Consultando versão oficial no servidor...');
  }

  // 1. Consulta o SERVIDOR como autoridade máxima (version.json sem cache)
  const servidor = await consultarVersaoServidor();
  if (servidor && servidor.version) {
    const comp = compararVersoesSemanticas(servidor.version, APP_VERSION);

    // Proteção absoluta contra downgrade
    if (comp < 0) {
      console.warn(`[UPDATE] Versão do servidor (v${servidor.version}) é inferior à versão instalada (v${APP_VERSION}). Downgrade automático bloqueado.`);
      if (mostrarAviso) {
        mostrarToast(`Versão do servidor (v${servidor.version}) é anterior à deste terminal (v${APP_VERSION}). Downgrade bloqueado.`);
      }
      return false;
    }

    // Se já estiver na versão mais recente
    if (comp === 0 && (!servidor.build_id || servidor.build_id === BUILD_ID)) {
      console.log(`[UPDATE] Terminal já está executando a versão mais recente do servidor (v${APP_VERSION}, Build: ${BUILD_ID}).`);
      if (mostrarAviso) {
        mostrarToast(`Este terminal já está executando a versão mais recente do servidor (v${APP_VERSION}).`);
      }
      return false;
    }

    console.log(`[UPDATE] Nova versão detectada no servidor: v${servidor.version} (Build: ${servidor.build_id}). Instalada: v${APP_VERSION}.`);
    if (mostrarAviso) {
      mostrarToast(`Nova versão v${servidor.version} encontrada no servidor! Baixando e instalando...`);
    }
  }

  if (!('serviceWorker' in navigator)) {
    if (mostrarAviso) mostrarToast('Atualizando aplicação...');
    setTimeout(() => window.location.reload(), 500);
    return true;
  }

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      // Se não há SW registrado, registra e recarrega de forma limpa
      await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
      if (mostrarAviso) mostrarToast('Registrando nova versão...');
      setTimeout(() => window.location.reload(), 500);
      return true;
    }

    let atualizacaoEncontrada = false;

    const ativarWorker = (worker) => {
      if (!worker) return;
      atualizacaoEncontrada = true;
      if (mostrarAviso) {
        mostrarToast('Nova versão encontrada! Instalando e ativando...');
      }
      worker.postMessage({ type: 'SKIP_WAITING' });
    };

    // 1. Verifica se já existe um worker aguardando ativação (waiting)
    if (reg.waiting) {
      ativarWorker(reg.waiting);
      return true;
    }

    // 2. Monitora caso já esteja em processo de instalação
    if (reg.installing) {
      atualizacaoEncontrada = true;
      if (mostrarAviso) mostrarToast('Instalando nova versão...');
      reg.installing.addEventListener('statechange', (e) => {
        if (e.target.state === 'installed') {
          ativarWorker(e.target);
        }
      });
    }

    // 3. Ouve o evento updatefound durante o update()
    reg.addEventListener('updatefound', () => {
      atualizacaoEncontrada = true;
      const novoWorker = reg.installing;
      if (novoWorker) {
        if (mostrarAviso) mostrarToast('Baixando nova versão...');
        novoWorker.addEventListener('statechange', () => {
          if (novoWorker.state === 'installed') {
            ativarWorker(novoWorker);
          }
        });
      }
    }, { once: true });

    // 4. Força checagem na rede contra sw.js
    await reg.update();

    // 5. Aguarda brevemente para confirmar se um novo worker assumiu
    await new Promise(resolve => setTimeout(resolve, 1800));

    if (!atualizacaoEncontrada && !reg.waiting && !reg.installing) {
      if (mostrarAviso) {
        mostrarToast(`Este terminal já está executando a versão mais recente do servidor (v${APP_VERSION}).`);
      }
      return false;
    }

    return true;
  } catch (err) {
    console.error('[UPDATE] Erro ao verificar atualização do Service Worker:', err);
    if (mostrarAviso) {
      mostrarToast('Não foi possível verificar atualizações no momento.');
    }
    return false;
  }
}

export function pedirConfirmacao({ titulo = 'Confirmação', mensagem = 'Deseja continuar?', textoConfirmar = 'Confirmar', perigo = true } = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modalConfirmacao');
    if (!modal) {
      resolve(window.confirm(mensagem));
      return;
    }

    const elTitulo = document.getElementById('confirmModalTitulo');
    const elMsg = document.getElementById('confirmModalMsg');
    const btnSim = document.getElementById('btnConfirmModalSim');
    const btnNao = document.getElementById('btnConfirmModalNao');
    const btnX = document.getElementById('btnConfirmModalX');

    if (elTitulo) elTitulo.innerText = titulo;
    if (elMsg) elMsg.innerText = mensagem;
    if (btnSim) {
      btnSim.innerText = textoConfirmar;
      btnSim.className = perigo ? 'btn-danger' : 'btn-main';
    }

    let finalizado = false;

    const responder = (resultado) => {
      if (finalizado) return;
      finalizado = true;

      // Desvincula handlers para evitar vazamento ou duplicação
      if (btnSim) btnSim.onclick = null;
      if (btnNao) btnNao.onclick = null;
      if (btnX) btnX.onclick = null;
      if (modal) modal.onclick = null;

      // Fecha o modal e sincroniza pilha de modais
      modal.classList.remove('active');
      const idx = state.modalStack.lastIndexOf('modalConfirmacao');
      if (idx !== -1) {
        state.modalStack.splice(idx, 1);
      }

      resolve(resultado);
    };

    if (btnSim) {
      btnSim.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        responder(true);
      };
    }

    if (btnNao) {
      btnNao.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        responder(false);
      };
    }

    if (btnX) {
      btnX.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        responder(false);
      };
    }

    modal.onclick = (e) => {
      if (e.target === modal) {
        responder(false);
      }
    };

    abrirModal('modalConfirmacao');
  });
}

/**
 * Resolve a imagem final a ser exibida para um produto considerando a hierarquia estrita:
 * 1. Imagem específica da combinação da variante (se definida)
 * 2. Imagem associada ao valor da variação (ex: Cor: "Branca")
 * 3. Imagem principal do produto
 * 4. Placeholder padrão (null)
 *
 * @param {Object} produto - Objeto do produto
 * @param {Object|string} [varianteOuAtributos] - Objeto da variante { id, combinacao, imagem }, ID da variante ou dicionário de atributos { Cor: 'Branca' }
 * @returns {string|null} URL ou DataURL da imagem resolvida
 */
export function obterImagemProdutoResolvida(produto, varianteOuAtributos = null) {
  if (!produto) return null;

  let varianteObj = null;
  let atributos = null;

  if (varianteOuAtributos) {
    if (typeof varianteOuAtributos === 'string') {
      if (produto.variantes && Array.isArray(produto.variantes)) {
        varianteObj = produto.variantes.find(v => v.id === varianteOuAtributos) || null;
        if (varianteObj) atributos = varianteObj.combinacao || null;
      }
    } else if (typeof varianteOuAtributos === 'object') {
      if (varianteOuAtributos.combinacao) {
        varianteObj = varianteOuAtributos;
        atributos = varianteOuAtributos.combinacao;
      } else {
        atributos = varianteOuAtributos;
        if (varianteOuAtributos.imagem) {
          varianteObj = varianteOuAtributos;
        }
      }
    }
  }

  // 1. Prioridade Máxima: Foto específica da combinação/variante
  if (varianteObj && varianteObj.imagem && typeof varianteObj.imagem === 'string' && varianteObj.imagem.trim()) {
    return varianteObj.imagem;
  }

  // 2. Segunda Prioridade: Foto associada ao valor da variação visual (ex: Cor: Branca)
  if (produto.tem_variacoes && Array.isArray(produto.variacoes) && atributos) {
    for (const varObj of produto.variacoes) {
      if (!varObj || !varObj.nome || !varObj.fotos) continue;
      const valSelecionado = atributos[varObj.nome];
      if (valSelecionado && varObj.fotos[valSelecionado] && typeof varObj.fotos[valSelecionado] === 'string' && varObj.fotos[valSelecionado].trim()) {
        return varObj.fotos[valSelecionado];
      }
    }
  }

  // 3. Terceira Prioridade: Foto principal do produto
  if (produto.imagem && typeof produto.imagem === 'string' && produto.imagem.trim()) {
    return produto.imagem;
  }

  // 4. Fallback: null (para a tela renderizar ícone ou placeholder padrão)
  return null;
}

/**
 * Normaliza uma string de SKU: remove espaços, converte para maiúsculas e remove caracteres especiais
 * @param {string} sku 
 * @returns {string}
 */
export function normalizarSku(sku) {
  if (!sku) return '';
  return sku
    .toString()
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9_-]/g, '');
}

/**
 * Gera um prefixo legível de 3 letras baseado no texto (categoria ou nome)
 * @param {string} texto 
 * @returns {string}
 */
export function gerarPrefixoSku(texto) {
  if (!texto) return 'ART';
  const limpo = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase();
  if (!limpo) return 'ART';
  if (limpo.length < 3) return limpo.padEnd(3, 'X');
  return limpo.substring(0, 3);
}

/**
 * Gera automaticamente um SKU único para um produto com base na categoria/nome e no estado atual
 * @param {string} nome 
 * @param {string} categoria 
 * @param {string|null} produtoIdAtual 
 * @returns {string} Ex: "VEL-000101"
 */
export function gerarSkuAutomaticoProduto(nome = '', categoria = '', produtoIdAtual = null) {
  const prefixo = gerarPrefixoSku(categoria || nome || 'ART');
  
  // Coletar todos os números sequenciais já usados no sistema para evitar colisões
  let maiorSeq = 100;
  const produtos = state.produtos || [];
  
  produtos.forEach(p => {
    if (p.sku) {
      const match = p.sku.match(/-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maiorSeq) maiorSeq = num;
      }
    }
    if (p.tem_variacoes && Array.isArray(p.variantes)) {
      p.variantes.forEach(v => {
        if (v.sku) {
          const matchVar = v.sku.match(/(\d+)/g);
          if (matchVar && matchVar.length > 0) {
            const num = parseInt(matchVar[matchVar.length - 1], 10);
            if (!isNaN(num) && num > maiorSeq && num < 900000) maiorSeq = num;
          }
        }
      });
    }
  });

  let tentativaSeq = maiorSeq + 1;
  let skuGerado = `${prefixo}-${String(tentativaSeq).padStart(6, '0')}`;

  // Garantir que não colide com nada existente no namespace global
  while (!validarUnicidadeSku(skuGerado, produtoIdAtual).valido) {
    tentativaSeq++;
    skuGerado = `${prefixo}-${String(tentativaSeq).padStart(6, '0')}`;
  }

  return skuGerado;
}

/**
 * Gera um SKU específico para uma variante vendável derivado do SKU base do produto
 * @param {string} skuBase Ex: "VEL-000101"
 * @param {Object} combinacao Ex: { "Cor": "Branca", "Tamanho": "18 cm" }
 * @param {number} index Índice numérico de fallback
 * @returns {string} Ex: "VEL-000101-BRA-18" ou "VEL-000101-01"
 */
export function gerarSkuVariante(skuBase, combinacao = {}, index = 0) {
  const base = normalizarSku(skuBase) || 'ART-000001';
  let sufixos = [];

  if (combinacao && typeof combinacao === 'object') {
    Object.values(combinacao).forEach(val => {
      if (val) {
        const limpo = val.toString()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-zA-Z0-9]/g, '')
          .toUpperCase();
        if (limpo) {
          sufixos.push(limpo.substring(0, 3));
        }
      }
    });
  }

  let sufixoStr = sufixos.join('-');
  if (!sufixoStr) {
    sufixoStr = String(index + 1).padStart(2, '0');
  }

  return `${base}-${sufixoStr}`;
}

/**
 * Valida a unicidade de um SKU no namespace global da loja (produtos e variantes)
 * @param {string} sku SKU a validar
 * @param {string|null} produtoIdAtual ID do produto em edição (para permitir manter seu próprio SKU)
 * @param {string|null} varianteIdAtual ID da variante em edição (para permitir manter seu próprio SKU)
 * @returns {{ valido: boolean, erro?: string }}
 */
export function validarUnicidadeSku(sku, produtoIdAtual = null, varianteIdAtual = null) {
  const normalizado = normalizarSku(sku);
  if (!normalizado) {
    return { valido: false, erro: 'O SKU não pode ser vazio.' };
  }

  if (normalizado.length < 2 || normalizado.length > 40) {
    return { valido: false, erro: 'O SKU deve ter entre 2 e 40 caracteres.' };
  }

  const produtos = state.produtos || [];

  for (const p of produtos) {
    // 1. Checa contra SKU base do produto
    if (p.sku && normalizarSku(p.sku) === normalizado) {
      if (p.id !== produtoIdAtual) {
        return { valido: false, erro: `SKU "${normalizado}" já está em uso pelo produto "${p.nome}".` };
      }
    }

    // 2. Checa contra SKUs das variantes do produto
    if (p.tem_variacoes && Array.isArray(p.variantes)) {
      for (const v of p.variantes) {
        if (v.sku && normalizarSku(v.sku) === normalizado) {
          // Se for a mesma variante do mesmo produto sendo editada, permite
          const ehMesmaVariante = (p.id === produtoIdAtual && v.id === varianteIdAtual);
          if (!ehMesmaVariante) {
            const rotulo = v.combinacao ? Object.values(v.combinacao).join(' / ') : (v.id || 'variante');
            return { valido: false, erro: `SKU "${normalizado}" já está em uso pela variante "${rotulo}" do produto "${p.nome}".` };
          }
        }
      }
    }
  }

  return { valido: true };
}


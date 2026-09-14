// js/utils.js — Funções Utilitárias Defensivas e Controle de UI

import { state } from './state.js';

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
  if (mostrarAviso) {
    mostrarToast('Limpando cache e forçando atualização...');
  }

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    }

    if ('caches' in window) {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        await caches.delete(name);
      }
    }
  } catch (err) {
    console.warn('[Cache Purge] Erro ao limpar:', err);
  }

  setTimeout(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('reload', Date.now().toString());
    window.location.replace(url.toString());
  }, 400);
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


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

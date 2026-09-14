// js/app.js — Orquestrador Principal do Aplicativo (PWA)

import { state, carregarDadosLocais, salvarLocal } from './state.js';
import { abrirModal, fecharModalAtual, mostrarToast, refreshIcons, aplicarMascaraMoeda } from './utils.js';
import { iniciarSupabaseSeConfigurado, salvarConfigSupabase, exportarBackupJSON, setAppRenderCallback } from './supabase.js';
import { renderizarCategoriasUI, adicionarCategoria, abrirModalCategorias, setOnCategoriaAlteradaCallback } from './categorias.js';
import { renderizarEstoque, filtrarProdutos, abrirModalProduto, salvarProduto, setOnQuickSellCallback } from './estoque.js';
import { iniciarVendaRapida, ajustarQtdVenda, selecionarMetodoPgto, confirmarVendaFinal, renderizarHistoricoVendas, setOnVendaRealizadaCallback } from './vendas.js';
import { renderizarDashboard, abrirModalConfigReserva, salvarConfigReserva } from './dashboard.js';
import { recalcularMarkup, copiarPrecoParaNovoProduto } from './markup.js';

// --- CICLO DE VIDA E INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
  carregarDadosLocais();
  configurarCallbacks();
  vincularEventosGlobais();
  verificarOperadorOnboarding();
  iniciarSupabaseSeConfigurado();
  renderizarTudo();

  // Registro do Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Android Back Button (PWA)
  window.addEventListener('popstate', () => {
    if (state.modalStack.length > 0) {
      const modalId = state.modalStack.pop();
      document.getElementById(modalId)?.classList.remove('active');
    }
  });
});

function configurarCallbacks() {
  setAppRenderCallback(renderizarTudo);
  setOnCategoriaAlteradaCallback(renderizarEstoque);
  setOnQuickSellCallback(iniciarVendaRapida);
  setOnVendaRealizadaCallback(renderizarTudo);
}

function renderizarTudo() {
  renderizarCategoriasUI();
  renderizarEstoque();
  renderizarDashboard();
  renderizarHistoricoVendas();
  refreshIcons();
}

// --- CONTROLE DE OPERADOR ---
function verificarOperadorOnboarding() {
  if (!state.operador) {
    abrirModal('modalOnboarding');
  } else {
    atualizarBadgeOperador(state.operador);
  }
}

function atualizarBadgeOperador(nome) {
  const lbl = document.getElementById('labelOperador');
  const avt = document.getElementById('avatarInitial');
  if (lbl) lbl.innerText = nome;
  if (avt) avt.innerText = nome.charAt(0).toUpperCase();
}

function confirmarOperadorDigitado() {
  const input = document.getElementById('inputOutroOperador');
  const nome = input ? input.value.trim() : '';
  if (!nome) {
    mostrarToast('Por favor, digite seu nome para continuar.');
    return;
  }
  state.operador = nome;
  localStorage.setItem('casa_operador', nome);
  atualizarBadgeOperador(nome);
  fecharModalAtual();
  mostrarToast(`Operando como ${nome}`);
  renderizarDashboard();
}

// --- NAVEGAÇÃO ENTRE ABAS ---
function mudarAba(abaId, btn) {
  document.querySelectorAll('.tab-view').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const tab = document.getElementById(`tab-${abaId}`);
  if (tab) tab.classList.add('active');
  if (btn) btn.classList.add('active');

  const fab = document.getElementById('fabAddProduct');
  if (fab) {
    fab.style.display = abaId === 'estoque' ? 'flex' : 'none';
  }

  if (abaId === 'dashboard') renderizarDashboard();
  if (abaId === 'vendas') renderizarHistoricoVendas();
  refreshIcons();
}

// --- VINCULAÇÃO DE EVENTOS DE INTERFACE ---
function vincularEventosGlobais() {
  // Operador
  document.getElementById('btnOperadorAtual')?.addEventListener('click', () => abrirModal('modalOnboarding'));
  document.getElementById('btnSalvarOperador')?.addEventListener('click', confirmarOperadorDigitado);

  // Nuvem / Supabase
  document.getElementById('btnAbrirSync')?.addEventListener('click', () => abrirModal('modalSync'));
  document.getElementById('btnSalvarSupabase')?.addEventListener('click', salvarConfigSupabase);
  document.getElementById('btnExportarBackup')?.addEventListener('click', exportarBackupJSON);

  // Categorias
  document.getElementById('btnGerenciarCategorias')?.addEventListener('click', abrirModalCategorias);
  document.getElementById('btnAdicionarCategoria')?.addEventListener('click', adicionarCategoria);
  document.getElementById('inputNovaCategoria')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') adicionarCategoria();
  });

  // Produtos & Estoque
  document.getElementById('searchInput')?.addEventListener('input', filtrarProdutos);
  document.getElementById('fabAddProduct')?.addEventListener('click', abrirModalProduto);
  document.getElementById('btnSalvarProduto')?.addEventListener('click', salvarProduto);

  // Vendas
  document.getElementById('btnVendaQtdMenos')?.addEventListener('click', () => ajustarQtdVenda(-1));
  document.getElementById('btnVendaQtdMais')?.addEventListener('click', () => ajustarQtdVenda(1));
  document.getElementById('btnConfirmarVenda')?.addEventListener('click', confirmarVendaFinal);
  document.querySelectorAll('.payment-methods .pay-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      selecionarMetodoPgto(this.getAttribute('data-method'), this);
    });
  });

  // Fundo de Reserva
  document.getElementById('btnAbrirConfigReserva')?.addEventListener('click', abrirModalConfigReserva);
  document.getElementById('btnSalvarConfigReserva')?.addEventListener('click', salvarConfigReserva);

  // Markup
  const calcCusto = document.getElementById('calcCusto');
  const calcTaxa = document.getElementById('calcTaxa');
  const calcMargem = document.getElementById('calcMargem');
  calcCusto?.addEventListener('input', function() {
    aplicarMascaraMoeda(this);
    recalcularMarkup();
  });
  calcTaxa?.addEventListener('input', recalcularMarkup);
  calcMargem?.addEventListener('input', recalcularMarkup);
  document.getElementById('btnCopiarMarkupParaProduto')?.addEventListener('click', copiarPrecoParaNovoProduto);

  // Navegação
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      mudarAba(this.getAttribute('data-tab'), this);
    });
  });

  // Fechar modais com botão X
  document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', fecharModalAtual);
  });
}

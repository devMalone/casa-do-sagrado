// js/app.js — Orquestrador Principal do Aplicativo (PWA)

import { state, carregarDadosLocais, salvarLocal } from './state.js';
import { abrirModal, fecharModalAtual, mostrarToast, refreshIcons, aplicarMascaraMoeda, forcarAtualizacaoLocal } from './utils.js';
import { iniciarSupabaseSeConfigurado, alternarConexaoSupabase, exportarBackupJSON, exportarRelatorioCSV, setAppRenderCallback, lancarAtualizacaoGeral } from './supabase.js';
import { renderizarCategoriasUI, adicionarCategoria, abrirModalCategorias, setOnCategoriaAlteradaCallback } from './categorias.js';
import { renderizarEstoque, filtrarProdutos, abrirModalProduto, salvarProduto, setOnQuickSellCallback, excluirProdutoAtual, setOnProdutoAlteradoCallback } from './estoque.js';
import { iniciarVendaRapida, ajustarQtdVenda, selecionarMetodoPgto, confirmarVendaFinal, renderizarHistoricoVendas, setOnVendaRealizadaCallback, limparTodoHistoricoVendas } from './vendas.js';
import { renderizarDashboard, abrirModalConfigReserva, salvarConfigReserva, abrirModalConfigEquilibrio, adicionarItemCustoFixo, atualizarDiasUteisMes } from './dashboard.js';
import { recalcularMarkup, copiarPrecoParaNovoProduto } from './markup.js';
import { renderizarCurvaABC, alternarSubAbaFerramentas } from './curva_abc.js';

// --- CICLO DE VIDA E INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
  // Previne restauração automática de scroll travado pelo navegador
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }

  // Remove eventuais parâmetros de query legados (ex: ?v=...) para restaurar o escopo limpo do PWA
  if (window.location.search) {
    window.history.replaceState({}, '', window.location.pathname);
  }

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

  // Captura do evento de Instalação do PWA
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btnInstall = document.getElementById('btnInstalarApp');
    const btnInstallModal = document.getElementById('btnInstalarAppModal');
    if (btnInstall) btnInstall.style.display = 'flex';
    if (btnInstallModal) btnInstallModal.style.display = 'flex';
    refreshIcons();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const btnInstall = document.getElementById('btnInstalarApp');
    const btnInstallModal = document.getElementById('btnInstalarAppModal');
    if (btnInstall) btnInstall.style.display = 'none';
    if (btnInstallModal) btnInstallModal.style.display = 'none';
    mostrarToast('Casa do Sagrado instalada com sucesso!');
  });

  // Android Back Button (PWA)
  window.addEventListener('popstate', () => {
    if (state.modalStack.length > 0) {
      const modalId = state.modalStack.pop();
      document.getElementById(modalId)?.classList.remove('active');
    }
  });
});

let deferredInstallPrompt = null;

function configurarCallbacks() {
  setAppRenderCallback(renderizarTudo);
  setOnCategoriaAlteradaCallback(renderizarEstoque);
  setOnQuickSellCallback(iniciarVendaRapida);
  setOnVendaRealizadaCallback(renderizarTudo);
  setOnProdutoAlteradoCallback(renderizarTudo);
}

function renderizarTudo() {
  renderizarCategoriasUI();
  renderizarEstoque();
  renderizarDashboard();
  renderizarHistoricoVendas();
  renderizarCurvaABC();
  refreshIcons();
}

// --- CONTROLE DE OPERADOR ---
function verificarOperadorOnboarding() {
  if (!state.operador) {
    abrirModalOperador();
  } else {
    atualizarBadgeOperador(state.operador);
  }
}

function abrirModalOperador() {
  const input = document.getElementById('inputOutroOperador');
  if (input) {
    input.value = state.operador || '';
  }
  abrirModal('modalOnboarding');
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
  if (!nome && !state.operador) {
    mostrarToast('Por favor, informe o nome do operador para continuar.');
    return;
  }
  if (nome) {
    state.operador = nome;
    localStorage.setItem('casa_operador', nome);
    atualizarBadgeOperador(nome);
    mostrarToast(`Operador registrado: ${nome}`);
  }
  fecharModalAtual();
  renderizarDashboard();
}

// --- NAVEGAÇÃO ENTRE ABAS ---
function mudarAba(abaId, btn) {
  document.querySelectorAll('.tab-view').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const tab = document.getElementById(`tab-${abaId}`);
  if (tab) tab.classList.add('active');
  if (btn) btn.classList.add('active');

  // Garante que o conteúdo role suavemente para o topo e desbugue posições de rolagem
  const viewport = document.querySelector('.app-viewport');
  if (viewport) {
    viewport.scrollTop = 0;
  }

  const fab = document.getElementById('fabAddProduct');
  if (fab) {
    fab.style.display = abaId === 'estoque' ? 'flex' : 'none';
  }

  if (abaId === 'dashboard') renderizarDashboard();
  if (abaId === 'vendas') renderizarHistoricoVendas();
  if (abaId === 'ferramentas') {
    renderizarCurvaABC();
    recalcularMarkup();
  }
  refreshIcons();
}

// --- VINCULAÇÃO DE EVENTOS DE INTERFACE ---
function vincularEventosGlobais() {
  // Operador
  document.getElementById('btnOperadorAtual')?.addEventListener('click', abrirModalOperador);
  document.getElementById('btnSalvarOperador')?.addEventListener('click', confirmarOperadorDigitado);
  document.getElementById('btnFecharModalOperador')?.addEventListener('click', fecharModalAtual);

  // Nuvem / Supabase & Atualizações
  document.getElementById('btnAbrirSync')?.addEventListener('click', () => abrirModal('modalSync'));
  document.getElementById('btnSalvarSupabase')?.addEventListener('click', alternarConexaoSupabase);
  document.getElementById('btnExportarBackup')?.addEventListener('click', exportarBackupJSON);
  document.getElementById('btnExportarCSVSync')?.addEventListener('click', exportarRelatorioCSV);
  document.getElementById('btnExportarVendasCSV')?.addEventListener('click', exportarRelatorioCSV);
  document.getElementById('btnForcarUpdateLocal')?.addEventListener('click', () => forcarAtualizacaoLocal(true));
  document.getElementById('btnLancarUpdateGeral')?.addEventListener('click', lancarAtualizacaoGeral);

  // Instalação PWA Direta (Header e Modal)
  const dispararInstalacao = async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        const btnHeader = document.getElementById('btnInstalarApp');
        const btnModal = document.getElementById('btnInstalarAppModal');
        if (btnHeader) btnHeader.style.display = 'none';
        if (btnModal) btnModal.style.display = 'none';
      }
      deferredInstallPrompt = null;
    } else {
      mostrarToast('Para instalar, use o menu do seu navegador (3 pontinhos > Instalar aplicativo).');
    }
  };

  document.getElementById('btnInstalarApp')?.addEventListener('click', dispararInstalacao);
  document.getElementById('btnInstalarAppModal')?.addEventListener('click', dispararInstalacao);

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
  document.getElementById('btnExcluirProduto')?.addEventListener('click', excluirProdutoAtual);

  // Máscaras Monetárias de Produtos
  document.getElementById('prodPrecoCusto')?.addEventListener('input', function() {
    aplicarMascaraMoeda(this);
  });
  document.getElementById('prodPrecoVenda')?.addEventListener('input', function() {
    aplicarMascaraMoeda(this);
  });

  // Vendas
  document.getElementById('btnVendaQtdMenos')?.addEventListener('click', () => ajustarQtdVenda(-1));
  document.getElementById('btnVendaQtdMais')?.addEventListener('click', () => ajustarQtdVenda(1));
  document.getElementById('btnConfirmarVenda')?.addEventListener('click', confirmarVendaFinal);
  document.getElementById('btnLimparVendas')?.addEventListener('click', limparTodoHistoricoVendas);
  document.querySelectorAll('.payment-methods .pay-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      selecionarMetodoPgto(this.getAttribute('data-method'), this);
    });
  });

  // Fundo de Reserva
  document.getElementById('btnAbrirConfigReserva')?.addEventListener('click', abrirModalConfigReserva);
  document.getElementById('btnSalvarConfigReserva')?.addEventListener('click', salvarConfigReserva);

  // Ponto de Equilíbrio & Custos Fixos
  document.getElementById('btnAbrirConfigEquilibrio')?.addEventListener('click', abrirModalConfigEquilibrio);
  document.getElementById('btnAdicionarCustoFixo')?.addEventListener('click', adicionarItemCustoFixo);
  document.getElementById('inputNomeCustoFixo')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('inputValorCustoFixo')?.focus();
  });
  document.getElementById('inputValorCustoFixo')?.addEventListener('input', function() {
    aplicarMascaraMoeda(this);
  });
  document.getElementById('inputValorCustoFixo')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') adicionarItemCustoFixo();
  });
  document.getElementById('inputDiasUteisMes')?.addEventListener('input', function() {
    atualizarDiasUteisMes(this.value);
  });

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
 
  // Sub-abas da Central de Ferramentas
  document.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      alternarSubAbaFerramentas(this.getAttribute('data-subtab'));
    });
  });

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

  // Fechar modais ao clicar no fundo (overlay)
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        fecharModalAtual();
      }
    });
  });
}

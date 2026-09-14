// js/curva_abc.js — Matriz Estratégica de Curva ABC e Consultoria de Margens

import { recalcularMarkup } from './markup.js';
import { mostrarToast, refreshIcons } from './utils.js';

export const DADOS_CURVA_ABC_PADRAO = [
  {
    curva: 'A',
    badge: 'Curva A — Chamariz & Giro Rápido',
    classeCor: 'curva-a',
    margemPadrao: 40,
    descricao: 'Produtos essenciais de compra frequente. Preço conhecido de cabeça pelo cliente. Margem enxuta para atrair clientes e fidelizar terreiros.',
    itens: [
      { nome: 'Vela Palito Comum (Unidade)', margem: 40, balcao: 'R$ 1,50 a R$ 2,00' },
      { nome: 'Vela Palito (Maço c/ 8 unidades)', margem: 35, balcao: 'R$ 12,00 a R$ 14,00' },
      { nome: 'Carvão de Defumação / Narguilé', margem: 40, balcao: 'R$ 3,00 a R$ 5,00' },
      { nome: 'Fósforos / Pembas Brancas', margem: 40, balcao: 'R$ 2,00 a R$ 4,00' }
    ]
  },
  {
    curva: 'B',
    badge: 'Curva B — Consumo de Rotina',
    classeCor: 'curva-b',
    margemPadrao: 55,
    descricao: 'Sustentação financeira da loja. Margem média equilibrada que cobre custos operacionais e alimenta a Caixinha de Reserva (30%).',
    itens: [
      { nome: 'Velas de 7 Dias / Votivas', margem: 55, balcao: 'R$ 10,00 a R$ 14,00' },
      { nome: 'Defumações Prontas & Misturas', margem: 55, balcao: 'R$ 6,00 a R$ 10,00' },
      { nome: 'Banhos de Ervas Secas / Desidratadas', margem: 60, balcao: 'R$ 7,00 a R$ 12,00' },
      { nome: 'Incensos de Vareta (Caixa)', margem: 50, balcao: 'R$ 3,50 a R$ 6,00' },
      { nome: 'Quartinhas de Barro (Sem Asa)', margem: 55, balcao: 'R$ 15,00 a R$ 22,00' }
    ]
  },
  {
    curva: 'C',
    badge: 'Curva C — Alto Valor & Exclusivos',
    classeCor: 'curva-c',
    margemPadrao: 75,
    descricao: 'Precificação por Valor Percebido e arte sagrada. Margem máxima de lucro livre para o negócio. O cliente paga pelo respeito e beleza.',
    itens: [
      { nome: 'Imagens de Resina / Gesso Pintadas', margem: 80, balcao: 'Valor por peça/tamanho' },
      { nome: 'Taças Trabalhadas (Exu / Pombagira)', margem: 75, balcao: 'R$ 35,00 a R$ 75,00+' },
      { nome: 'Guias de Miçanga de Vidro & Cristal', margem: 75, balcao: 'R$ 25,00 a R$ 55,00+' },
      { nome: 'Ferramentas de Ferro / Assentamentos', margem: 70, balcao: 'Conforme peso/forja' },
      { nome: 'Kits Ritualísticos Autorais', margem: 85, balcao: 'Kits montados na loja' }
    ]
  }
];

export function carregarDadosCurvaABC() {
  const salvo = localStorage.getItem('casa_curva_abc');
  if (salvo) {
    try { return JSON.parse(salvo); } catch (e) { console.warn(e); }
  }
  return DADOS_CURVA_ABC_PADRAO;
}

export function salvarDadosCurvaABC(dados) {
  localStorage.setItem('casa_curva_abc', JSON.stringify(dados));
}

export function renderizarCurvaABC() {
  const container = document.getElementById('curvaAbcContainer');
  if (!container) return;

  const dados = carregarDadosCurvaABC();
  container.innerHTML = '';

  dados.forEach(bloco => {
    const card = document.createElement('div');
    card.className = `abc-group-card ${bloco.classeCor}`;

    let itensHtml = '';
    bloco.itens.forEach(item => {
      itensHtml += `
        <div class="abc-item-row">
          <div class="abc-item-info">
            <span class="abc-item-name">${item.nome}</span>
            <span class="abc-item-meta">Balcão: <strong>${item.balcao}</strong> • Margem: <span class="abc-item-pct">${item.margem}%</span></span>
          </div>
          <button type="button" class="btn-apply-margin" data-margin="${item.margem}" data-name="${item.nome}" title="Aplicar margem de ${item.margem}% no Markup">
            <i data-lucide="calculator" style="width: 13px; height: 13px;"></i>
            <span>${item.margem}%</span>
          </button>
        </div>
      `;
    });

    card.innerHTML = `
      <div class="abc-group-header">
        <div class="abc-badge">${bloco.badge}</div>
        <button type="button" class="btn-group-apply" data-margin="${bloco.margemPadrao}">
          Usar base: ${bloco.margemPadrao}%
        </button>
      </div>
      <p class="abc-group-desc">${bloco.descricao}</p>
      <div class="abc-items-list">
        ${itensHtml}
      </div>
    `;

    container.appendChild(card);
  });

  // Eventos de clique para aplicar margem
  container.querySelectorAll('.btn-apply-margin').forEach(btn => {
    btn.addEventListener('click', function() {
      const margem = parseFloat(this.getAttribute('data-margin'));
      const nome = this.getAttribute('data-name');
      aplicarMargemNoMarkup(margem, nome);
    });
  });

  container.querySelectorAll('.btn-group-apply').forEach(btn => {
    btn.addEventListener('click', function() {
      const margem = parseFloat(this.getAttribute('data-margin'));
      aplicarMargemNoMarkup(margem);
    });
  });

  refreshIcons();
}

export function alternarSubAbaFerramentas(subaba) {
  document.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-subtab') === subaba);
  });

  const panelMarkup = document.getElementById('subpanel-markup');
  const panelAbc = document.getElementById('subpanel-curva-abc');

  if (panelMarkup) panelMarkup.classList.toggle('active', subaba === 'markup');
  if (panelAbc) panelAbc.classList.toggle('active', subaba === 'curva-abc');

  if (subaba === 'curva-abc') {
    renderizarCurvaABC();
  }

  refreshIcons();
}

export function aplicarMargemNoMarkup(margem, nomeItem = '') {
  const inpMargem = document.getElementById('calcMargem');
  if (inpMargem) {
    inpMargem.value = margem;
  }

  alternarSubAbaFerramentas('markup');
  recalcularMarkup();

  const msg = nomeItem 
    ? `Margem de ${margem}% aplicada para ${nomeItem}! Digite o custo dos insumos.` 
    : `Margem recomendada de ${margem}% aplicada no Markup!`;

  mostrarToast(msg);

  // Foca no custo para agilizar a digitação
  document.getElementById('calcCusto')?.focus();
}
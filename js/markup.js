// js/markup.js — Calculadora de Ficha Técnica e Markup Divisor

import { parseMonetaryValue, formatarMoedaExibicao } from './utils.js';
import { abrirModalProduto } from './estoque.js';

export function recalcularMarkup() {
  const custo = parseMonetaryValue(document.getElementById('calcCusto')?.value);
  const taxaPct = (parseFloat(document.getElementById('calcTaxa')?.value) || 0) / 100;
  const margemPct = (parseFloat(document.getElementById('calcMargem')?.value) || 0) / 100;

  const alertBox = document.getElementById('calcAlert');
  const resultBox = document.getElementById('calcResultBox');
  const precoSugElem = document.getElementById('calcPrecoSugerido');
  const lucroUnitElem = document.getElementById('calcLucroUnitario');
  const resUnitElem = document.getElementById('calcReservaUnitaria');

  const somaTaxasEMargem = taxaPct + margemPct;

  // Trava Matemática: Margem + Taxas não podem ser >= 100%
  if (somaTaxasEMargem >= 1) {
    if (alertBox) {
      alertBox.innerText = 'Atenção matemática: A soma da taxa do cartão com a margem não pode ser igual ou superior a 100% no Markup Divisor.';
      alertBox.style.display = 'block';
    }
    if (precoSugElem) precoSugElem.innerText = 'R$ 0,00';
    if (lucroUnitElem) lucroUnitElem.innerText = 'R$ 0,00';
    if (resUnitElem) resUnitElem.innerText = 'R$ 0,00';
    return;
  } else {
    if (alertBox) alertBox.style.display = 'none';
  }

  const divisor = 1 - somaTaxasEMargem;

  if (divisor <= 0 || custo <= 0) {
    if (precoSugElem) precoSugElem.innerText = 'R$ 0,00';
    if (lucroUnitElem) lucroUnitElem.innerText = 'R$ 0,00';
    if (resUnitElem) resUnitElem.innerText = 'R$ 0,00';
    return;
  }

  // Preço com centavos exatos (para refletir variações de 1% a 5% sem travar no teto inteiro)
  const precoExato = Math.round((custo / divisor) * 100) / 100;
  const precoArredondado = Math.ceil(precoExato);
  
  const lucroUnitario = precoExato - custo - (precoExato * taxaPct);
  const reservaUnitaria = lucroUnitario * 0.30;

  if (precoSugElem) {
    precoSugElem.innerHTML = `R$ ${formatarMoedaExibicao(precoExato)} <span style="font-size: 13px; font-weight: 500; color: var(--text-muted);">(Arred.: R$ ${formatarMoedaExibicao(precoArredondado)})</span>`;
  }
  if (lucroUnitElem) lucroUnitElem.innerText = `R$ ${formatarMoedaExibicao(lucroUnitario)}`;
  if (resUnitElem) resUnitElem.innerText = `R$ ${formatarMoedaExibicao(reservaUnitaria)}`;
}

export function copiarPrecoParaNovoProduto() {
  const custo = document.getElementById('calcCusto')?.value || '';
  const precoRaw = document.getElementById('calcPrecoSugerido')?.innerText || '';
  const match = precoRaw.match(/R\$\s*([\d\.,]+)/);
  const preco = match ? match[1] : '';

  abrirModalProduto();
  const inputCusto = document.getElementById('prodPrecoCusto');
  const inputPreco = document.getElementById('prodPrecoVenda');
  if (inputCusto) inputCusto.value = custo;
  if (inputPreco) inputPreco.value = preco;
}

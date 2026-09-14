// js/markup.js — Calculadora de Ficha Técnica e Markup Divisor

import { state } from './state.js';
import { parseMonetaryValue, formatarMoedaExibicao } from './utils.js';
import { abrirModalProduto } from './estoque.js';

export function recalcularMarkup() {
  const custo = parseMonetaryValue(document.getElementById('calcCusto')?.value);
  const taxaPct = (parseFloat(document.getElementById('calcTaxa')?.value) || 0) / 100;
  const margemPct = (parseFloat(document.getElementById('calcMargem')?.value) || 0) / 100;

  const alertBox = document.getElementById('calcAlert');
  const precoSugElem = document.getElementById('calcPrecoSugerido');
  const precoArredElem = document.getElementById('calcPrecoArredondado');
  const lucroUnitElem = document.getElementById('calcLucroUnitario');
  const resUnitElem = document.getElementById('calcReservaUnitaria');
  const resPctTag = document.getElementById('calcReservaPctTag');

  const pctReservaConfig = (state.config && typeof state.config.percentual_reserva === 'number') 
    ? state.config.percentual_reserva 
    : 30;

  if (resPctTag) {
    resPctTag.innerText = `${pctReservaConfig}%`;
  }

  const somaTaxasEMargem = taxaPct + margemPct;

  // Trava Matemática: Margem + Taxas não podem ser >= 100%
  if (somaTaxasEMargem >= 1) {
    if (alertBox) {
      alertBox.innerText = 'Atenção matemática: A soma da taxa do cartão com a margem não pode ser igual ou superior a 100% no Markup Divisor.';
      alertBox.style.display = 'block';
    }
    if (precoSugElem) precoSugElem.innerText = 'R$ 0,00';
    if (precoArredElem) precoArredElem.innerText = '';
    if (lucroUnitElem) lucroUnitElem.innerText = 'R$ 0,00';
    if (resUnitElem) resUnitElem.innerText = 'R$ 0,00';
    return;
  } else {
    if (alertBox) alertBox.style.display = 'none';
  }

  const divisor = 1 - somaTaxasEMargem;

  if (divisor <= 0 || custo <= 0) {
    if (precoSugElem) precoSugElem.innerText = 'R$ 0,00';
    if (precoArredElem) precoArredElem.innerText = '';
    if (lucroUnitElem) lucroUnitElem.innerText = 'R$ 0,00';
    if (resUnitElem) resUnitElem.innerText = 'R$ 0,00';
    return;
  }

  // Preço com centavos exatos (reflete variações de 1% a 5% sem travar no teto inteiro)
  const precoExato = Math.round((custo / divisor) * 100) / 100;
  
  // Arredondamento comercial inteligente:
  // Se for item miúdo (< R$ 10,00), arredonda para frações de R$ 0,50 (ex: 2,11 -> 2,50) em vez de pular para 3,00
  let precoArredondado;
  if (precoExato < 10) {
    precoArredondado = Math.ceil(precoExato * 2) / 2;
  } else {
    precoArredondado = Math.ceil(precoExato);
  }
  
  const lucroUnitario = precoExato - custo - (precoExato * taxaPct);
  const reservaUnitaria = lucroUnitario * (pctReservaConfig / 100);

  if (precoSugElem) {
    precoSugElem.innerText = `R$ ${formatarMoedaExibicao(precoExato)}`;
  }
  if (precoArredElem) {
    if (precoArredondado !== precoExato) {
      precoArredElem.innerText = `(ou R$ ${formatarMoedaExibicao(precoArredondado)} à vista)`;
    } else {
      precoArredElem.innerText = '';
    }
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

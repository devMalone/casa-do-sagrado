// supabase/functions/sync-google-sheets/index.ts
// Supabase Edge Function: Sincronização Unidirecional com Google Sheets API v4
// Versão: v1.0 (Base de Dados Estruturada para Inteligência Comercial — Casa do Sagrado)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const REQUIRED_SHEETS = [
  "_Metadata",
  "Vendas",
  "Itens_Venda",
  "Produtos",
  "Variantes",
  "Movimentacoes_Estoque",
  "Estoque_Atual",
  "Reserva_Caixinha",
];

const HEADERS_MAP: Record<string, string[]> = {
  _Metadata: [
    "schema_version",
    "last_sync_at",
    "application_version",
    "timezone",
    "sync_provider",
    "sync_mode",
    "total_vendas_sync",
    "total_produtos_sync",
    "total_variantes_sync",
  ],
  Vendas: [
    "sale_id",
    "data_hora",
    "data",
    "hora",
    "operador",
    "subtotal",
    "desconto",
    "total",
    "forma_pagamento",
    "custo_total",
    "lucro_bruto",
    "valor_reserva",
    "status",
    "created_at",
    "updated_at",
  ],
  Itens_Venda: [
    "sale_item_id",
    "sale_id",
    "product_id",
    "variant_id",
    "sku",
    "produto",
    "categoria",
    "subcategoria",
    "variacao_nome",
    "atributos_json",
    "quantidade",
    "preco_unitario",
    "custo_unitario",
    "preco_total",
    "custo_total",
    "lucro_bruto",
    "created_at",
  ],
  Produtos: [
    "product_id",
    "nome",
    "categoria",
    "subcategoria",
    "tem_variacoes",
    "sku",
    "custo",
    "preco",
    "estoque_atual",
    "estoque_minimo",
    "ativo",
    "created_at",
    "updated_at",
  ],
  Variantes: [
    "variant_id",
    "product_id",
    "produto",
    "sku_variant",
    "nome_variacao",
    "atributos_json",
    "cor",
    "tamanho",
    "custo",
    "preco",
    "estoque_atual",
    "estoque_minimo",
    "ativo",
    "created_at",
    "updated_at",
  ],
  Movimentacoes_Estoque: [
    "movement_id",
    "data_hora",
    "product_id",
    "variant_id",
    "produto",
    "variacao_nome",
    "tipo_movimentacao",
    "quantidade",
    "motivo",
    "sale_id",
    "custo_unitario",
    "created_at",
  ],
  Estoque_Atual: [
    "product_id",
    "variant_id",
    "tipo_item",
    "produto",
    "variante",
    "categoria",
    "subcategoria",
    "estoque_atual",
    "estoque_minimo",
    "custo_unitario",
    "preco_venda",
    "valor_imobilizado_custo",
    "valor_potencial_venda",
    "status_estoque",
    "ultima_atualizacao",
  ],
  Reserva_Caixinha: [
    "reserva_id",
    "data_hora",
    "sale_id",
    "tipo",
    "valor",
    "descricao",
    "operador",
    "created_at",
  ],
};

// ==============================================================================
// 1. HELPERS CRIPTOGRÁFICOS: OAUTH2 SERVICE ACCOUNT COM WEB CRYPTO (RS256)
// ==============================================================================

function base64url(input: string | Uint8Array): string {
  let str = "";
  if (typeof input === "string") {
    str = btoa(input);
  } else {
    const bytes = new Uint8Array(input);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    str = btoa(binary);
  }
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function obterGoogleAccessToken(clientEmail: string, privateKeyPem: string): Promise<string> {
  const cleanPem = privateKeyPem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const binaryDerString = atob(cleanPem);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedClaim = base64url(JSON.stringify(claim));
  const message = new TextEncoder().encode(`${encodedHeader}.${encodedClaim}`);

  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, message);
  const encodedSignature = base64url(signature);
  const jwt = `${encodedHeader}.${encodedClaim}.${encodedSignature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Falha ao obter Access Token do Google: ${tokenRes.status} ${errText}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// ==============================================================================
// 2. HELPERS GOOGLE SHEETS API v4
// ==============================================================================

async function obterEstruturaPlanilha(accessToken: string, spreadsheetId: string) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Erro ao consultar planilha no Google Sheets: ${res.status} ${errText}`);
  }
  return await res.json();
}

async function garantirAbasExistentes(accessToken: string, spreadsheetId: string, sheetInfo: any) {
  const existentes = new Set(
    (sheetInfo.sheets || []).map((s: any) => s.properties?.title)
  );

  const requests: any[] = [];
  for (const name of REQUIRED_SHEETS) {
    if (!existentes.has(name)) {
      requests.push({
        addSheet: {
          properties: { title: name },
        },
      });
    }
  }

  if (requests.length > 0) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Falha ao criar abas ausentes: ${res.status} ${errText}`);
    }
  }
}

async function limparAbas(accessToken: string, spreadsheetId: string, abas: string[]) {
  const ranges = abas.map((a) => `${a}!A1:Z`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ranges }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha ao limpar abas para reconstrução: ${res.status} ${errText}`);
  }
}

async function batchUpdateValues(accessToken: string, spreadsheetId: string, data: { range: string; values: any[][] }[]) {
  if (!data || data.length === 0) return;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha no batchUpdate do Google Sheets: ${res.status} ${errText}`);
  }
}

async function appendValues(accessToken: string, spreadsheetId: string, range: string, values: any[][]) {
  if (!values || values.length === 0) return;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha ao anexar linhas em ${range}: ${res.status} ${errText}`);
  }
}

async function lerValoresAba(accessToken: string, spreadsheetId: string, range: string): Promise<any[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    return [];
  }
  const json = await res.json();
  return json.values || [];
}

// ==============================================================================
// 3. TRANSFORMADORES DE DADOS (SUPABASE -> TABELAS ESTRUTURADAS DO SHEETS)
// ==============================================================================

function formatarDataHora(isoString: string | null) {
  if (!isoString) return { data_hora: "", data: "", hora: "" };
  try {
    const d = new Date(isoString);
    const data_hora = d.toISOString();
    // Horário no fuso horário do Brasil (America/Sao_Paulo)
    const data = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const hora = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
    return { data_hora, data, hora };
  } catch {
    return { data_hora: isoString, data: "", hora: "" };
  }
}

function transformarVendasAgrupadasParaLinhas(vendas: any[]) {
  const pedidosMap = new Map<string, any>();
  const linhasItens: any[][] = [];
  const linhasMov: any[][] = [];
  const linhasReserva: any[][] = [];

  for (const v of vendas) {
    const saleId = v.pedido_id || v.id;
    const { data_hora, data, hora } = formatarDataHora(v.created_at);
    const itemSubtotal = Number(v.valor_total || 0);
    const itemCusto = Number(v.custo_total || 0);
    const itemLucro = Number(v.lucro_bruto || 0);
    const itemReserva = Number(v.valor_reserva_30 || 0);

    if (!pedidosMap.has(saleId)) {
      pedidosMap.set(saleId, {
        id: saleId,
        data_hora,
        data,
        hora,
        operador: v.operador || "Operador",
        subtotal: 0,
        desconto: 0,
        total: 0,
        metodo_pagamento: v.metodo_pagamento || "Dinheiro",
        custo_total: 0,
        lucro_bruto: 0,
        valor_reserva_30: 0,
        estornada: false,
        created_at: v.created_at,
        updated_at: v.updated_at || v.created_at
      });
    }

    const ped = pedidosMap.get(saleId);
    ped.subtotal += itemSubtotal;
    ped.total += itemSubtotal;
    ped.custo_total += itemCusto;
    ped.lucro_bruto += itemLucro;
    ped.valor_reserva_30 += itemReserva;
    if (v.estornada) ped.estornada = true;

    // Item row (1 linha por item/variante)
    const linhaItem = [
      v.id,
      saleId,
      v.produto_id || "",
      v.variante_id || "",
      v.sku || "",
      v.nome_produto || "Produto",
      v.categoria || "Geral",
      v.subcategoria || "",
      v.variacao_nome || "",
      v.variacao_atributos ? JSON.stringify(v.variacao_atributos) : "",
      Number(v.quantidade || 1),
      Number(v.valor_unitario || 0),
      Number(v.quantidade ? (v.custo_total / v.quantidade).toFixed(2) : 0),
      Number(itemSubtotal.toFixed(2)),
      Number(itemCusto.toFixed(2)),
      Number(itemLucro.toFixed(2)),
      v.created_at
    ];
    linhasItens.push(linhaItem);

    // Movimentação de estoque por item
    const linhaMov = [
      `mov_venda_${v.id}`,
      data_hora,
      v.produto_id || "",
      v.variante_id || "",
      v.nome_produto || "",
      v.variacao_nome || "",
      v.estornada ? "ESTORNO" : "VENDA",
      v.estornada ? Number(v.quantidade || 1) : -Number(v.quantidade || 1),
      v.estornada ? `Estorno por ${v.estorno_operador || "Operador"}` : "Venda no PDV",
      saleId,
      Number(v.quantidade ? (v.custo_total / v.quantidade).toFixed(2) : 0),
      v.created_at
    ];
    linhasMov.push(linhaMov);
  }

  const linhasVendas: any[][] = [];
  for (const ped of pedidosMap.values()) {
    const status = ped.estornada ? "ESTORNADA" : "CONCLUIDA";
    linhasVendas.push([
      ped.id,
      ped.data_hora,
      ped.data,
      ped.hora,
      ped.operador,
      Number(ped.subtotal.toFixed(2)),
      0, // desconto
      Number(ped.total.toFixed(2)),
      ped.metodo_pagamento,
      Number(ped.custo_total.toFixed(2)),
      Number(ped.lucro_bruto.toFixed(2)),
      Number(ped.valor_reserva_30.toFixed(2)),
      status,
      ped.created_at,
      ped.updated_at
    ]);

    if (ped.valor_reserva_30 > 0) {
      linhasReserva.push([
        `res_${ped.id}`,
        ped.data_hora,
        ped.id,
        ped.estornada ? "ESTORNO_VENDA" : "ENTRADA_VENDA",
        ped.estornada ? -Number(ped.valor_reserva_30.toFixed(2)) : Number(ped.valor_reserva_30.toFixed(2)),
        `Reserva 30% do pedido ${ped.id.substring(0, 8)}`,
        ped.operador,
        ped.created_at
      ]);
    }
  }

  return { linhasVendas, linhasItens, linhasMov, linhasReserva };
}

function transformarProdutosEVariantes(produtos: any[]) {
  const linhasProdutos: any[][] = [];
  const linhasVariantes: any[][] = [];
  const linhasEstoqueAtual: any[][] = [];

  const agoraIso = new Date().toISOString();

  for (const p of produtos) {
    const temVariacoes = p.tem_variacoes === true;
    const custo = Number(p.preco_custo || 0);
    const preco = Number(p.preco_venda || 0);
    const estoque = Number(p.estoque_atual || 0);
    const estoqueMin = Number(p.estoque_minimo || 2);

    linhasProdutos.push([
      p.id,
      p.nome,
      p.categoria || "Geral",
      p.subcategoria || "",
      temVariacoes ? "SIM" : "NAO",
      p.sku || "",
      custo,
      preco,
      estoque,
      estoqueMin,
      p.ativo !== false ? "ATIVO" : "INATIVO",
      p.created_at || agoraIso,
      p.updated_at || agoraIso,
    ]);

    if (temVariacoes && Array.isArray(p.variantes) && p.variantes.length > 0) {
      for (const v of p.variantes) {
        const vCusto = v.preco_custo !== undefined ? Number(v.preco_custo) : custo;
        const vPreco = v.preco_venda !== undefined ? Number(v.preco_venda) : preco;
        const vEstoque = Number(v.estoque_atual || 0);
        const vEstoqueMin = v.estoque_minimo !== undefined ? Number(v.estoque_minimo) : estoqueMin;
        const comb = v.combinacao || {};
        const cor = comb["Cor"] || comb["cor"] || "";
        const tamanho = comb["Tamanho"] || comb["tamanho"] || "";

        linhasVariantes.push([
          v.id,
          p.id,
          p.nome,
          v.sku || "",
          v.nome_variacao || Object.values(comb).join(" / "),
          JSON.stringify(comb),
          cor,
          tamanho,
          vCusto,
          vPreco,
          vEstoque,
          vEstoqueMin,
          v.ativo !== false ? "ATIVO" : "INATIVO",
          p.created_at || agoraIso,
          p.updated_at || agoraIso,
        ]);

        const valorImobilizado = Number((vEstoque * vCusto).toFixed(2));
        const valorPotencial = Number((vEstoque * vPreco).toFixed(2));
        const statusEstoque = vEstoque === 0 ? "ZERADO" : vEstoque <= vEstoqueMin ? "BAIXO" : "NORMAL";

        linhasEstoqueAtual.push([
          p.id,
          v.id,
          "VARIANTE",
          p.nome,
          v.nome_variacao || Object.values(comb).join(" / "),
          p.categoria || "Geral",
          p.subcategoria || "",
          vEstoque,
          vEstoqueMin,
          vCusto,
          vPreco,
          valorImobilizado,
          valorPotencial,
          statusEstoque,
          agoraIso,
        ]);
      }
    } else {
      const valorImobilizado = Number((estoque * custo).toFixed(2));
      const valorPotencial = Number((estoque * preco).toFixed(2));
      const statusEstoque = estoque === 0 ? "ZERADO" : estoque <= estoqueMin ? "BAIXO" : "NORMAL";

      linhasEstoqueAtual.push([
        p.id,
        "",
        "PRODUTO_SIMPLES",
        p.nome,
        "",
        p.categoria || "Geral",
        p.subcategoria || "",
        estoque,
        estoqueMin,
        custo,
        preco,
        valorImobilizado,
        valorPotencial,
        statusEstoque,
        agoraIso,
      ]);
    }
  }

  return { linhasProdutos, linhasVariantes, linhasEstoqueAtual };
}

// ==============================================================================
// 4. HANDLER PRINCIPAL DA EDGE FUNCTION
// ==============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const inicioMs = Date.now();

  const GOOGLE_SERVICE_ACCOUNT_EMAIL = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const GOOGLE_PRIVATE_KEY = Deno.env.get("GOOGLE_PRIVATE_KEY");
  const GOOGLE_SPREADSHEET_ID = Deno.env.get("GOOGLE_SPREADSHEET_ID");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://gzkfzgbysodflayeejgy.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let modo = "incremental";
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.modo === "full_rebuild") modo = "full_rebuild";
    }
  } catch {}

  // Validar se as credenciais do Google foram configuradas
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SPREADSHEET_ID) {
    const faltantes = [];
    if (!GOOGLE_SERVICE_ACCOUNT_EMAIL) faltantes.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
    if (!GOOGLE_PRIVATE_KEY) faltantes.push("GOOGLE_PRIVATE_KEY");
    if (!GOOGLE_SPREADSHEET_ID) faltantes.push("GOOGLE_SPREADSHEET_ID");

    const msg = `Credenciais do Google ausentes no Supabase Secrets: ${faltantes.join(", ")}.`;
    await supabase
      .from("casa_intelligence_sync_state")
      .upsert({
        id: "google_sheets",
        provider: "google_sheets",
        status: "erro",
        error_message: msg,
        updated_at: new Date().toISOString(),
      });

    return new Response(
      JSON.stringify({
        sucesso: false,
        erro: msg,
        instrucao: "Configure os Secrets no painel do Supabase com o e-mail da Service Account, a Chave Privada e o ID da Planilha.",
      }),
      {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }

  try {
    // 1. Marca status como 'sincronizando'
    await supabase
      .from("casa_intelligence_sync_state")
      .upsert({
        id: "google_sheets",
        provider: "google_sheets",
        status: "sincronizando",
        last_started_at: new Date().toISOString(),
        error_message: null,
        updated_at: new Date().toISOString(),
      });

    // 2. Autentica no Google via JWT RS256 e obtém Access Token
    const accessToken = await obterGoogleAccessToken(GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY);

    // 3. Consulta estrutura da planilha e cria abas faltantes
    const sheetInfo = await obterEstruturaPlanilha(accessToken, GOOGLE_SPREADSHEET_ID);
    await garantirAbasExistentes(accessToken, GOOGLE_SPREADSHEET_ID, sheetInfo);

    // 4. Busca dados operacionais do Supabase
    const { data: produtos, error: errProd } = await supabase
      .from("casa_produtos")
      .select("*")
      .order("nome");
    if (errProd) throw errProd;

    const { data: vendas, error: errVendas } = await supabase
      .from("casa_vendas")
      .select("*")
      .order("created_at", { ascending: true });
    if (errVendas) throw errVendas;

    // Transformações dos produtos, variantes e estoque
    const { linhasProdutos, linhasVariantes, linhasEstoqueAtual } = transformarProdutosEVariantes(produtos || []);

    let totalVendasEnviadas = 0;
    let totalItensEnviados = 0;

    if (modo === "full_rebuild") {
      // --- MODO RECONSTRUÇÃO COMPLETA ---
      // Limpa todas as 8 abas
      await limparAbas(accessToken, GOOGLE_SPREADSHEET_ID, REQUIRED_SHEETS);

      const {
        linhasVendas: todasLinhasVendas,
        linhasItens: todasLinhasItens,
        linhasMov: todasLinhasMov,
        linhasReserva: todasLinhasReserva
      } = transformarVendasAgrupadasParaLinhas(vendas || []);

      totalVendasEnviadas = todasLinhasVendas.length;
      totalItensEnviados = todasLinhasItens.length;

      const agoraIso = new Date().toISOString();
      const metadataLinhas = [
        HEADERS_MAP._Metadata,
        [
          "1", // schema_version
          agoraIso,
          "v23.2",
          "America/Sao_Paulo (UTC-3)",
          "Supabase Edge Function (sync-google-sheets)",
          "full_rebuild",
          totalVendasEnviadas,
          linhasProdutos.length,
          linhasVariantes.length,
        ],
      ];

      // Escreve cabeçalhos e dados em lote
      const batchData = [
        { range: "_Metadata!A1", values: metadataLinhas },
        { range: "Vendas!A1", values: [HEADERS_MAP.Vendas, ...todasLinhasVendas] },
        { range: "Itens_Venda!A1", values: [HEADERS_MAP.Itens_Venda, ...todasLinhasItens] },
        { range: "Produtos!A1", values: [HEADERS_MAP.Produtos, ...linhasProdutos] },
        { range: "Variantes!A1", values: [HEADERS_MAP.Variantes, ...linhasVariantes] },
        { range: "Movimentacoes_Estoque!A1", values: [HEADERS_MAP.Movimentacoes_Estoque, ...todasLinhasMov] },
        { range: "Estoque_Atual!A1", values: [HEADERS_MAP.Estoque_Atual, ...linhasEstoqueAtual] },
        { range: "Reserva_Caixinha!A1", values: [HEADERS_MAP.Reserva_Caixinha, ...todasLinhasReserva] },
      ];

      await batchUpdateValues(accessToken, GOOGLE_SPREADSHEET_ID, batchData);
    } else {
      // --- MODO INCREMENTAL ---
      // 1. Garante cabeçalhos em abas vazias
      const checagensCabecalho: { range: string; values: any[][] }[] = [];
      for (const name of REQUIRED_SHEETS) {
        const valoresAba = await lerValoresAba(accessToken, GOOGLE_SPREADSHEET_ID, `${name}!A1:B1`);
        if (!valoresAba || valoresAba.length === 0) {
          checagensCabecalho.push({
            range: `${name}!A1`,
            values: [HEADERS_MAP[name]],
          });
        }
      }
      if (checagensCabecalho.length > 0) {
        await batchUpdateValues(accessToken, GOOGLE_SPREADSHEET_ID, checagensCabecalho);
      }

      // 2. Lê IDs de vendas existentes na planilha para idempotência estrita
      const vendasNaPlanilha = await lerValoresAba(accessToken, GOOGLE_SPREADSHEET_ID, "Vendas!A:A");
      const idsExistentes = new Set(vendasNaPlanilha.slice(1).map((r) => r[0]));

      // Filtra vendas cujos itens ainda não foram enviados
      const vendasNaoEnviadas = (vendas || []).filter(v => !idsExistentes.has(v.pedido_id || v.id) && !idsExistentes.has(v.id));

      const {
        linhasVendas: novasLinhasVendas,
        linhasItens: novasLinhasItens,
        linhasMov: novasLinhasMov,
        linhasReserva: novasLinhasReserva
      } = transformarVendasAgrupadasParaLinhas(vendasNaoEnviadas);

      totalVendasEnviadas = novasLinhasVendas.length;
      totalItensEnviados = novasLinhasItens.length;

      // Anexa novos eventos históricos se houverem
      if (novasLinhasVendas.length > 0) {
        await appendValues(accessToken, GOOGLE_SPREADSHEET_ID, "Vendas!A:A", novasLinhasVendas);
        await appendValues(accessToken, GOOGLE_SPREADSHEET_ID, "Itens_Venda!A:A", novasLinhasItens);
        await appendValues(accessToken, GOOGLE_SPREADSHEET_ID, "Movimentacoes_Estoque!A:A", novasLinhasMov);
      }
      if (novasLinhasReserva.length > 0) {
        await appendValues(accessToken, GOOGLE_SPREADSHEET_ID, "Reserva_Caixinha!A:A", novasLinhasReserva);
      }

      // 3. Atualiza os snapshots de estado atual (Produtos, Variantes, Estoque_Atual) com substituição limpa
      await limparAbas(accessToken, GOOGLE_SPREADSHEET_ID, ["Produtos", "Variantes", "Estoque_Atual"]);

      const agoraIso = new Date().toISOString();
      const metadataLinhas = [
        HEADERS_MAP._Metadata,
        [
          "1",
          agoraIso,
          "v23.2",
          "America/Sao_Paulo (UTC-3)",
          "Supabase Edge Function (sync-google-sheets)",
          "incremental",
          vendas?.length || 0,
          linhasProdutos.length,
          linhasVariantes.length,
        ],
      ];

      const batchSnapshots = [
        { range: "_Metadata!A1", values: metadataLinhas },
        { range: "Produtos!A1", values: [HEADERS_MAP.Produtos, ...linhasProdutos] },
        { range: "Variantes!A1", values: [HEADERS_MAP.Variantes, ...linhasVariantes] },
        { range: "Estoque_Atual!A1", values: [HEADERS_MAP.Estoque_Atual, ...linhasEstoqueAtual] },
      ];

      await batchUpdateValues(accessToken, GOOGLE_SPREADSHEET_ID, batchSnapshots);
    }

    const duracaoMs = Date.now() - inicioMs;
    const agoraIso = new Date().toISOString();

    // 5. Atualiza estado de sucesso na tabela casa_intelligence_sync_state
    await supabase
      .from("casa_intelligence_sync_state")
      .upsert({
        id: "google_sheets",
        provider: "google_sheets",
        status: "sucesso",
        last_success_at: agoraIso,
        last_completed_at: agoraIso,
        last_cursor_vendas: vendas && vendas.length > 0 ? vendas[vendas.length - 1].created_at : agoraIso,
        rows_processed: totalVendasEnviadas + linhasProdutos.length + linhasVariantes.length,
        error_message: null,
        detalhes: {
          modo,
          duracao_ms: duracaoMs,
          vendas_processadas: totalVendasEnviadas,
          itens_processados: totalItensEnviados,
          produtos_totais: linhasProdutos.length,
          variantes_totais: linhasVariantes.length,
        },
        updated_at: agoraIso,
      });

    return new Response(
      JSON.stringify({
        sucesso: true,
        modo,
        duracao_ms: duracaoMs,
        vendas_enviadas: totalVendasEnviadas,
        itens_enviados: totalItensEnviados,
        produtos_atualizados: linhasProdutos.length,
        variantes_atualizadas: linhasVariantes.length,
        mensagem: `Sincronização com Google Sheets concluída com sucesso em ${duracaoMs}ms (${modo}).`,
      }),
      {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    const msgErro = err?.message || String(err);
    console.error("[SYNC-GOOGLE-SHEETS] Erro:", msgErro);

    await supabase
      .from("casa_intelligence_sync_state")
      .upsert({
        id: "google_sheets",
        provider: "google_sheets",
        status: "erro",
        last_completed_at: new Date().toISOString(),
        error_message: msgErro,
        updated_at: new Date().toISOString(),
      });

    return new Response(
      JSON.stringify({
        sucesso: false,
        erro: msgErro,
      }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }
});

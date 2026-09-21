-- ==============================================================================
-- SCHEMA SUPABASE: CASA DO SAGRADO (VERSÃO v22.0 - ARQUITETURA COMERCIAL ROBUSTA)
-- ==============================================================================
-- Este script define a estrutura persistente oficial do aplicativo Casa do Sagrado:
-- 1. Constraints de integridade (invariantes de estoque >= 0 e preços).
-- 2. Tabela de Idempotência (casa_operacoes_idempotencia) contra reprocessamento.
-- 3. Tabela de Tombstones (casa_tombstones) contra ressurreição de registros deletados.
-- 4. Soft-delete em vendas (estornada, estornada_em, estorno_operador).
-- 5. RPCs Transacionais atômicas com bloqueio pessimista (FOR UPDATE) para venda e estorno.
-- 6. Configuração do Bucket de Imagens no Supabase Storage (casa-produtos).
-- 7. Replicação Realtime completa (REPLICA IDENTITY FULL) e políticas RLS.
-- ==============================================================================

-- 1. FUNÇÃO TRIGGER PARA ATUALIZAÇÃO AUTOMÁTICA DE updated_at
CREATE OR REPLACE FUNCTION public.casa_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. TABELA DE PRODUTOS
CREATE TABLE IF NOT EXISTS public.casa_produtos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'Geral',
  preco_custo NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  preco_venda NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  estoque_atual INT NOT NULL DEFAULT 0,
  estoque_minimo INT NOT NULL DEFAULT 2,
  ativo BOOLEAN NOT NULL DEFAULT true,
  imagem TEXT, -- URL pública do Supabase Storage ou fallback Data URL Base64
  subcategoria TEXT, -- Subcategoria opcional vinculada à categoria pai
  tem_variacoes BOOLEAN NOT NULL DEFAULT false, -- Flag indicando se produto possui variações
  variacoes JSONB NOT NULL DEFAULT '[]'::jsonb, -- Definições de dimensões: [{"id":"...","nome":"Cor","valores":["Branca","Preta"]}]
  variantes JSONB NOT NULL DEFAULT '[]'::jsonb, -- SKUs/combinações geradas com estoque individual
  foto_crop JSONB DEFAULT NULL, -- Metadados do recorte 1:1 { x, y, zoom }
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Garantir colunas se tabela já existia (Migração segura e idempotente)
ALTER TABLE public.casa_produtos ADD COLUMN IF NOT EXISTS imagem TEXT;
ALTER TABLE public.casa_produtos ADD COLUMN IF NOT EXISTS subcategoria TEXT;
ALTER TABLE public.casa_produtos ADD COLUMN IF NOT EXISTS tem_variacoes BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.casa_produtos ADD COLUMN IF NOT EXISTS variacoes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.casa_produtos ADD COLUMN IF NOT EXISTS variantes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.casa_produtos ADD COLUMN IF NOT EXISTS foto_crop JSONB DEFAULT NULL;
ALTER TABLE public.casa_produtos ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE public.casa_produtos ADD COLUMN IF NOT EXISTS codigo_barras TEXT;
ALTER TABLE public.casa_produtos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Restrição de unicidade em SKU (ignora nulos durante backfill)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_casa_produtos_sku_unique') THEN
    CREATE UNIQUE INDEX idx_casa_produtos_sku_unique ON public.casa_produtos(sku) WHERE sku IS NOT NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_casa_produtos_codigo_barras ON public.casa_produtos(codigo_barras);

-- INVARIANTES: Constraints de Integridade Física do Produto
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_casa_produtos_estoque_nao_negativo') THEN
    ALTER TABLE public.casa_produtos ADD CONSTRAINT chk_casa_produtos_estoque_nao_negativo CHECK (estoque_atual >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_casa_produtos_preco_custo') THEN
    ALTER TABLE public.casa_produtos ADD CONSTRAINT chk_casa_produtos_preco_custo CHECK (preco_custo >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_casa_produtos_preco_venda') THEN
    ALTER TABLE public.casa_produtos ADD CONSTRAINT chk_casa_produtos_preco_venda CHECK (preco_venda >= 0);
  END IF;
END $$;

-- Índices de performance para busca e filtros de produtos
CREATE INDEX IF NOT EXISTS idx_casa_produtos_categoria ON public.casa_produtos(categoria);
CREATE INDEX IF NOT EXISTS idx_casa_produtos_subcategoria ON public.casa_produtos(subcategoria);
CREATE INDEX IF NOT EXISTS idx_casa_produtos_updated_at ON public.casa_produtos(updated_at);
CREATE INDEX IF NOT EXISTS idx_casa_produtos_ativo ON public.casa_produtos(ativo);

-- Trigger de updated_at para produtos
DROP TRIGGER IF EXISTS trg_casa_produtos_updated_at ON public.casa_produtos;
CREATE TRIGGER trg_casa_produtos_updated_at
BEFORE UPDATE ON public.casa_produtos
FOR EACH ROW EXECUTE FUNCTION public.casa_set_updated_at();

-- 3. TABELA DE VENDAS (COM SUPORTE A SOFT-DELETE, ESTORNO E HISTÓRICO DE VARIAÇÕES)
CREATE TABLE IF NOT EXISTS public.casa_vendas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id UUID REFERENCES public.casa_produtos(id) ON DELETE SET NULL,
  nome_produto TEXT NOT NULL,
  subcategoria TEXT,
  variante_id TEXT, -- ID da combinação vendida
  variacao_nome TEXT, -- Ex: "Branca / 18 cm"
  variacao_atributos JSONB, -- Ex: {"Cor":"Branca","Tamanho":"18 cm"}
  quantidade INT NOT NULL DEFAULT 1,
  valor_unitario NUMERIC(10, 2) NOT NULL,
  valor_total NUMERIC(10, 2) NOT NULL,
  custo_total NUMERIC(10, 2) NOT NULL,
  lucro_bruto NUMERIC(10, 2) NOT NULL,
  valor_reserva_30 NUMERIC(10, 2) NOT NULL,
  metodo_pagamento TEXT NOT NULL,
  operador TEXT NOT NULL,
  estornada BOOLEAN NOT NULL DEFAULT false,
  estornada_em TIMESTAMPTZ,
  estorno_operador TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Garantir colunas de controle, estorno, variações e SKU se tabela já existia
ALTER TABLE public.casa_vendas ADD COLUMN IF NOT EXISTS subcategoria TEXT;
ALTER TABLE public.casa_vendas ADD COLUMN IF NOT EXISTS variante_id TEXT;
ALTER TABLE public.casa_vendas ADD COLUMN IF NOT EXISTS variacao_nome TEXT;
ALTER TABLE public.casa_vendas ADD COLUMN IF NOT EXISTS variacao_atributos JSONB;
ALTER TABLE public.casa_vendas ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE public.casa_vendas ADD COLUMN IF NOT EXISTS estornada BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.casa_vendas ADD COLUMN IF NOT EXISTS estornada_em TIMESTAMPTZ;
ALTER TABLE public.casa_vendas ADD COLUMN IF NOT EXISTS estorno_operador TEXT;
ALTER TABLE public.casa_vendas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- INVARIANTES: Constraints de Integridade das Vendas
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_casa_vendas_quantidade') THEN
    ALTER TABLE public.casa_vendas ADD CONSTRAINT chk_casa_vendas_quantidade CHECK (quantidade > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_casa_vendas_valor_total') THEN
    ALTER TABLE public.casa_vendas ADD CONSTRAINT chk_casa_vendas_valor_total CHECK (valor_total >= 0);
  END IF;
END $$;

-- Índices de performance para vendas
CREATE INDEX IF NOT EXISTS idx_casa_vendas_created_at ON public.casa_vendas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_casa_vendas_produto_id ON public.casa_vendas(produto_id);
CREATE INDEX IF NOT EXISTS idx_casa_vendas_sku ON public.casa_vendas(sku);
CREATE INDEX IF NOT EXISTS idx_casa_vendas_estornada ON public.casa_vendas(estornada);
CREATE INDEX IF NOT EXISTS idx_casa_vendas_updated_at ON public.casa_vendas(updated_at);

-- Trigger de updated_at para vendas
DROP TRIGGER IF EXISTS trg_casa_vendas_updated_at ON public.casa_vendas;
CREATE TRIGGER trg_casa_vendas_updated_at
BEFORE UPDATE ON public.casa_vendas
FOR EACH ROW EXECUTE FUNCTION public.casa_set_updated_at();

-- 4. TABELA DE CONFIGURAÇÕES (FUNDO DE RESERVA, CUSTOS FIXOS, CATEGORIAS)
CREATE TABLE IF NOT EXISTS public.casa_configuracoes (
  chave TEXT PRIMARY KEY,
  valor JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger de updated_at para configurações
DROP TRIGGER IF EXISTS trg_casa_configuracoes_updated_at ON public.casa_configuracoes;
CREATE TRIGGER trg_casa_configuracoes_updated_at
BEFORE UPDATE ON public.casa_configuracoes
FOR EACH ROW EXECUTE FUNCTION public.casa_set_updated_at();

-- Inserir configurações padrão caso ainda não existam
INSERT INTO public.casa_configuracoes (chave, valor)
VALUES 
  ('fundo_reserva', '{"tetoReserva": 1500.00, "percentualReserva": 30}'),
  ('custos_fixos', '{"itens": [], "diasUteisMes": 26}'),
  ('categorias', '["Católico", "Umbanda/Quimbanda", "Holístico", "Geral"]')
ON CONFLICT (chave) DO NOTHING;

-- 5. TABELA DE IDEMPOTÊNCIA (CONTRA OPERAÇÕES DUPLICADAS POR OSCILAÇÃO DE REDE)
CREATE TABLE IF NOT EXISTS public.casa_operacoes_idempotencia (
  operacao_id UUID PRIMARY KEY,
  tipo TEXT NOT NULL,
  entidade TEXT NOT NULL,
  registro_id UUID,
  detalhes JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_casa_operacoes_tipo ON public.casa_operacoes_idempotencia(tipo, registro_id);
CREATE INDEX IF NOT EXISTS idx_casa_operacoes_created_at ON public.casa_operacoes_idempotencia(created_at DESC);

-- 6. TABELA DE TOMBSTONES (REGISTRO FORMAL DE EXCLUSÕES PARA DISPOSITIVOS RETOMANDO DE STANDBY)
CREATE TABLE IF NOT EXISTS public.casa_tombstones (
  entidade TEXT NOT NULL,
  registro_id UUID NOT NULL,
  deleted_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (entidade, registro_id)
);

CREATE INDEX IF NOT EXISTS idx_casa_tombstones_deleted_at ON public.casa_tombstones(deleted_at DESC);

-- ==============================================================================
-- 7. FUNÇÃO RPC TRANSACIONAL ATÔMICA: REGISTRO DE VENDA COM LOCK PESSIMISTA
-- ==============================================================================
-- Fluxo atômico garantido:
-- 1. Verifica se a operação já foi processada (idempotência).
-- 2. Bloqueia a linha do produto com FOR UPDATE (impede concorrência Android vs iPhone).
-- 3. Confere saldo de estoque em tempo real no banco.
-- 4. Cria o registro de venda em casa_vendas.
-- 5. Desconta o estoque em casa_produtos.
-- 6. Registra na tabela de idempotência.
-- Se qualquer passo falhar: ROLLBACK automático; nenhum dado inconsistente permanece.
CREATE OR REPLACE FUNCTION public.casa_registrar_venda_transacional(
  p_operacao_id UUID,
  p_venda_id UUID,
  p_produto_id UUID,
  p_qtd INT,
  p_metodo_pagamento TEXT,
  p_operador TEXT,
  p_valor_unitario NUMERIC,
  p_valor_total NUMERIC,
  p_custo_total NUMERIC,
  p_lucro_bruto NUMERIC,
  p_valor_reserva_30 NUMERIC,
  p_subcategoria TEXT DEFAULT NULL,
  p_variante_id TEXT DEFAULT NULL,
  p_variacao_nome TEXT DEFAULT NULL,
  p_variacao_atributos JSONB DEFAULT NULL,
  p_sku TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_prod RECORD;
  v_novo_estoque INT;
  v_novas_variantes JSONB := '[]'::jsonb;
  v_elem JSONB;
  v_achou_variante BOOLEAN := false;
  v_estoque_var INT;
  v_novo_estoque_var INT;
BEGIN
  -- 1. Proteção contra execução duplicada (Idempotência)
  IF EXISTS (SELECT 1 FROM public.casa_operacoes_idempotencia WHERE operacao_id = p_operacao_id) THEN
    RETURN jsonb_build_object(
      'sucesso', true,
      'ja_processado', true,
      'venda_id', p_venda_id,
      'mensagem', 'Operação já processada anteriormente.'
    );
  END IF;

  -- 2. Validação básica de parâmetros
  IF p_qtd <= 0 THEN
    RAISE EXCEPTION 'Quantidade de venda inválida: %', p_qtd;
  END IF;

  -- 3. Bloqueio pessimista de linha contra concorrência simultânea (FOR UPDATE)
  SELECT id, nome, estoque_atual, tem_variacoes, variantes INTO v_prod
  FROM public.casa_produtos
  WHERE id = p_produto_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto não encontrado (ID: %)', p_produto_id;
  END IF;

  -- 4. Validação estrita de saldo de estoque (Variante vs Produto Simples)
  IF p_variante_id IS NOT NULL AND v_prod.tem_variacoes IS TRUE AND v_prod.variantes IS NOT NULL THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_prod.variantes)
    LOOP
      IF (v_elem->>'id') = p_variante_id THEN
        v_achou_variante := true;
        v_estoque_var := COALESCE((v_elem->>'estoque_atual')::INT, 0);
        IF v_estoque_var < p_qtd THEN
          RAISE EXCEPTION 'Estoque insuficiente na variação % do produto %. Disponível: %, Solicitado: %',
            COALESCE(p_variacao_nome, p_variante_id), v_prod.nome, v_estoque_var, p_qtd;
        END IF;
        v_novo_estoque_var := v_estoque_var - p_qtd;
        v_novas_variantes := v_novas_variantes || jsonb_build_array(jsonb_set(v_elem, '{estoque_atual}', to_jsonb(v_novo_estoque_var)));
      ELSE
        v_novas_variantes := v_novas_variantes || jsonb_build_array(v_elem);
      END IF;
    END LOOP;

    IF NOT v_achou_variante THEN
      RAISE EXCEPTION 'Variação não encontrada (ID: %) para o produto %', p_variante_id, v_prod.nome;
    END IF;
  ELSE
    IF v_prod.estoque_atual < p_qtd THEN
      RAISE EXCEPTION 'Estoque insuficiente no momento da venda. Produto: %, Disponível: %, Solicitado: %',
        v_prod.nome, v_prod.estoque_atual, p_qtd;
    END IF;
  END IF;

  v_novo_estoque := v_prod.estoque_atual - p_qtd;

  -- 5. Atualização atômica do saldo de estoque
  IF v_achou_variante THEN
    UPDATE public.casa_produtos
    SET estoque_atual = v_novo_estoque,
        variantes = v_novas_variantes,
        updated_at = NOW()
    WHERE id = p_produto_id;
  ELSE
    UPDATE public.casa_produtos
    SET estoque_atual = v_novo_estoque,
        updated_at = NOW()
    WHERE id = p_produto_id;
  END IF;

  -- 6. Inserção do registro oficial de venda
  INSERT INTO public.casa_vendas (
    id,
    produto_id,
    nome_produto,
    subcategoria,
    variante_id,
    variacao_nome,
    variacao_atributos,
    quantidade,
    valor_unitario,
    valor_total,
    custo_total,
    lucro_bruto,
    valor_reserva_30,
    metodo_pagamento,
    operador,
    sku,
    estornada,
    created_at,
    updated_at
  ) VALUES (
    p_venda_id,
    p_produto_id,
    v_prod.nome,
    p_subcategoria,
    p_variante_id,
    p_variacao_nome,
    p_variacao_atributos,
    p_qtd,
    p_valor_unitario,
    p_valor_total,
    p_custo_total,
    p_lucro_bruto,
    p_valor_reserva_30,
    p_metodo_pagamento,
    p_operador,
    p_sku,
    false,
    NOW(),
    NOW()
  );

  -- 7. Registro da operação para garantia de idempotência futura
  INSERT INTO public.casa_operacoes_idempotencia (
    operacao_id,
    tipo,
    entidade,
    registro_id,
    detalhes
  ) VALUES (
    p_operacao_id,
    'VENDA',
    'casa_vendas',
    p_venda_id,
    jsonb_build_object(
      'produto_id', p_produto_id,
      'quantidade', p_qtd,
      'valor_total', p_valor_total,
      'operador', p_operador,
      'variante_id', p_variante_id,
      'variacao_nome', p_variacao_nome
    )
  );

  -- 8. Retorno estruturado de sucesso
  RETURN jsonb_build_object(
    'sucesso', true,
    'venda_id', p_venda_id,
    'produto_id', p_produto_id,
    'novo_estoque', v_novo_estoque,
    'variante_id', p_variante_id
  );
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- 8. FUNÇÃO RPC TRANSACIONAL ATÔMICA: ESTORNO DE VENDA COM DEVOLUÇÃO DE ESTOQUE
-- ==============================================================================
-- Fluxo atômico garantido:
-- 1. Verifica se a operação já foi processada (idempotência).
-- 2. Bloqueia a linha da venda com FOR UPDATE.
-- 3. Valida que a venda existe e NÃO foi estornada anteriormente.
-- 4. Devolve o estoque atômico para o produto correspondente (e para a variante específica, se houver).
-- 5. Marca a venda como estornada (soft-delete preservando auditoria financeira).
-- 6. Registra a operação de idempotência.
-- Impede categoricamente estornos duplicados e devolução duplicada de estoque.
CREATE OR REPLACE FUNCTION public.casa_estornar_venda_transacional(
  p_operacao_id UUID,
  p_venda_id UUID,
  p_operador TEXT
) RETURNS JSONB AS $$
DECLARE
  v_venda RECORD;
  v_prod RECORD;
  v_novo_estoque INT := NULL;
  v_novas_variantes JSONB := '[]'::jsonb;
  v_elem JSONB;
  v_achou_variante BOOLEAN := false;
  v_novo_estoque_var INT;
BEGIN
  -- 1. Proteção de Idempotência
  IF EXISTS (SELECT 1 FROM public.casa_operacoes_idempotencia WHERE operacao_id = p_operacao_id) THEN
    RETURN jsonb_build_object(
      'sucesso', true,
      'ja_processado', true,
      'venda_id', p_venda_id,
      'mensagem', 'Estorno já processado anteriormente.'
    );
  END IF;

  -- 2. Localiza e bloqueia a venda
  SELECT id, produto_id, nome_produto, quantidade, estornada, estorno_operador, estornada_em,
         variante_id, variacao_nome
  INTO v_venda
  FROM public.casa_vendas
  WHERE id = p_venda_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada para estorno (ID: %)', p_venda_id;
  END IF;

  -- 3. INVARIANTE: Uma venda só pode ser estornada UMA VEZ
  IF v_venda.estornada THEN
    RAISE EXCEPTION 'Esta venda já foi estornada por % em %.', v_venda.estorno_operador, v_venda.estornada_em;
  END IF;

  -- 4. Devolve o estoque atômico para o produto e para a variante (se o produto ainda existir)
  IF v_venda.produto_id IS NOT NULL THEN
    SELECT id, estoque_atual, tem_variacoes, variantes INTO v_prod
    FROM public.casa_produtos
    WHERE id = v_venda.produto_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_venda.variante_id IS NOT NULL AND v_prod.tem_variacoes IS TRUE AND v_prod.variantes IS NOT NULL THEN
        FOR v_elem IN SELECT * FROM jsonb_array_elements(v_prod.variantes)
        LOOP
          IF (v_elem->>'id') = v_venda.variante_id THEN
            v_achou_variante := true;
            v_novo_estoque_var := COALESCE((v_elem->>'estoque_atual')::INT, 0) + v_venda.quantidade;
            v_novas_variantes := v_novas_variantes || jsonb_build_array(jsonb_set(v_elem, '{estoque_atual}', to_jsonb(v_novo_estoque_var)));
          ELSE
            v_novas_variantes := v_novas_variantes || jsonb_build_array(v_elem);
          END IF;
        END LOOP;
      END IF;

      IF v_achou_variante THEN
        UPDATE public.casa_produtos
        SET estoque_atual = estoque_atual + v_venda.quantidade,
            variantes = v_novas_variantes,
            updated_at = NOW()
        WHERE id = v_venda.produto_id
        RETURNING estoque_atual INTO v_novo_estoque;
      ELSE
        UPDATE public.casa_produtos
        SET estoque_atual = estoque_atual + v_venda.quantidade,
            updated_at = NOW()
        WHERE id = v_venda.produto_id
        RETURNING estoque_atual INTO v_novo_estoque;
      END IF;
    END IF;
  END IF;

  -- 5. Atualiza a venda marcando-a como estornada (soft-delete)
  UPDATE public.casa_vendas
  SET estornada = true,
      estornada_em = NOW(),
      estorno_operador = COALESCE(p_operador, 'Operador'),
      updated_at = NOW()
  WHERE id = p_venda_id;

  -- 6. Registra na tabela de idempotência
  INSERT INTO public.casa_operacoes_idempotencia (
    operacao_id,
    tipo,
    entidade,
    registro_id,
    detalhes
  ) VALUES (
    p_operacao_id,
    'ESTORNO',
    'casa_vendas',
    p_venda_id,
    jsonb_build_object(
      'quantidade_devolvida', v_venda.quantidade,
      'produto_id', v_venda.produto_id,
      'operador', p_operador,
      'variante_id', v_venda.variante_id
    )
  );

  RETURN jsonb_build_object(
    'sucesso', true,
    'venda_id', p_venda_id,
    'quantidade_devolvida', v_venda.quantidade,
    'novo_estoque', v_novo_estoque,
    'variante_id', v_venda.variante_id
  );
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- 9. FUNÇÃO RPC TRANSACIONAL: EXCLUSÃO DE PRODUTO COM CRIAÇÃO DE TOMBSTONE
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.casa_excluir_produto_transacional(
  p_operacao_id UUID,
  p_produto_id UUID
) RETURNS JSONB AS $$
BEGIN
  -- 1. Idempotência
  IF EXISTS (SELECT 1 FROM public.casa_operacoes_idempotencia WHERE operacao_id = p_operacao_id) THEN
    RETURN jsonb_build_object('sucesso', true, 'ja_processado', true, 'produto_id', p_produto_id);
  END IF;

  -- 2. Registra Tombstone persistente para impedir ressurreição por dispositivos que estavam offline
  INSERT INTO public.casa_tombstones (entidade, registro_id, deleted_at)
  VALUES ('produtos', p_produto_id, NOW())
  ON CONFLICT (entidade, registro_id) DO UPDATE SET deleted_at = NOW();

  -- 3. Remove o produto da tabela oficial
  DELETE FROM public.casa_produtos WHERE id = p_produto_id;

  -- 4. Registra Idempotência
  INSERT INTO public.casa_operacoes_idempotencia (
    operacao_id,
    tipo,
    entidade,
    registro_id
  ) VALUES (
    p_operacao_id,
    'PRODUTO_DELETE',
    'casa_produtos',
    p_produto_id
  );

  RETURN jsonb_build_object('sucesso', true, 'produto_id', p_produto_id);
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- 10. CONFIGURAÇÃO DO BUCKET DO SUPABASE STORAGE PARA FOTOGRAFIAS
-- ==============================================================================
-- Criação do Bucket público 'casa-produtos' se não existir
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'casa-produtos',
  'casa-produtos',
  true,
  5242880, -- 5 MB de limite por arquivo
  ARRAY['image/webp', 'image/jpeg', 'image/png', 'image/jpg']
)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Políticas de acesso público para o Bucket de Fotografias
DROP POLICY IF EXISTS "Fotos Produtos Leitura Publica" ON storage.objects;
DROP POLICY IF EXISTS "Fotos Produtos Upload Publico" ON storage.objects;
DROP POLICY IF EXISTS "Fotos Produtos Update Publico" ON storage.objects;
DROP POLICY IF EXISTS "Fotos Produtos Delete Publico" ON storage.objects;

CREATE POLICY "Fotos Produtos Leitura Publica" ON storage.objects
  FOR SELECT USING (bucket_id = 'casa-produtos');

CREATE POLICY "Fotos Produtos Upload Publico" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'casa-produtos');

CREATE POLICY "Fotos Produtos Update Publico" ON storage.objects
  FOR UPDATE USING (bucket_id = 'casa-produtos');

CREATE POLICY "Fotos Produtos Delete Publico" ON storage.objects
  FOR DELETE USING (bucket_id = 'casa-produtos');

-- ==============================================================================
-- 11. REPLICA IDENTITY FULL (FUNDAMENTAL PARA SUPABASE REALTIME EM DELETE)
-- ==============================================================================
ALTER TABLE public.casa_produtos REPLICA IDENTITY FULL;
ALTER TABLE public.casa_vendas REPLICA IDENTITY FULL;
ALTER TABLE public.casa_configuracoes REPLICA IDENTITY FULL;
ALTER TABLE public.casa_tombstones REPLICA IDENTITY FULL;

-- ==============================================================================
-- 12. ATIVAR REALTIME NA PUBLICAÇÃO SUPABASE_REALTIME
-- ==============================================================================
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.casa_produtos;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.casa_vendas;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.casa_configuracoes;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.casa_tombstones;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- ==============================================================================
-- 13. POLÍTICAS DE ACESSO (RLS - ROW LEVEL SECURITY)
-- ==============================================================================
ALTER TABLE public.casa_produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casa_vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casa_configuracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casa_operacoes_idempotencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casa_tombstones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acesso Total Produtos" ON public.casa_produtos;
DROP POLICY IF EXISTS "Acesso Total Vendas" ON public.casa_vendas;
DROP POLICY IF EXISTS "Acesso Total Config" ON public.casa_configuracoes;
DROP POLICY IF EXISTS "Acesso Total Idempotencia" ON public.casa_operacoes_idempotencia;
DROP POLICY IF EXISTS "Acesso Total Tombstones" ON public.casa_tombstones;

CREATE POLICY "Acesso Total Produtos" ON public.casa_produtos FOR ALL USING (true);
CREATE POLICY "Acesso Total Vendas" ON public.casa_vendas FOR ALL USING (true);
CREATE POLICY "Acesso Total Config" ON public.casa_configuracoes FOR ALL USING (true);
CREATE POLICY "Acesso Total Idempotencia" ON public.casa_operacoes_idempotencia FOR ALL USING (true);
CREATE POLICY "Acesso Total Tombstones" ON public.casa_tombstones FOR ALL USING (true);

-- ==============================================================================
-- 14. TABELA DE CONTROLE DE SINCRONIZAÇÃO DE INTELIGÊNCIA (GOOGLE SHEETS)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.casa_intelligence_sync_state (
  id TEXT PRIMARY KEY DEFAULT 'google_sheets',
  provider TEXT NOT NULL DEFAULT 'google_sheets',
  last_started_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  last_cursor_vendas TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ocioso', -- 'ocioso', 'sincronizando', 'sucesso', 'erro'
  rows_processed INT NOT NULL DEFAULT 0,
  error_message TEXT,
  detalhes JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger para updated_at
DROP TRIGGER IF EXISTS trg_casa_intelligence_sync_state_updated_at ON public.casa_intelligence_sync_state;
CREATE TRIGGER trg_casa_intelligence_sync_state_updated_at
BEFORE UPDATE ON public.casa_intelligence_sync_state
FOR EACH ROW EXECUTE FUNCTION public.casa_set_updated_at();

-- Linha inicial padrão caso não exista
INSERT INTO public.casa_intelligence_sync_state (id, provider, status, rows_processed)
VALUES ('google_sheets', 'google_sheets', 'ocioso', 0)
ON CONFLICT (id) DO NOTHING;

-- Habilitar RLS e Política de Acesso Total
ALTER TABLE public.casa_intelligence_sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Acesso Total Intelligence Sync" ON public.casa_intelligence_sync_state;
CREATE POLICY "Acesso Total Intelligence Sync" ON public.casa_intelligence_sync_state FOR ALL USING (true);

-- Habilitar Realtime para atualizações na UI
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.casa_intelligence_sync_state;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- ==============================================================================
-- 15. SISTEMA DE SKU AUTOMÁTICO, SEQUENCE, GERAÇÃO E BACKFILL SEGURO
-- ==============================================================================
-- Sequence global para identificadores numéricos de SKU comercial
CREATE SEQUENCE IF NOT EXISTS public.casa_sku_seq START WITH 1001;

-- Função geradora de SKU legível baseado na categoria ou prefixo padrão
CREATE OR REPLACE FUNCTION public.casa_gerar_sku(p_categoria TEXT DEFAULT 'ART')
RETURNS TEXT AS $$
DECLARE
  v_prefix TEXT;
  v_num BIGINT;
BEGIN
  v_prefix := UPPER(SUBSTRING(REGEXP_REPLACE(COALESCE(p_categoria, 'ART'), '[^a-zA-Z]', '', 'g') FROM 1 FOR 3));
  IF LENGTH(v_prefix) < 3 THEN
    v_prefix := RPAD(COALESCE(v_prefix, 'ART'), 3, 'X');
  END IF;
  v_num := nextval('public.casa_sku_seq');
  RETURN v_prefix || '-' || LPAD(v_num::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Trigger para garantir que novos produtos sempre tenham SKU se inseridos nulos
CREATE OR REPLACE FUNCTION public.casa_trg_garantir_sku()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sku IS NULL OR TRIM(NEW.sku) = '' THEN
    NEW.sku := public.casa_gerar_sku(NEW.categoria);
  ELSE
    NEW.sku := UPPER(TRIM(NEW.sku));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_casa_produtos_garantir_sku ON public.casa_produtos;
CREATE TRIGGER trg_casa_produtos_garantir_sku
BEFORE INSERT ON public.casa_produtos
FOR EACH ROW EXECUTE FUNCTION public.casa_trg_garantir_sku();

-- Backfill seguro e idempotente para produtos e variantes legadas existentes
DO $$
DECLARE
  r RECORD;
  v_sku TEXT;
  v_novas_vars JSONB;
  v_elem JSONB;
  v_idx INT;
  v_var_sku TEXT;
  v_tem_col_vars BOOLEAN;
BEGIN
  -- Garante dinamicamente que a consulta não falhe mesmo se executada antes de DDLs
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'casa_produtos' AND column_name = 'tem_variacoes'
  ) INTO v_tem_col_vars;

  IF v_tem_col_vars THEN
    FOR r IN EXECUTE 'SELECT id, nome, categoria, tem_variacoes, variantes FROM public.casa_produtos WHERE sku IS NULL' LOOP
      v_sku := public.casa_gerar_sku(r.categoria);
      
      IF r.tem_variacoes IS TRUE AND r.variantes IS NOT NULL AND jsonb_array_length(r.variantes) > 0 THEN
        v_novas_vars := '[]'::jsonb;
        v_idx := 1;
        FOR v_elem IN SELECT * FROM jsonb_array_elements(r.variantes) LOOP
          IF v_elem->>'sku' IS NULL OR TRIM(v_elem->>'sku') = '' THEN
            v_var_sku := v_sku || '-' || LPAD(v_idx::TEXT, 2, '0');
            v_novas_vars := v_novas_vars || jsonb_build_array(jsonb_set(v_elem, '{sku}', to_jsonb(v_var_sku)));
          ELSE
            v_novas_vars := v_novas_vars || jsonb_build_array(v_elem);
          END IF;
          v_idx := v_idx + 1;
        END LOOP;
        
        UPDATE public.casa_produtos
        SET sku = v_sku,
            variantes = v_novas_vars,
            updated_at = NOW()
        WHERE id = r.id;
      ELSE
        UPDATE public.casa_produtos
        SET sku = v_sku,
            updated_at = NOW()
        WHERE id = r.id;
      END IF;
    END LOOP;
  ELSE
    FOR r IN EXECUTE 'SELECT id, nome, categoria FROM public.casa_produtos WHERE sku IS NULL' LOOP
      v_sku := public.casa_gerar_sku(r.categoria);
      UPDATE public.casa_produtos
      SET sku = v_sku,
          updated_at = NOW()
      WHERE id = r.id;
    END LOOP;
  END IF;
END $$;



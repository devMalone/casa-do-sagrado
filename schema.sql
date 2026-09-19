-- ==============================================================================
-- SCHEMA SUPABASE: CASA DO SAGRADO (RESET LIMPO E DEFINITIVO)
-- ==============================================================================

-- 1. LIMPAR SE EXISTIR ALGUMA COISA ANTERIOR (Zera com segurança)
DROP TABLE IF EXISTS public.casa_vendas CASCADE;
DROP TABLE IF EXISTS public.casa_produtos CASCADE;
DROP TABLE IF EXISTS public.casa_configuracoes CASCADE;

-- 2. CRIAR AS TABELAS VAZIAS (SEM ITENS DE EXEMPLO)
CREATE TABLE public.casa_produtos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL, -- 'Católico', 'Umbanda/Quimbanda', 'Holístico', 'Geral'
  preco_custo NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  preco_venda NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  estoque_atual INT NOT NULL DEFAULT 0,
  estoque_minimo INT NOT NULL DEFAULT 2,
  ativo BOOLEAN NOT NULL DEFAULT true,
  imagem TEXT, -- Data URL comprimida Base64 ou URL pública de foto do catálogo
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Garantir coluna em bancos existentes sem quebrar dados anteriores
ALTER TABLE public.casa_produtos ADD COLUMN IF NOT EXISTS imagem TEXT;

CREATE TABLE public.casa_vendas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id UUID REFERENCES public.casa_produtos(id) ON DELETE SET NULL,
  nome_produto TEXT NOT NULL,
  quantidade INT NOT NULL DEFAULT 1,
  valor_unitario NUMERIC(10, 2) NOT NULL,
  valor_total NUMERIC(10, 2) NOT NULL,
  custo_total NUMERIC(10, 2) NOT NULL,
  lucro_bruto NUMERIC(10, 2) NOT NULL,
  valor_reserva_30 NUMERIC(10, 2) NOT NULL,
  metodo_pagamento TEXT NOT NULL,
  operador TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.casa_configuracoes (
  chave TEXT PRIMARY KEY,
  valor JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. INSERIR CONFIGURAÇÃO DA META DO FUNDO DE RESERVA E CUSTOS FIXOS
INSERT INTO public.casa_configuracoes (chave, valor)
VALUES 
  ('fundo_reserva', '{"teto_meta": 1500.00, "percentual": 30}'),
  ('custos_fixos', '{"itens": [], "diasUteisMes": 26}');

-- 4. FUNÇÃO RPC PARA BAIXA ATÔMICA DE ESTOQUE
CREATE OR REPLACE FUNCTION public.casa_dar_baixa_venda(
  p_produto_id UUID,
  p_qtd INT
) RETURNS VOID AS $$
BEGIN
  UPDATE public.casa_produtos
  SET estoque_atual = estoque_atual - p_qtd,
      updated_at = NOW()
  WHERE id = p_produto_id AND estoque_atual >= p_qtd;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estoque insuficiente no momento da venda.';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 5. ATIVAR REALTIME DE FORMA SEGURA (SEM ERRO SE JÁ EXISTIR)
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
END $$;

-- 5.1 GARANTIR IDENTIDADE COMPLETA PARA EVENTOS DE DELETE EM REALTIME
ALTER TABLE public.casa_produtos REPLICA IDENTITY FULL;
ALTER TABLE public.casa_vendas REPLICA IDENTITY FULL;
ALTER TABLE public.casa_configuracoes REPLICA IDENTITY FULL;

-- 6. POLÍTICAS DE ACESSO PÚBLICAS
ALTER TABLE public.casa_produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casa_vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casa_configuracoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acesso Total Produtos" ON public.casa_produtos FOR ALL USING (true);
CREATE POLICY "Acesso Total Vendas" ON public.casa_vendas FOR ALL USING (true);
CREATE POLICY "Acesso Total Config" ON public.casa_configuracoes FOR ALL USING (true);

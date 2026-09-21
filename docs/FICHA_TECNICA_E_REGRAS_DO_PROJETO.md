# Ficha Técnica, Histórico de Evolução, Regras e Contrato de Arquitetura Comercial
**Projeto:** Casa do Sagrado — Sistema de Gestão Comercial e Inteligência de Vendas  
**Ambiente:** Progressive Web App (PWA Mobile-First / Desktop), Local-First com Sincronização Supabase  
**Data de Consolidação:** 21 de Setembro de 2026  
**Versão Atual Estável:** `v23.4.1` (Auditoria e Estabilização Definitiva do Sistema de Atualização do Aplicativo, Servidor como Autoridade Máxima de Versão via version.json, Separação de Pedido Global app_update_request sem Versão, Comparação Semântica com Bloqueio Estrito de Downgrade e Proteção Total da Outbox)  

---

## 1. Visão Geral e Status Real dos Componentes

O **Casa do Sagrado** é um sistema comercial de ponto de venda (PDV), catálogo visual vitrine, controle de estoque com variantes, consultoria de markup divisor, curva ABC, ponto de equilíbrio operacional e governança de reservas financeiras projetado para operar com **convergência atômica entre múltiplos dispositivos concorrentes simultâneos** (Android / Chrome e iPhone / Safari WebKit Standalone).

### Classificação Formal de Status dos Componentes (Auditoria v23.4.1):

| Componente / Funcionalidade | Status Real | Observações Técnicas |
| :--- | :---: | :--- |
| **Sistema de SKU Automático e Código Comercial** | `IMPLEMENTADO` | Geração automática baseada em prefixo de categoria + sequência global (`VEL-000101`); editável; imutável a renomeações. |
| **SKUs Específicos por Variante Vendável** | `IMPLEMENTADO` | Sufixo derivado de atributos (`VEL-000101-BRA-18`); geração incremental para novas combinações preservando antigas. |
| **Separação entre SKU e Código de Barras** | `IMPLEMENTADO` | Campos distintos (`sku` interno vs `codigo_barras` EAN/GTIN/leitor óptico). |
| **Busca Multi-Fator no PDV, Estoque e Vitrine** | `IMPLEMENTADO` | Localização instantânea por Nome, Categoria, Subcategoria, SKU do produto, SKU da variante ou Código de Barras. |
| **Categorias e Subcategorias Hierárquicas** | `IMPLEMENTADO` | Categoria principal + subcategoria opcional vinculada; criação inline na tela de produto (`+ Nova`). |
| **Sistema de Variações Dinâmicas e Atributos** | `IMPLEMENTADO` | Variações livres (Cor, Tamanho, Aroma, etc.), tags com adição rápida e exclusão individual. |
| **Combinações Cartesianas e Estoque por Variante** | `IMPLEMENTADO` | Gestão de combinações com estoque individual; estoque total do produto calculado dinamicamente. |
| **Foto por Variação (Valor da Dimensão)** | `IMPLEMENTADO` | Associação opcional de imagem a um valor (ex: Cor: Branca); reaproveitada por todos os tamanhos sem duplicação. |
| **Foto por Combinação Específica** | `IMPLEMENTADO` | Imagem específica para combinação pontual (ex: Branca / 18 cm) com máxima prioridade de exibição. |
| **Hierarquia Centralizada de Resolução de Imagens** | `IMPLEMENTADO` | Função `obterImagemProdutoResolvida()`: Combinação -> Valor da Variação -> Foto Principal -> Placeholder. |
| **Seleção de Origem da Foto (Câmera ou Galeria)** | `IMPLEMENTADO` | Action sheet com escolha tátil direta de câmera (`capture="environment"`) ou arquivo local. |
| **Seleção de Variação no PDV / Vitrine com Troca Dinâmica** | `IMPLEMENTADO` | Troca instantânea da miniatura de exibição no modal de seleção e venda rápida ao alternar chips. |
| **Baixa Atômica de Estoque por Variante (RPC)** | `IMPLEMENTADO` | `casa_registrar_venda_transacional` com lock pessimista na variante dentro do JSONB do Postgres. |
| **Histórico e Relatório CSV com Variações** | `IMPLEMENTADO` | Venda registra variante vendida e atributos; CSV exporta colunas separadas para BI e IA. |
| **Base de Dados para Inteligência (Google Sheets)** | `IMPLEMENTADO` | Sincronização unidirecional Supabase -> Google Sheets via Edge Function dedicada com autenticação nativa RS256. |
| **8 Abas Estruturadas (Contrato Estável para IA)** | `IMPLEMENTADO` | `_Metadata`, `Vendas`, `Itens_Venda`, `Produtos`, `Variantes`, `Movimentacoes_Estoque`, `Estoque_Atual`, `Reserva_Caixinha`. |
| **Controle e Observabilidade de Sincronização** | `IMPLEMENTADO` | Tabela `casa_intelligence_sync_state` no Supabase com status em tempo real, timestamps, contagem e cursor incremental. |
| **Disparo Automático (Cron) e Manual (Painel)** | `IMPLEMENTADO` | Agendável via Supabase Cron (1h) e botões administrativos discretos no modal de sincronização do PDV. |
| **Cropper Nativo 1:1 Reutilizável (Touch / Pan / Zoom)** | `IMPLEMENTADO` | Ajuste de enquadramento sem dependências externas, proporção 1:1 idêntica aos cards, zoom e pan. |
| **Reenquadramento de Foto Sem Perda (Todas as Fotos)** | `IMPLEMENTADO` | Imagens originais salvas com chaves compostas em `IndexedDB.imagens_originais`, prevenindo degradação. |
| **Ponto de Venda (PDV) e Baixa Local** | `IMPLEMENTADO` | Atualização síncrona no milissegundo zero via memória (`state.*`) e persistência local. |
| **Fila Outbox Persistente com Idempotência** | `IMPLEMENTADO` | Persistida no `localStorage` e espelhada no `IndexedDB` com `operation_id = UUID`. |
| **Motor Central de Sincronização (`sync_engine.js`)** | `IMPLEMENTADO` | Centraliza envio da Outbox, reconciliação formal e upload assíncrono de fotos (principal e variações) para Storage. |
| **Camada de Cache de Imagens em IndexedDB** | `IMPLEMENTADO` | `casa_sagrado_db` v2 (`imagens` e `imagens_originais`) protegendo cota de 5MB do Safari. |
| **Eliminação de Efeito Zumbi e Suporte a `[]`** | `IMPLEMENTADO` | Proibição de re-upload por ausência remota; suporte a listas vazias e tombstones. |
| **Exportação e Restauração de Backup JSON** | `IMPLEMENTADO` | Validação de schema, diálogo in-app, preservação de variantes e fotos sem duplicação. |
| **Compatibilidade Mobile PWA (iOS + Android)** | `IMPLEMENTADO` | Safe areas, `100dvh`, prevenção de zoom Safari (`16px`) e monitor de suspensão > 5s. |
| **Service Worker com Cache Versionado** | `IMPLEMENTADO` | `casa-sagrado-v23.4`, fonte única `version.js`, `updateViaCache: 'none'`, ouvinte formal de `SKIP_WAITING`, ciclo de atualização aguardando `controllerchange`, prevenção de reload em loop e exclusão estrita de caches obsoletos do app. |
| **Script SQL de Transações e RPCs (`schema.sql`)** | `IMPLEMENTADO NO CÓDIGO` | SQL v23.0 + v23.2 com tabelas de inteligência, constraints e locks transacionais. |
| **Upload Direto para Supabase Storage** | `IMPLEMENTADO COM FALLBACK` | Upload com nomenclatura previsível de foto principal e por variação; fallback transparente em offline. |

---

## 2. Arquitetura de Persistência Multi-Tier

```mermaid
graph TD
    UI[Interface do Usuário PWA / Touch] --> StateMem[Tier 1: Memória - state.* / Latência Zero]
    StateMem --> LocalStorage[Tier 2: LocalStorage - Prefs, Sessão, Flags Leves]
    StateMem --> IndexedDB[Tier 3: IndexedDB - Blobs de Fotos & Outbox Persistente]
    IndexedDB --> SyncEngine[Motor de Sincronização / sync_engine.js]
    SyncEngine -->|Transações RPC / FOR UPDATE| Postgres[(Tier 4: PostgreSQL Supabase - Fonte da Verdade)]
    SyncEngine -->|Upload Assíncrono| SupabaseStorage[(Tier 5: Supabase Storage - Bucket casa-produtos)]
    Postgres -->|Cron / Edge Function RS256| Sheets[(Tier 6: Google Sheets - Data Warehouse de Inteligência)]
    Sheets -->|Consultas Futuras de Leitura| IAFutura[Agente / Assessor de IA]
    Postgres -->|WebSocket Realtime| DemaisTerminais[Demais Dispositivos Conectados]
    DemaisTerminais -->|Reconciliação / updated_at / Tombstones| LocalB[Convergência Determinística no Disp. B]
```

Para eliminar gargalos de quota de armazenamento no mobile e garantir integridade sem perda de performance, os dados do sistema são segmentados por finalidade técnica:

| Camada (Tier) | Tecnologia | Dados Armazenados | Escopo & Ciclo de Vida |
| :--- | :--- | :--- | :--- |
| **Tier 1: Memória** | `state.*` (JavaScript Object) | Catálogo em tela, vendas ativas, filtros, flags de UI, pilha de modais. | Volátil. Atualizado síncronamente no milissegundo zero para resposta tátil instantânea. |
| **Tier 2: LocalStorage** | `localStorage` nativo (~5MB) | Dados leves: `casa_device_id`, `casa_operador`, `casa_config`, `casa_categorias`, referências/URLs de imagens, lista de tombstones locais. | Persistente no navegador. Não armazena fotos pesadas em Base64 para evitar `QuotaExceededError` no Safari. |
| **Tier 3: IndexedDB** | `indexed_db.js` (`casa_sagrado_db`) | 1. Cache offline de Blobs/DataURLs de fotografias (`store: imagens`).<br>2. Espelho de segurança da fila Outbox (`store: outbox_backup`). | Persistente local de alta capacidade (centenas de MB). Garante vitrine visual offline mesmo sem conexão. |
| **Tier 4: PostgreSQL** | Supabase Database | **Fonte definitiva e compartilhada da verdade da loja:** `casa_produtos`, `casa_vendas`, `casa_configuracoes`, `casa_operacoes_idempotencia`, `casa_tombstones`, `casa_intelligence_sync_state`. | Transacional, ACID, com Row Level Security (RLS) e publicação Realtime. |
| **Tier 5: Object Storage** | Supabase Storage (`casa-produtos`) | Arquivos otimizados de fotos (`produtos/{id}.webp`). | Armazenamento de mídia remota de alta disponibilidade com CDN e URLs públicas. |
| **Tier 6: Google Sheets** | Google Sheets API v4 (Service Account) | **Data Warehouse Estruturado para Inteligência:** 8 abas (`_Metadata`, `Vendas`, `Itens_Venda`, `Produtos`, `Variantes`, `Movimentacoes_Estoque`, `Estoque_Atual`, `Reserva_Caixinha`). | Unidirecional (Supabase -> Sheets). Cópia padronizada de leitura para IA e BI sem acesso ao PDV. |

---

## 3. Definição Formal da Fonte da Verdade e Conflitos

1. **Durante o Uso Normal:** O estado em memória (`state.*`) e os repositórios locais (`localStorage` e `IndexedDB`) respondem instantaneamente à interface para que o operador nunca espere a rede para registrar vendas, consultar o catálogo ou alterar estoque (princípio Local-First).
2. **Persistência Definitiva:** O PostgreSQL (Supabase) representa a **fonte persistente compartilhada oficial da loja**. Nenhum dado é considerado definitivo entre lojas/dispositivos sem confirmação no banco.
3. **Resolução de Conflitos:**
   - **Mutações Locais Pendentes:** Enquanto um registro possuir uma mutação na fila Outbox local (`syncQueue`), alterações remotas recebidas via Realtime são ignoradas temporariamente para não sobrescrever a ação do operador local.
   - **Convergência por Timestamp (`updated_at`):** Quando ambos os lados convergem, prevalece o registro com o `updated_at` mais recente gerado ou validado pelo servidor (Last-Write-Wins qualificado).
   - **Tombstones:** Registros excluídos no servidor constam na tabela `casa_tombstones`. Se um dispositivo acordar de suspensão com um item local antigo, a presença do ID em `casa_tombstones` determina o expurgo imediato do item local, proibindo categoricamente qualquer ressurreição.

---

## 4. Motor de Sincronização (Sync Engine) e Fila Outbox Idempotente

Toda comunicação com o Supabase é centralizada no módulo [`app/js/sync_engine.js`](file:///c:/Users/Malone/OneDrive/Área%20de%20Trabalho/Antigravity/Empreender/Loja%20de%20Artigos%20Religiosos/app/js/sync_engine.js):

### Estrutura de cada Job da Outbox (`syncQueue`):
- `jobId`: UUID de controle local.
- `operation_id`: UUID imutável da operação para garantia de idempotência no banco de dados.
- `tipo`: `'PRODUTO_UPSERT'` | `'PRODUTO_DELETE'` | `'VENDA_TRANSACIONAL'` | `'ESTORNO_TRANSACIONAL'` | `'VENDAS_CLEAR'` | `'CONFIG_UPSERT'`.
- `entidade`: `'produtos'` | `'vendas'` | `'configuracoes'`.
- `id`: UUID do registro alvo.
- `dados`: Carga de dados sanitizada.
- `timestamp`: Milissegundos de criação.
- `retentativas`: Contador numérico de falhas.
- `ultimo_erro`: Mensagem de erro capturada.
- `status`: `'pendente'` | `'processando'` | `'sucesso'` | `'falha_definitiva'`.
- `deviceId`: Identificador único do terminal originador.

### Sobrevivência e Retentativas:
- A Outbox é gravada no `localStorage` e espelhada no `IndexedDB` a cada mutação. Sobrevive a recarregamentos, fechamento do PWA, reinicialização do smartphone e perda de rede.
- Ao retomar a conexão (`navigator.onLine = true`, `visibilitychange`, `pageshow`), o worker `processarOutbox()` envia os itens sequencialmente. Se ocorrer erro de rede, o job permanece na fila e um retry com backoff é disparado em 6 segundos.

### Rotina Central de Reconciliação (`reconciliarComServidor()`):
Executada de forma determinística e unificada:
1. Drena a fila Outbox pendente.
2. Consulta `casa_tombstones` e purga produtos excluídos no cache local.
3. Consulta e mescla `casa_configuracoes` (Fundo de Reserva, Custos Fixos, Categorias).
4. Consulta e atualiza `casa_produtos` respeitando pendências da Outbox e `updated_at`.
5. Consulta e converge `casa_vendas` ativas (filtrando `estornada = false`).
6. Persiste os dados nos armazenamentos locais e aciona re-render limpo da UI.

---

## 5. Concorrência e Transações Atômicas no Banco de Dados

### 5.1. Venda Atômica com Bloqueio Pessimista (`casa_registrar_venda_transacional`)
Para impedir cenários de concorrência onde dois aparelhos tentam vender o último item disponível (estoque = 1):
1. O backend PostgreSQL executa `SELECT id, estoque_atual FROM casa_produtos WHERE id = p_produto_id FOR UPDATE;`.
2. A linha é bloqueada no nível do PostgreSQL até o encerramento da transação.
3. Se `estoque_atual < p_qtd`, lança exceção imediata (`RAISE EXCEPTION`), abortando a transação (ROLLBACK automático). O estoque nunca fica negativo graças à constraint `CHECK (estoque_atual >= 0)`.
4. Decrementa o estoque, insere a venda em `casa_vendas` e registra o `operation_id` na tabela `casa_operacoes_idempotencia` dentro do mesmo bloco atômico.

### 5.2. Estorno Atômico e Idempotente (`casa_estornar_venda_transacional`)
Uma venda só pode ser estornada UMA ÚNICA VEZ:
1. Bloqueia a venda com `SELECT * FROM casa_vendas WHERE id = p_venda_id FOR UPDATE;`.
2. Verifica se a venda já possui `estornada = true`. Se sim, aborta a transação e impede nova devolução de estoque.
3. Devolve a quantidade de mercadorias para `casa_produtos`.
4. Atualiza a venda marcando `estornada = true`, `estornada_em = NOW()` e `estorno_operador`.
5. Registra o `operation_id` na tabela `casa_operacoes_idempotencia`.

---

## 6. Dicionário Completo do Modelo de Dados

### Tabela: `public.casa_produtos`
Armazena os produtos do catálogo e seus saldos de estoque (com ou sem variantes).
- `id` (UUID, PK, Default: `gen_random_uuid()`): Identificador único global.
- `nome` (TEXT, Not Null): Nome comercial do produto.
- `categoria` (TEXT, Not Null, Default: `'Geral'`): Categoria vinculada.
- `subcategoria` (TEXT, Nullable): Subcategoria opcional vinculada à categoria pai.
- `preco_custo` (NUMERIC(10,2), Not Null, Default: `0.00`): Custo base do produto (utilizado como fallback se a variante não especificar).
- `preco_venda` (NUMERIC(10,2), Not Null, Default: `0.00`): Preço base de balcão (fallback da variante).
- `estoque_atual` (INT, Not Null, Default: `0`): Saldo físico em estoque (para produtos com variações, corresponde à soma automática de todas as variantes).
- `estoque_minimo` (INT, Not Null, Default: `2`): Limiar para alerta visual de estoque baixo.
- `ativo` (BOOLEAN, Not Null, Default: `true`): Status de exibição no catálogo.
- `imagem` (TEXT, Nullable): URL pública do Supabase Storage ou WebP 600x600 em base64.
- `foto_crop` (JSONB, Nullable): Metadados de enquadramento `{ panX, panY, zoom }` para reedição sem perda.
- `tem_variacoes` (BOOLEAN, Not Null, Default: `false`): Flag que indica se o produto utiliza variações.
- `variacoes` (JSONB, Not Null, Default: `'[]'`): Lista de dimensões `{ id, nome, valores: [...], fotos?: { [valor]: url }, fotos_crop?: { [valor]: { panX, panY, zoom } } }`. O mapa `fotos` permite associar imagem opcional a um valor específico da variação (ex: "Cor: Branca").
- `variantes` (JSONB, Not Null, Default: `'[]'`): Lista de combinações vendáveis com SKU `{ id, sku, combinacao: { Cor: "Branca", Tamanho: "18 cm" }, nome_variacao, estoque_atual, estoque_minimo, preco_custo, preco_venda, imagem?: url, foto_crop?: { panX, panY, zoom }, ativo }`. O campo `imagem` permite sobrescrever a foto para uma combinação completa específica (ex: "Branca / 18 cm").
- `created_at` (TIMESTAMPTZ, Default: `NOW()`): Data de inclusão.
- `updated_at` (TIMESTAMPTZ, Default: `NOW()`): Atualizado automaticamente via trigger `trg_casa_produtos_updated_at`.
- **Constraints:** `chk_casa_produtos_estoque_nao_negativo` (`estoque_atual >= 0`), `chk_casa_produtos_preco_custo` (`preco_custo >= 0`), `chk_casa_produtos_preco_venda` (`preco_venda >= 0`).
- **Índices:** `idx_casa_produtos_categoria`, `idx_casa_produtos_subcategoria`, `idx_casa_produtos_tem_variacoes`, `idx_casa_produtos_updated_at`, `idx_casa_produtos_ativo`.

### Tabela: `public.casa_vendas`
Armazena o histórico comercial e financeiro de vendas e estornos com granularidade de variante.
- `id` (UUID, PK, Default: `gen_random_uuid()`): Identificador único da transação.
- `produto_id` (UUID, Nullable, FK: `casa_produtos.id ON DELETE SET NULL`): Referência ao produto.
- `nome_produto` (TEXT, Not Null): Snapshot do nome do produto no instante da venda.
- `subcategoria` (TEXT, Nullable): Snapshot da subcategoria no instante da venda.
- `variante_id` (TEXT, Nullable): ID único da variante vendida (ex: `var_172...`).
- `variacao_nome` (TEXT, Nullable): Descritivo legível da combinação (ex: `"Preta / 18 cm"`).
- `variacao_atributos` (JSONB, Nullable): Dicionário dos atributos vendidos (ex: `{"Cor": "Preta", "Tamanho": "18 cm"}`).
- `quantidade` (INT, Not Null, Default: `1`): Unidades comercializadas.
- `valor_unitario` (NUMERIC(10,2), Not Null): Preço unitário praticado.
- `valor_total` (NUMERIC(10,2), Not Null): Valor bruto da operação.
- `custo_total` (NUMERIC(10,2), Not Null): Custo da mercadoria vendida (CMV).
- `lucro_bruto` (NUMERIC(10,2), Not Null): Margem de contribuição (`valor_total - custo_total`).
- `valor_reserva_30` (NUMERIC(10,2), Not Null): Cota destinada ao Fundo de Reserva.
- `metodo_pagamento` (TEXT, Not Null): Forma de pagamento (Pix, Dinheiro, Débito, Crédito).
- `operador` (TEXT, Not Null): Nome do operador responsável.
- `estornada` (BOOLEAN, Not Null, Default: `false`): Flag de soft-delete de estorno.
- `estornada_em` (TIMESTAMPTZ, Nullable): Data/hora do estorno.
- `estorno_operador` (TEXT, Nullable): Operador que efetuou o estorno.
- `created_at` (TIMESTAMPTZ, Default: `NOW()`): Data/hora de registro.
- `updated_at` (TIMESTAMPTZ, Default: `NOW()`): Trigger `trg_casa_vendas_updated_at`.
- **Constraints:** `chk_casa_vendas_quantidade` (`quantidade > 0`), `chk_casa_vendas_valor_total` (`valor_total >= 0`).
- **Índices:** `idx_casa_vendas_created_at`, `idx_casa_vendas_produto_id`, `idx_casa_vendas_variante_id`, `idx_casa_vendas_estornada`, `idx_casa_vendas_updated_at`.

### Tabela: `public.casa_configuracoes`
Armazena parâmetros de gestão e sincronização.
- `chave` (TEXT, PK): Identificador da configuração (`fundo_reserva`, `custos_fixos`, `categorias`, `versao_app`).
- `valor` (JSONB, Not Null): Dados estruturados da configuração.
- `updated_at` (TIMESTAMPTZ, Default: `NOW()`): Trigger `trg_casa_configuracoes_updated_at`.

### Tabela: `public.casa_operacoes_idempotencia`
Garante que pacotes reenviados por oscilação de rede não dupliquem operações.
- `operacao_id` (UUID, PK): Token idempotente gerado pelo dispositivo cliente.
- `tipo` (TEXT, Not Null): Tipo de mutação (`VENDA`, `ESTORNO`, `PRODUTO_DELETE`).
- `entidade` (TEXT, Not Null): Tabela alvo.
- `registro_id` (UUID, Nullable): ID do registro associado.
- `detalhes` (JSONB, Nullable): Metadados para auditoria.
- `created_at` (TIMESTAMPTZ, Default: `NOW()`): Data/hora do processamento inicial.

### Tabela: `public.casa_tombstones`
Garante que deleções sejam lembradas permanentemente por terminais offline.
- `entidade` (TEXT, Not Null): Entidade deletada (`produtos`).
- `registro_id` (UUID, Not Null): UUID do registro deletado.
- `deleted_at` (TIMESTAMPTZ, Default: `NOW()`): Data da exclusão.
- **PK Composta:** `(entidade, registro_id)`.

### Tabela: `public.casa_intelligence_sync_state`
Controla a observabilidade, idempotência e cursor incremental da sincronização com a Base de Dados de Inteligência (Google Sheets).
- `id` (TEXT, PK, Default: `'google_sheets'`): Identificador único do provedor de inteligência.
- `provider` (TEXT, Not Null, Default: `'google_sheets'`): Nome do serviço destino.
- `last_started_at` (TIMESTAMPTZ, Nullable): Timestamp de início do último ciclo de sincronização.
- `last_success_at` (TIMESTAMPTZ, Nullable): Timestamp de conclusão bem-sucedida.
- `last_completed_at` (TIMESTAMPTZ, Nullable): Timestamp da última finalização (sucesso ou falha).
- `last_cursor_vendas` (TIMESTAMPTZ, Nullable): Data de criação da última venda exportada para a planilha.
- `status` (TEXT, Not Null, Default: `'ocioso'`): Status operacional (`'ocioso'`, `'sincronizando'`, `'sucesso'`, `'erro'`).
- `rows_processed` (INT, Not Null, Default: `0`): Total de linhas sincronizadas no último ciclo.
- `error_message` (TEXT, Nullable): Mensagem descritiva de erro capturada da API do Google em caso de falha.
- `detalhes` (JSONB, Default: `'{}'`): Metadados de execução (duração em ms, modo incremental/rebuild, contagens por aba).
- `created_at` (TIMESTAMPTZ, Default: `NOW()`): Data de criação do registro.
- `updated_at` (TIMESTAMPTZ, Default: `NOW()`): Trigger `trg_casa_intelligence_sync_state_updated_at`.

### Storage: Bucket `casa-produtos`
- Finalidade: Armazenamento público de imagens dos produtos (`produtos/{id}.webp`).
- Limite por arquivo: 5 MB.
- Formatos aceitos: WebP, JPEG, PNG.

---

## 7. Auditoria Transparente de Segurança e RLS

> [!IMPORTANT]
> **Declaração de Transparência sobre Segurança e Autenticação:**
> - O aplicativo opera atualmente em modelo **Single-Tenant compartilhado** utilizando a chave pública anônima do Supabase (`Anon Public Key`).
> - O controle de operadores é realizado por seleção/digitação de perfil no próprio aplicativo e persistido no dispositivo.
> - As tabelas do banco de dados possuem Row Level Security (RLS) habilitado com políticas permissivas públicas (`FOR ALL USING (true)`).
> - **Chave Administrativa (Service Role):** A chave de serviço (`service_role`) **NUNCA** foi ou será incluída no código-fonte cliente. Toda a comunicação ocorre com credenciais de acesso anônimo com privilégios limitados.
> - **Requisitos para Isolamento Multi-Loja (Futuro):** Caso o sistema venha a ser comercializado como SaaS para terceiros, será indispensável a ativação do Supabase Auth (`auth.uid()`), inclusão da coluna `loja_id` em todas as tabelas e substituição das policies por `USING (loja_id = auth.jwt() ->> 'loja_id')`.

---

## 8. Compatibilidade Multiplataforma PWA (Android + iOS Safari)

| Recurso | Android (Chrome / Chromium) | iPhone (Safari / WebKit Standalone) | Solução Arquitetural Aplicada |
| :--- | :--- | :--- | :--- |
| **Instalação PWA** | Suporta evento nativo `beforeinstallprompt`. | Não possui `beforeinstallprompt`. | Detecção de agente iOS fora do modo standalone exibindo modal interativo com guia passo a passo ("Compartilhar > Adicionar à Tela de Início"). |
| **Safe Areas** | Barra de navegação e barra de status variáveis. | Dynamic Island, Notch superior e Home Indicator inferior. | Design tokens CSS `--safe-top: env(safe-area-inset-top)` e `--safe-bottom: env(safe-area-inset-bottom)` aplicados à `.top-bar`, `.bottom-nav`, `.fab` e rodapés de modais. |
| **Zoom Indesejado** | Respeita `user-scalable=no`. | Força auto-zoom em inputs com fonte < 16px. | Todos os inputs (`.form-input`, `.search-input`, `.form-select`) calibrados para `font-size: 16px`. |
| **Suspensão em Background** | Mantém conexões brevemente; restaura via `online`/`focus`. | Congela WebSockets e timers agressivamente após ~5s em background. | Monitor unificado capturando `pageshow` (bfcache), `visibilitychange`, `focus` e `online`. Se suspenso por > 5s, reconecta o WebSocket e dispara `reconciliarComServidor()`. |
| **Quota de Armazenamento** | Quotas generosas no LocalStorage. | LocalStorage restrito a ~5MB com risco de falha. | Migração do armazenamento de fotos para **IndexedDB** local e **Supabase Storage** na nuvem. |

---

## 9. Versionamento Tríplice

- **`APP_VERSION`:** `v22.0` (Controle do front-end e regras comerciais).
- **`DB_SCHEMA_VERSION`:** `22` (Controle de migrações e compatibilidade de RPCs no PostgreSQL).
- **`CACHE_VERSION`:** `casa-sagrado-v22.0` (Controle do Service Worker e invalidação no CacheStorage).

---

## 10. Invariantes Invioláveis do Sistema

1. **Estoque Nunca Negativo:** Nenhuma operação de venda pode produzir `estoque_atual < 0` (protegido por `chk_casa_produtos_estoque_nao_negativo` e `FOR UPDATE`).
2. **Idempotência Estrita:** O mesmo `operation_id` nunca produz efeito cumulativo no banco de dados.
3. **Estorno Único:** Uma venda só pode ser estornada uma vez; tentativas repetidas são rejeitadas sem restaurar estoque extra.
4. **Respeito a Tombstones:** Registros excluídos formalmente não podem ser ressuscitados por dispositivos que estavam offline.
5. **Listas Vazias São Estados Válidos:** A exclusão legítima de todas as vendas ou produtos não aciona restauração fantasma no arranque.
6. **Consistência Venda + Estoque:** Uma venda não pode existir sem a baixa de estoque correspondente, e um estoque não pode baixar sem venda associada.
7. **Soberania do Servidor com Latência Zero:** A interface responde localmente no milissegundo zero, mas o banco é o árbitro final de consistência.
8. **Imagens sem Bloqueio:** Falhas na rede ou no Storage nunca impedem o salvamento do produto nem travam o catálogo.
9. **Compatibilidade Retroativa:** Produtos com imagens Base64 antigas continuam funcionando sem quebra na vitrine.
10. **Neutralidade de Operador:** Nomes de operadores nunca devem vir fixados no código-fonte.

---

## 11. Regras Permanentes de Arquitetura e Código

> [!IMPORTANT]
> Estas regras são contratos técnicos invioláveis do projeto. Qualquer nova alteração DEVE seguir rigorosamente estas diretrizes.

### Regra 1: Princípio Local-First Estrito com Latência Zero
- Toda ação do usuário (venda, cadastro, edição, exclusão, estorno, configuração) **DEVE ser refletida no estado em memória (`state.*`) e persistida no `localStorage` e `IndexedDB` no milissegundo zero**, enfileirando o respectivo job na Outbox (`enfileirarMutacao`).
- A interface nunca deve aguardar resposta HTTP para confirmar uma ação de tela.

### Regra 2: Soberania da Outbox e Proibição de Inferência por Ausência
- **JAMAIS** comparar coleções locais e remotas para fazer upload automático de itens que "não existem no banco".
- Apenas itens explicitamente registrados na `syncQueue` com status pendente devem ser enviados como novas criações. Itens ausentes na nuvem que não estão na Outbox local foram deletados remotamente e devem ser expurgados localmente.

### Regra 3: Idempotência Obrigatória para Mutações Críticas (`operation_id`)
- Toda operação que afeta estoque ou finanças (`VENDA_TRANSACIONAL`, `ESTORNO_TRANSACIONAL`, `PRODUTO_DELETE`) deve carregar um `operation_id = crypto.randomUUID()` imutável.
- O PostgreSQL deve verificar o `operation_id` na tabela `casa_operacoes_idempotencia` antes de aplicar qualquer alteração física.

### Regra 4: Atomicidade no Banco via RPC e Bloqueio Pessimista (`FOR UPDATE`)
- Vendas e estornos DEVEM ser executados no Supabase via PostgreSQL Functions / RPCs (`casa_registrar_venda_transacional` e `casa_estornar_venda_transacional`).
- Toda leitura concorrente de saldo de estoque para venda deve utilizar `SELECT ... FOR UPDATE` para impedir condições de corrida entre dois aparelhos.

### Regra 5: Soft-Delete Obrigatório para Estornos de Vendas
- Vendas NUNCA devem ser excluídas com `DELETE` físico direto no banco de dados.
- O estorno deve marcar `estornada = true`, registrar data/hora e operador, e devolver o estoque atômico, preservando a trilha de auditoria financeira.

### Regra 6: Exclusão Segura com Registro de Tombstones
- A exclusão de produtos deve gerar um registro persistente na tabela `casa_tombstones (entidade, registro_id, deleted_at)`.
- Dispositivos que retomam de períodos prolongados de suspensão devem consultar os tombstones remotos antes de reconciliar o catálogo.

### Regra 7: Armazenamento Multi-Tier (IndexedDB para Imagens, LocalStorage Leve)
- O `localStorage` deve ser reservado exclusivamente para dados leves (metadados, configurações, identificadores).
- Fotografias de produtos devem ser armazenadas localmente no **IndexedDB** (`casa_sagrado_db.imagens`) e remotamente no **Supabase Storage** (`casa-produtos`), nunca como strings Base64 brutas no `localStorage`.

### Regra 8: Blindagem do Supabase (Nunca usar `.catch` em Builders)
- Construtores de consulta do Supabase (`PostgrestFilterBuilder`) implementam `.then()`, mas **NÃO POSSUEM método `.catch()` garantido** no runtime do navegador.
- Todas as chamadas de banco devem ser encapsuladas em blocos `try/catch` nativos com `async/await`.

### Regra 9: Respeito a Coleções Vazias (`[]`) sem Restauração Fantasma
- Coleções vazias (`[]`) retornadas pelo servidor são estados legítimos (ex: limpeza intencional de histórico).
- O código cliente NUNCA deve verificar apenas `dados.length > 0` para aceitar dados remotos. Sempre verificar `Array.isArray(dados)`.

### Regra 10: Identificadores Estritamente em UUID v4
- Toda entidade sincronizada (`casa_produtos`, `casa_vendas`, `casa_tombstones`, `casa_operacoes_idempotencia`) DEVE utilizar UUID v4 gerado via `crypto.randomUUID()`. Identificadores textuais legados causam erro de sintaxe Postgres (`22P02`).

### Regra 11: Viewport Mobile Dinâmico e Modo Standalone
- NUNCA usar `"display": "fullscreen"` no `manifest.json`. Utilizar sempre `"display": "standalone"`.
- Vincular dinamicamente `--app-height` ao `window.innerHeight` no JavaScript e aplicar `100dvh` para proteger o layout contra a barra de navegação do Android.

### Regra 12: Safe Area Insets e Prevenção de Auto-Zoom no Safari
- Todos os elementos estruturais de borda (`.top-bar`, `.bottom-nav`, `.fab`, rodapés de modais) DEVEM incluir `env(safe-area-inset-top)` e `env(safe-area-inset-bottom)`.
- Todo campo de entrada de texto (`input`, `textarea`, `select`) DEVE ter `font-size: 16px` para impedir que o iOS aplique zoom automático forçado na tela ao focar.

### Regra 13: Resiliência de Standby no iOS (Reconexão e Reconciliação)
- O WebKit congela conexões quando o PWA fica em background. NUNCA presumir WebSocket permanentemente ativo.
- Ao retomar a atividade (`pageshow`, `visibilitychange`, `focus`, `online`), forçar reconexão se suspenso por > 5s e disparar o ciclo completo de `reconciliarComServidor()`.

### Regra 14: Versionamento Tríplice Coordenado
- Qualquer evolução estrutural deve atualizar `APP_VERSION`, `DB_SCHEMA_VERSION` e o `CACHE_NAME` do Service Worker de forma síncrona.
- Atualizações de Service Worker devem acionar recarga automática via listener de `controllerchange` com proteção contra loop.

### Regra 15: Neutralidade de Operador e Ausência de Dados Sensíveis
- Nomes de operadores nunca devem ser fixados no código-fonte.
- A chave de serviço (`service_role`) NUNCA deve ser incluída no cliente frontend. Logs de sincronização nunca devem imprimir credenciais ou dados sigilosos.

---

## 12. Skills Técnicas Reutilizáveis do Projeto

### Skill 1: Adicionar Nova Entidade ou Tabela Sincronizada ao Supabase
- **Quando usar:** Sempre que o sistema necessitar de uma nova tabela compartilhada entre os dispositivos.
- **Pré-condições:** Entidade mapeada com identificador UUID e campos temporais `created_at` e `updated_at`.
- **Arquivos envolvidos:** `app/schema.sql`, `app/js/state.js`, `app/js/sync_engine.js`, `app/js/supabase.js`.
- **Procedimento:**
  1. No `schema.sql`: Criar a tabela com `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at TIMESTAMPTZ DEFAULT NOW()`, `updated_at TIMESTAMPTZ DEFAULT NOW()`.
  2. Adicionar trigger `trg_[tabela]_updated_at` executando `public.casa_set_updated_at()`.
  3. Adicionar `ALTER TABLE public.[tabela] REPLICA IDENTITY FULL;`.
  4. Adicionar a tabela na publicação `supabase_realtime` via bloco seguro `DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE ... EXCEPTION ... END $$;`.
  5. Habilitar RLS com `ALTER TABLE public.[tabela] ENABLE ROW LEVEL SECURITY;` e criar policy.
  6. No cliente: Mapear a entidade em `state.js`, adicionar listeners em `supabase.js` (`realtimeChannel.on('postgres_changes', ...)`) e incluir reconciliação em `sync_engine.js`.
- **Cuidados:** Nunca esquecer `REPLICA IDENTITY FULL`, caso contrário eventos de `DELETE` não entregarão o ID do registro removido.
- **Erros conhecidos:** Falha no Realtime em DELETE por falta de Replica Identity; erro `22P02` por envio de ID não-UUID.
- **Checklist de validação:** Executar script SQL no console; testar INSERT no terminal A e confirmar chegada imediata no terminal B; testar DELETE e verificar expurgo no terminal B.

---

### Skill 2: Criar e Registrar Operação Idempotente na Outbox
- **Quando usar:** Ao registrar qualquer mutação de dados que precise sincronizar de forma resiliente e à prova de quedas de rede.
- **Pré-condições:** Registro com UUID válido.
- **Arquivos envolvidos:** `app/js/state.js`, `app/js/sync_engine.js`.
- **Procedimento:**
  1. Gerar `operation_id = crypto.randomUUID()` no instante da ação do operador.
  2. Chamar `enfileirarMutacao(tipo, entidade, id, dados)`.
  3. O método atribui o `operation_id` imutável, persiste no `localStorage` e espelha no `IndexedDB`.
  4. Disparar `processarOutbox()` em background sem travar a interface.
- **Cuidados:** Reutilizar o mesmo `operation_id` caso a mesma operação seja reenviada após falha de rede; nunca gerar novo ID para a mesma tentativa de envio.
- **Erros conhecidos:** Duplicação de vendas por criação de IDs novos em cada retry.
- **Checklist de validação:** Desconectar a rede; executar ação; recarregar a página (verificar que a fila persiste intacta); reconectar à rede; confirmar que o job é drenado e aceito pelo Supabase.

---

### Skill 3: Implementar Transação Atômica no PostgreSQL com Bloqueio Pessimista (`FOR UPDATE`)
- **Quando usar:** Em operações que envolvem consumo concorrente de recursos finitos (como estoque de produtos) ou valores financeiros.
- **Pré-condições:** Chave primária UUID e tabela `casa_operacoes_idempotencia` ativa.
- **Arquivos envolvidos:** `app/schema.sql`, `app/js/sync_engine.js`.
- **Procedimento:**
  1. No `schema.sql`: Declarar `CREATE OR REPLACE FUNCTION public.nome_funcao(...) RETURNS JSONB AS $$ ... $$ LANGUAGE plpgsql;`.
  2. No início da função: Verificar se `p_operacao_id` existe em `casa_operacoes_idempotencia`. Se sim, retornar sucesso idempotente.
  3. Executar `SELECT ... INTO ... FROM tabela WHERE id = ... FOR UPDATE;`.
  4. Validar as regras de negócio (ex: `estoque_atual >= p_qtd`). Se violado, lançar `RAISE EXCEPTION`.
  5. Atualizar os registros e inserir o `p_operacao_id` em `casa_operacoes_idempotencia`.
  6. No cliente: Chamar via `state.supabase.rpc('nome_funcao', { ... })`.
- **Cuidados:** Manter a transação curta para não reter locks desnecessariamente; sempre capturar exceções com `try/catch` no cliente.
- **Erros conhecidos:** Vendas simultâneas gerando estoque negativo sem lock; bloqueios mútuos (deadlocks) por locks em ordens diferentes.
- **Checklist de validação:** Tentar vender quantidade maior que o estoque e confirmar ROLLBACK total; testar envio repetido com o mesmo `operation_id` e verificar que não duplica.

---

### Skill 4: Gerenciar Exclusões Seguras com Tombstones
- **Quando usar:** Ao excluir itens do catálogo onde terminais desconectados precisam saber da exclusão no momento em que reconectarem.
- **Pré-condições:** Tabela `casa_tombstones` criada no banco.
- **Arquivos envolvidos:** `app/schema.sql`, `app/js/state.js`, `app/js/sync_engine.js`, `app/js/estoque.js`.
- **Procedimento:**
  1. Ao excluir localmente: Adicionar o ID ao `state.tombstones` e salvar local.
  2. Enfileirar `PRODUTO_DELETE` na Outbox.
  3. No servidor: A RPC `casa_excluir_produto_transacional` grava na tabela `casa_tombstones (entidade, registro_id, deleted_at)` e remove de `casa_produtos`.
  4. Na reconciliação: Baixar `casa_tombstones` e expurgar qualquer resíduo local cujo ID conste nos tombstones.
- **Cuidados:** Se o usuário cadastrar intencionalmente um novo produto com o mesmo ID (improvável com UUID, mas teoricamente possível), remover o ID dos tombstones.
- **Erros conhecidos:** Aparelho offline re-enviando produto excluído por acreditar que era uma criação local (Efeito Zumbi).
- **Checklist de validação:** Excluir no terminal A; no terminal B desligado da rede, abrir o app e reconectar; confirmar que o item some e não é re-enviado para o banco.

---

### Skill 5: Persistir e Recuperar Mídias no IndexedDB sem Estourar a Cota do Safari
- **Quando usar:** Para qualquer armazenamento local de fotos, imagens de produtos ou arquivos pesados no navegador.
- **Pré-condições:** Módulo `app/js/indexed_db.js` importado.
- **Arquivos envolvidos:** `app/js/indexed_db.js`, `app/js/estoque.js`, `app/js/sync_engine.js`.
- **Procedimento:**
  1. Ao capturar/comprimir a foto: Obter o DataURL leve gerado via Canvas.
  2. Chamar `salvarImagemLocal(produtoId, dataUrl)`.
  3. No `localStorage`: Armazenar apenas os dados cadastrais (preço, estoque, nome) e referências leves, mantendo o `localStorage` com poucos kilobytes.
  4. Na renderização: Se a imagem remota não tiver carregado ou o dispositivo estiver offline, chamar `obterImagemLocal(produtoId)` para preencher a miniatura.
  5. Ao excluir o produto: Chamar `removerImagemLocal(produtoId)`.
- **Cuidados:** Tratar navegadores em modo anônimo restrito onde IndexedDB pode falhar silenciosamente, mantendo fallback gracioso.
- **Erros conhecidos:** `QuotaExceededError` no Safari por acumular dezenas de imagens em Base64 no `localStorage`.
- **Checklist de validação:** Cadastrar produto com foto; inspecionar `localStorage` no DevTools e verificar que não contém a string pesada; verificar no Application > IndexedDB que o registro consta em `imagens`.

---

### Skill 6: Sincronizar Arquivos com o Supabase Storage com Fallback Local
- **Quando usar:** Ao enviar fotos de produtos para a nuvem para disponibilizar URLs públicas a todos os terminais conectados.
- **Pré-condições:** Bucket `casa-produtos` criado no Supabase Storage com acesso público.
- **Arquivos envolvidos:** `app/schema.sql`, `app/js/sync_engine.js`.
- **Procedimento:**
  1. Converter DataURL em Blob via `dataURLParaBlob(dataUrl)`.
  2. Fazer upload para o Storage: `state.supabase.storage.from('casa-produtos').upload('produtos/{id}.webp', blob, { upsert: true })`.
  3. Obter URL pública: `state.supabase.storage.from('casa-produtos').getPublicUrl('produtos/{id}.webp')`.
  4. Salvar a URL pública no campo `casa_produtos.imagem`.
  5. Se o upload falhar ou a rede estiver instável: Manter a imagem no cache local IndexedDB e permitir que o produto salve normalmente sem travar a interface.
- **Cuidados:** Configurar corretamente as políticas RLS do Storage para permitir leitura e escrita públicas no bucket.
- **Erros conhecidos:** Erros de CORS ou RLS bloqueando uploads do Storage; tentativa de subir arquivos brutos de câmera de 10MB sem compressão Canvas prévia.
- **Checklist de validação:** Enviar foto; verificar no painel Storage do Supabase que o arquivo `.webp` existe; abrir a URL pública em aba anônima e verificar visualização.

---

### Skill 7: Executar Ciclo de Reconciliação Unificada (`reconciliarComServidor`)
- **Quando usar:** No arranque do app, na retomada de suspensão, na troca de abas e após restabelecimento de conexão.
- **Pré-condições:** Cliente Supabase inicializado.
- **Arquivos envolvidos:** `app/js/sync_engine.js`, `app/js/app.js`.
- **Procedimento:**
  1. Chamar `reconciliarComServidor()` centralizadamente.
  2. O método executa ordenadamente:
     - Drena mutações pendentes da Outbox (`processarOutbox`).
     - Baixa tombstones remotos e purga exclusões locais.
     - Mescla configurações remotas.
     - Baixa produtos remotos e resolve conflitos com base em `updated_at` e mutações locais pendentes.
     - Baixa vendas ativas (ignorando estornos com `estornada = true`).
     - Salva estado local consolidado e aciona re-render limpo da UI sem reload da página.
- **Cuidados:** Nunca forçar recarga da página (`window.location.reload()`) dentro de uma rotina de reconciliação para não gerar loop infinito.
- **Erros conhecidos:** Sobrescrita de edições recém-feitas localmente por dados remotos antigos baixados da nuvem.
- **Checklist de validação:** Modificar dados em outro terminal; alternar de aba no aparelho atual; verificar atualização automática em tela sem F5.

---

### Skill 8: Versionamento e Invalidação de Cache no Service Worker sem Loop de Reload
- **Quando usar:** Ao lançar nova versão da aplicação que inclua alterações em arquivos JavaScript, HTML ou CSS.
- **Pré-condições:** Mudança testada e estável no código.
- **Arquivos envolvidos:** `app/sw.js`, `app/js/app.js`, `FICHA_TECNICA_E_REGRAS_DO_PROJETO.md`.
- **Procedimento:**
  1. Em `app/sw.js`: Incrementar `CACHE_NAME` (ex: `casa-sagrado-v22.0`).
  2. Atualizar a lista `ASSETS_TO_CACHE` com todos os arquivos novos.
  3. No evento `activate`: Garantir a deleção de todas as chaves de cache que sejam diferentes do `CACHE_NAME` atual e chamar `self.clients.claim()`.
  4. Em `app/js/app.js`: No evento `controllerchange`, utilizar uma trava booleana (`let reloading = false; if (!reloading) { reloading = true; window.location.reload(); }`) para recarregar a página apenas uma vez quando o novo SW assumir o controle.
- **Cuidados:** Nunca omitir a trava `reloading`, caso contrário o navegador entrará em loop contínuo de recarregamentos.
- **Erros conhecidos:** Usuários presos indefinidamente em versões antigas do JavaScript por causa de caches estáticos não invalidados.
- **Checklist de validação:** Atualizar versão; recarregar no navegador; verificar no DevTools > Application > Cache Storage que apenas a nova pasta de cache permanece.

---

### Skill 9: Blindar Compatibilidade Mobile para iPhone (Safari WebKit) e Android (Chrome)
- **Quando usar:** Em todas as intervenções de interface, layout, formulários e ciclo de vida.
- **Pré-condições:** Visualização responsiva mobile-first.
- **Arquivos envolvidos:** `app/css/base.css`, `app/css/components.css`, `app/css/modals.css`, `app/js/app.js`, `app/index.html`.
- **Procedimento:**
  1. Em todos os inputs: Aplicar `font-size: 16px` para impedir que o Safari do iPhone aplique zoom automático forçado ao focar.
  2. Em elementos fixos nas bordas: Aplicar padding com `--safe-top: env(safe-area-inset-top)` na barra superior e `--safe-bottom: env(safe-area-inset-bottom)` na barra inferior e rodapés de modais.
  3. No ciclo de vida: Escutar `pageshow` além de `visibilitychange` para capturar a retomada do bfcache do iOS.
  4. Para instalação no iPhone: Exibir modal ilustrado explicativo de instalação ("Compartilhar > Adicionar à Tela de Início").
- **Cuidados:** Nunca usar `-webkit-fill-available` ou `100vh` clássico desvinculado de `--app-height`.
- **Erros conhecidos:** Botões de navegação escondidos atrás do Home Indicator do iPhone; título encoberto pela Dynamic Island; zoom automático indevido no Safari.
- **Checklist de validação:** Testar foco em campos de texto sem zoom; verificar espaçamento acima do Home Indicator do iPhone.

---

### Skill 10: Validar e Restaurar Backup JSON com Prevenção de Conflitos
- **Quando usar:** Ao restaurar dados comerciais de um backup exportado em arquivo JSON.
- **Pré-condições:** Arquivo `.json` válido gerado pela rotina de exportação do sistema.
- **Arquivos envolvidos:** `app/js/supabase.js`, `app/index.html`.
- **Procedimento:**
  1. Ler o arquivo com `file.text()` e executar `JSON.parse` encapsulado em `try/catch`.
  2. Validar o schema básico: verificar se `produtos` e `vendas` são arrays.
  3. Exibir modal de confirmação in-app (`pedirConfirmacao`) informando a quantidade exata de produtos e vendas contidos no arquivo.
  4. Ao confirmar: Higienizar todos os IDs com `garantirUUID()`.
  5. Mesclar com as coleções existentes evitando duplicatas de ID (`new Set(state.produtos.map(p => p.id))`).
  6. Persistir localmente via `salvarLocal()` e acionar `reconciliarComServidor()` para sincronizar os dados restaurados com o banco.
- **Cuidados:** Nunca sobrescrever o estado local sem confirmação explícita do operador; nunca permitir que IDs legados malformados subam ao Postgres.
- **Erros conhecidos:** Corrupção do banco por importação de arquivos malformatados ou restauração silenciosa de vendas duplicadas.
- **Checklist de validação:** Exportar backup; excluir itens locais; importar backup; confirmar que os dados voltam sem duplicações e respeitando UUIDs.

---

### Skill 11: Executar Matriz de Testes de Sincronização Multi-Dispositivo
- **Quando usar:** Antes de liberar qualquer versão para ambiente de produção comercial.
- **Pré-condições:** Dois dispositivos (ou duas abas anônimas distintas simulando dispositivos A e B) conectados ao mesmo Supabase.
- **Arquivos envolvidos:** Todos os módulos de teste.
- **Procedimento:**
  1. **Teste 1 (Cadastro Cruzado):** A cadastra produto -> B recebe via Realtime sem F5.
  2. **Teste 2 (Edição Concorrente):** B edita preço -> A atualiza sem sobrescrever alterações locais mais recentes.
  3. **Teste 3 (Exclusão Segura):** A exclui produto -> B recebe DELETE; B fecha e abre novamente sem ressuscitar o produto.
  4. **Teste 4 (Venda e Estoque):** Produto com estoque = 1; A vende 1 unidade -> estoque em B zera e venda aparece no histórico de B.
  5. **Teste 5 (Estorno Único):** B estorna a venda -> estoque volta a 1 em A e B; tentativa de novo estorno é bloqueada.
  6. **Teste 6 (Resiliência Offline):** Desconectar internet de A -> registrar venda em A -> reconectar internet -> Outbox drena e B recebe a venda.
  7. **Teste 7 (Suspensão):** Bloquear terminal B por 30s -> A realiza venda -> B desbloqueia -> reconciliação recupera a venda em B.
  8. **Teste 8 (Coleção Vazia):** Limpar vendas em A -> B converge para lista vazia `[]` e não re-envia vendas antigas.
- **Cuidados:** Validar se não há erros no console do navegador durante cada transição.
- **Erros conhecidos:** Falha silenciosa de WebSocket mascarada por falta de reconexão manual.
- **Checklist de validação:** Todos os 8 testes executados com 100% de convergência.

---

## 13. Histórico Completo de Falhas, Causas-Raiz e Aprendizados

| # | Falha Identificada | Sintoma no Aplicativo | Causa Técnica | Solução Aplicada | Como Evitar Regressão |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **1** | **Ressurreição Zumbi em DELETE** | Dispositivo B re-inseria produto excluído pelo Dispositivo A ao abrir o app. | `baixarDadosIniciaisNuvem()` presumia que itens locais ausentes na nuvem eram criações offline e fazia re-upload automático. | Outbox Pattern + Tabela `casa_tombstones`. Só envia criações se constarem na fila Outbox. Itens ausentes remotos fora da Outbox são expurgados. | Seguir **Regra 2** e **Skill 4**: nunca inferir intenção de criação apenas pela ausência do registro no servidor. |
| **2** | **Ressurreição ao Limpar Vendas** | Limpar todas as vendas no terminal A fazia o terminal B re-enviar todas ao abrir. | Mesma dedução errônea de ausência em coleções vazias (`[]`), interpretando array vazio como falha de sincronização. | Lista vazia remota respeitada como estado oficial válido; Outbox só permite envio de mutações registradas explicitamente. | Seguir **Regra 9**: arrays vazios são estados legítimos no banco de dados. |
| **3** | **Erro 22P02 no Postgres** | Vendas legadas travavam inserção com `invalid input syntax for type uuid`. | Uso de IDs textuais com prefixo (`venda_172...`) colidindo com coluna nativa `UUID` no banco de dados. | Sanitização estrita com `crypto.randomUUID()`, regex de validação e descarte de prefixos legados. | Seguir **Regra 10**: todas as entidades devem utilizar estritamente UUID v4. |
| **4** | **Queda do WebSocket no Mobile** | Após deixar o aparelho bloqueado, Realtime parava de receber eventos sem F5 manual. | O sistema operacional móvel congela WebSockets em standby sem reconectar automaticamente ao acordar. | `garantirConexaoRealtime()` vinculada aos eventos `visibilitychange`, `pageshow`, `focus` e `online` com force reconnect > 5s. | Seguir **Regra 13**: nunca presumir WebSocket permanentemente ativo em dispositivos móveis. |
| **5** | **Erro em Supabase Builder** | Estorno travava ao chamar `.catch()` em construtor de consulta do Supabase. | `PostgrestFilterBuilder` não implementa `.catch()`, disparando `TypeError` que quebrava a thread JavaScript. | Encapsulamento estrito com blocos nativos `try/catch` com `async/await` em todas as chamadas de banco. | Seguir **Regra 8**: NUNCA encadear `.catch()` diretamente em builders do Supabase. |
| **6** | **Scroll Mobile Preso** | Na Curva ABC e no Markup, a rolagem não passava de certos botões em telas pequenas. | Uso de `100vh` clássico ignorando a barra de navegação dinâmica do Android. | Vinculação dinâmica `--app-height` ao `window.innerHeight`, `100dvh` e respiros inferiores calculados. | Seguir **Regra 11**: utilizar sempre viewport dinâmico e modo standalone. |
| **7** | **Venda e Estoque Não-Transacionais** | Risco de concorrência com estoque = 1 e dois celulares vendendo ao mesmo tempo. | Venda e baixa eram duas chamadas HTTP separadas no cliente sem transação atômica no banco de dados. | RPC PostgreSQL `casa_registrar_venda_transacional` com bloqueio `SELECT ... FOR UPDATE` e constraint `estoque_atual >= 0`. | Seguir **Regra 4** e **Skill 3**: toda mutação de estoque concorrente deve ser atômica no PostgreSQL. |
| **8** | **Estorno Sem Soft-Delete e Duplo Estorno** | Dois operadores clicando em estorno podiam devolver estoque em dobro e apagar o histórico. | Hard delete direto na tabela `casa_vendas` sem trava de idempotência. | Soft-delete (`estornada = true`) e RPC `casa_estornar_venda_transacional` com bloqueio de linha e validação de execução única. | Seguir **Regra 5**: vendas estornadas devem ser preservadas com flag de soft-delete. |
| **9** | **Cota de LocalStorage no Safari** | Fotos de alta resolução ameaçavam estourar os ~5MB do `localStorage` do iOS. | Armazenamento integral das imagens em Base64 dentro de chaves do `localStorage`. | Cache de fotos migrado para **IndexedDB** local (`casa_sagrado_db.imagens`) e **Supabase Storage** (`casa-produtos`) na nuvem. | Seguir **Regra 7** e **Skill 5**: mídias pesadas devem ser gerenciadas em IndexedDB e Storage. |
| **10** | **Deleções Perdidas em Standby Longo** | Aparelho desligado por horas perdia eventos Realtime DELETE e não sabia o que foi apagado. | Supabase Realtime não armazena histórico de eventos para clientes desconectados. | Tabela `casa_tombstones` persistente consultada no início de cada rotina de reconciliação. | Seguir **Regra 6** e **Skill 4**: exclusões devem gerar tombstones consultáveis na reconciliação. |
| **11** | **Chamada a Método Obsoleto no Heartbeat** | O timer periódico de 25s disparava erro de referência em runtime. | O método legado `processarFilaSync()` continuava sendo invocado no `app.js` após a migração para a nova arquitetura. | Substituição completa pela rotina `sincronizarTudoSilenciosamente()` que invoca `processarOutbox()` e `reconciliarComServidor()`. | Realizar sempre varredura de código morto após grandes refatorações antes de consolidar a versão. |
| **12** | **Cache do Service Worker Travando Novos Exports** | Browser carregava módulos antigos do cache `v22.0` acusando ausência de export recém-criado. | O Service Worker utilizava nome de cache antigo e não forçava reload imediato de scripts ESM. | Versão do cache alterada para `casa-sagrado-v23.0`, listener `controllerchange` com reload automático e estratégia Network-First estrita para todo `/js/` e `/css/`. | Sempre incrementar `CACHE_NAME` no `sw.js` a cada evolução estrutural de arquivos de script. |

---

## 14. Regras de Negócio e Arquitetura de Variações, Subcategorias e Fotos (v23.1)

### 14.1. Hierarquia de Categorias e Subcategorias
- **Obrigatoriedade:** Categoria principal é obrigatória; Subcategoria é estritamente opcional.
- **Vinculação:** Toda subcategoria pertence a uma categoria pai.
- **Criação sem sair do fluxo:** Botões `+ Nova` inline no cadastro de produtos abrem diálogos limpos e atualizam os seletores imediatamente sem perder os dados já preenchidos.
- **Filtros Independentes:** Na vitrine do catálogo e no estoque, selecionar uma categoria exibe pílulas horizontais com as subcategorias filhas correspondentes.

### 14.2. Sistema de Variações Livres e Combinações Cartesianas
- **Opcionalidade:** Produtos simples sem variação continuam funcionando com `tem_variacoes = false` e estoque único em `estoque_atual`.
- **Tipos Livres:** Nomes de dimensões abertos (Cor, Tamanho, Aroma, Material, etc.) sem restrições em código.
- **Tags Rápidas:** Digitação do valor + Enter adiciona chips visuais que podem ser removidos com 1 toque.
- **Produto Cartesiano:** As combinações são recalculadas preservando valores de estoque, preço e SKU já digitados anteriormente pelo usuário.
- **Estoque Total Agregado:** Para produtos com variações, `estoque_atual` do produto principal reflete a soma atômica das variantes vendáveis.

### 14.3. Ponto de Venda e Baixa de Estoque por Variante
- **Seleção Tátil:** Clicar num produto com variações abre modal com chips de cada dimensão.
- **Validação de Saldo:** Combinações sem saldo exibem `0 un (Sem estoque)` e desabilitam o botão de avanço.
- **Baixa Específica:** A venda é vinculada a `variante_id`, e a RPC `casa_registrar_venda_transacional` decrementa o saldo daquela variante dentro do array `variantes` no PostgreSQL, atualizando também o `estoque_atual` total do produto.

### 14.4. Cropper Nativo 1:1 e Preservação de Alta Resolução
- **Sem Dependências Pesadas:** Implementado em Vanilla JS + HTML5 Canvas com Pointer/Touch events para drag/pan e pinch-to-zoom.
- **Proporção 1:1:** Viewport quadrado com grid sutil e prévia em tempo real idêntica ao card do catálogo.
- **Preservação do Original:** A imagem original é salva no store `imagens_originais` do IndexedDB v2. O recorte gera WebP 600x600 otimizado. Ao editar o produto, o botão `Enquadrar` restaura a imagem original e os parâmetros `foto_crop` para reenquadramento sem compressões cumulativas degradantes.

### 14.5. Sistema de Foto por Variação e Combinação (v23.1)
- **Princípio Central:** "Uma imagem pode representar o produto inteiro, um valor de variação ou uma combinação específica, sem obrigar o usuário a cadastrar imagens redundantes."
- **Hierarquia Estrita de Resolução de Imagens (`obterImagemProdutoResolvida`):**
  $$\text{1. Foto da Combinação Específica} \;\to\; \text{2. Foto do Valor da Dimensão (ex: Cor: Branca)} \;\to\; \text{3. Foto Principal do Produto} \;\to\; \text{4. Placeholder}$$
  Essa função centralizada em [`app/js/utils.js`](file:///c:/Users/Malone/OneDrive/Área%20de%20Trabalho/Antigravity/Empreender/Loja%20de%20Artigos%20Religiosos/app/js/utils.js) é consumida de forma uniforme pelo PDV, seleção de variação, catálogo, carrinho e relatórios.
- **Associação por Valor de Dimensão (Evita Duplicações):** Se a variação visual for Cor ("Branca", "Vermelha", "Preta") e o produto tiver múltiplos tamanhos (12cm, 16cm, 18cm), a foto associada à cor "Branca" é automaticamente herdada por todos os tamanhos daquela cor sem necessidade de uploads redundantes.
- **Associação por Combinação Específica (Override Opcional):** Se uma variante específica necessitar de foto própria (ex: "Branca / 18 cm"), ela pode receber uma imagem individual com precedência máxima sobre a foto geral da cor.
- **Zero Obrigatoriedade e Compatibilidade:** O cadastro de fotos por variação é 100% opcional. Se nenhuma foto de variação for enviada, o produto utiliza a foto principal. A exclusão de uma foto de variação jamais afeta a foto principal do produto.
- **Seleção de Origem Mobile-First:** Action sheet intuitivo (`#modalOrigemFoto`) permitindo escolher entre captura direta com a câmera (`capture="environment"`) ou selecionar da galeria de fotos.
- **Reenquadramento Sem Perda para Todas as Variações:** Cada foto de valor ou de combinação preserva seu arquivo original não-comprimido em `IndexedDB.imagens_originais` com chaves compostas previsíveis (`${prodId}_val_${varId}_${val}` e `${prodId}_comb_${combId}`), permitindo ao operador reabrir o cropper e reenquadrar a qualquer momento sem degradação cumulativa.
- **Sincronização Assíncrona com Supabase Storage:** O motor de sincronização (`sync_engine.js`) identifica fotografias locais em Base64 dentro das estruturas `variacoes` e `variantes`, converte para Blob WebP e realiza upload determinístico para o bucket `casa-produtos` sob os caminhos `produtos/{id}_val_...` e `produtos/{id}_comb_...`, atualizando os metadados com URLs públicas sem interromper a usabilidade do PDV ou a operação offline.


---

## 16. Arquitetura da Base de Dados para Inteligência (Google Sheets API v4 — v23.2)

### 16.1. Princípio de Arquitetura e Unidirecionalidade Estrita
- **Supabase é a Fonte da Verdade:** O PostgreSQL do Supabase permanece como o único repositório oficial da verdade operacional. Nenhuma operação de PDV, estoque, preço, custo, venda, fechamento, reserva ou autenticação consulta o Google Sheets.
- **Fluxo de Dados Unidirecional:**
  $$\text{PWA (PDV)} \;\longrightarrow\; \text{Supabase PostgreSQL} \;\longrightarrow\; \text{Edge Function (sync-google-sheets)} \;\longrightarrow\; \text{Google Sheets} \;\longrightarrow\; \text{IA Futura (Leitura)}$$
- **Isolamento de Falhas:** Caso a API do Google Sheets esteja indisponível, a quota seja excedida ou haja falha de rede, a operação de vendas e o estoque continuam operando normalmente no PDV. A falha é registrada em `casa_intelligence_sync_state` para retentativa posterior.
- **Reconstruibilidade Total:** Caso a planilha seja acidentalmente apagada ou corrompida, o operador pode acionar *"Reconstruir Planilha Completa (Do Zero)"* ou configurar um novo `GOOGLE_SPREADSHEET_ID` para repopular todo o histórico desde o início.

### 16.2. Estrutura das 8 Abas Padronizadas (Contrato Estável para IA)
A planilha é formatada como um mini Data Warehouse, sem células mescladas, sem linhas em branco no meio dos dados e com cabeçalhos padronizados e imutáveis:

1. **`_Metadata`:** `schema_version`, `last_sync_at`, `application_version`, `timezone`, `sync_provider`, `sync_mode`, `total_vendas_sync`, `total_produtos_sync`, `total_variantes_sync`.
2. **`Vendas`:** `sale_id`, `data_hora`, `data`, `hora`, `operador`, `subtotal`, `desconto`, `total`, `forma_pagamento`, `custo_total`, `lucro_bruto`, `valor_reserva`, `status`, `created_at`, `updated_at`.
3. **`Itens_Venda`:** `sale_item_id`, `sale_id`, `product_id`, `variant_id`, `produto`, `categoria`, `subcategoria`, `variacao_nome`, `atributos_json`, `quantidade`, `preco_unitario`, `custo_unitario`, `preco_total`, `custo_total`, `lucro_bruto`, `created_at`.
4. **`Produtos`:** `product_id`, `nome`, `categoria`, `subcategoria`, `tem_variacoes`, `sku`, `custo`, `preco`, `estoque_atual`, `estoque_minimo`, `ativo`, `created_at`, `updated_at`.
5. **`Variantes`:** `variant_id`, `product_id`, `produto`, `sku_variant`, `nome_variacao`, `atributos_json`, `cor`, `tamanho`, `custo`, `preco`, `estoque_atual`, `estoque_minimo`, `ativo`, `created_at`, `updated_at`.
6. **`Movimentacoes_Estoque`:** `movement_id`, `data_hora`, `product_id`, `variant_id`, `produto`, `variacao_nome`, `tipo_movimentacao`, `quantidade`, `motivo`, `sale_id`, `custo_unitario`, `created_at`.
7. **`Estoque_Atual`:** `product_id`, `variant_id`, `tipo_item`, `produto`, `variante`, `categoria`, `subcategoria`, `estoque_atual`, `estoque_minimo`, `custo_unitario`, `preco_venda`, `valor_imobilizado_custo`, `valor_potencial_venda`, `status_estoque`, `ultima_atualizacao`.
8. **`Reserva_Caixinha`:** `reserva_id`, `data_hora`, `sale_id`, `tipo`, `valor`, `descricao`, `operador`, `created_at`.

### 16.3. Autenticação por Service Account com Web Crypto RS256 Nativo
- **Zero Credenciais Privadas no Frontend:** Nenhuma chave privada ou segredo do Google transita pelo navegador ou consta no bundle cliente.
- **Assinatura RS256 em Deno:** A Edge Function [`supabase/functions/sync-google-sheets/index.ts`](file:///c:/Users/Malone/OneDrive/Área%20de%20Trabalho/Antigravity/Empreender/Loja%20de%20Artigos%20Religiosos/supabase/functions/sync-google-sheets/index.ts) converte a chave privada PEM PKCS#8 para binário e assina o JWT utilizando nativamente `crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, message)`.
- **Token Bearer:** O JWT assinado é trocado no endpoint `https://oauth2.googleapis.com/token` pelo token de acesso OAuth 2.0 com escopo `https://www.googleapis.com/auth/spreadsheets`.

### 16.4. Supabase Secrets e Configuração no Google Cloud Console
Para ativar a integração:
1. No [Google Cloud Console](https://console.cloud.google.com/):
   - Crie um projeto (ex: `casa-sagrado-bi`).
   - Ative a **Google Sheets API** na biblioteca de APIs.
   - Em *Credenciais* -> *Contas de Serviço*, crie uma Service Account (ex: `sheets-sync@casa-sagrado-bi.iam.gserviceaccount.com`).
   - Em *Chaves*, gere uma nova chave no formato **JSON**.
2. No Google Sheets:
   - Crie a planilha no Google Drive.
   - Compartilhe a planilha com o e-mail da Service Account com permissão de **Editor**.
   - Copie o **Spreadsheet ID** contido na URL (`https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit`).
3. No Supabase (via CLI ou Dashboard -> *Project Settings* -> *Secrets*):
   ```bash
   supabase secrets set GOOGLE_SERVICE_ACCOUNT_EMAIL="sheets-sync@casa-sagrado-bi.iam.gserviceaccount.com"
   supabase secrets set GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
   supabase secrets set GOOGLE_SPREADSHEET_ID="seu_spreadsheet_id_aqui"
   ```

### 16.5. Deploy da Edge Function e Supabase Cron
- **Comando de Deploy:**
  ```bash
  supabase functions deploy sync-google-sheets --no-verify-jwt
  ```
- **Supabase Cron (Execução Periódica):**
  - No Dashboard do Supabase -> *Edge Functions* -> *Scheduled Triggers* -> configure o Cron `0 * * * *` (a cada 1 hora).
  - O intervalo é livremente modificável no Supabase sem necessidade de alterar o código-fonte da aplicação.

### 16.6. Interface Administrativa no PWA
- No modal de sincronização (`#modalSync`), o operador dispõe de um card dedicado:
  - **Badge Dinâmico:** Sincronizado (verde), Sincronizando (amarelo), Falha (vermelho), Ocioso (cinza).
  - **Última Sincronização:** Data e hora no fuso horário do Brasil.
  - **Botão `Sincronizar Google Sheets Agora`:** Executa a sincronização incremental via Edge Function.
  - **Botão `Reconstruir Planilha Completa (Do Zero)`:** Limpa as abas e remonta a base histórica integral a partir do banco de dados com confirmação prévia in-app.

---

## 17. Sistema de SKU Automático, Código Comercial e Unicidade Global (v23.3)

### 17.1. Princípio Fundamental de Arquitetura
> **"ID identifica tecnicamente o registro. SKU identifica comercialmente o item."**
- O ID técnico (`UUID` gerado no cliente e persistido como Chave Primária no Supabase) continua sendo o identificador técnico estrito de todas as relações internas, integridade referencial e mutações na Outbox.
- O **SKU** funciona como o código comercial e operacional da loja: legível, pesquisável, estável, editável, único e exportável para inteligência de dados (Google Sheets) e futura rotulagem/etiquetagem física.

### 17.2. Geração Automática e Estrutura dos Códigos
- **Formato do SKU Base:** `[PREFIXO]-[SEQUÊNCIA]` (Ex: `VEL-000101`, `DEF-000102`, `IMA-000103`, `ART-000104`).
  - **Prefixo:** 3 letras maiúsculas derivadas da Categoria Principal ou Nome do Produto, limpo de acentos, diacríticos e caracteres especiais (`normalize("NFD")`). Fallback padrão: `ART`.
  - **Sequência Única:** 6 dígitos decimais formatados com zeros à esquerda. No PostgreSQL, governado pela sequence atômica `casa_sku_seq` (iniciada em 1001). No frontend, autoincrementado defensivamente varrendo todos os números em uso.
- **Formato do SKU por Variante Vendável:** `[SKU_BASE]-[SUFIXO_ATRIBUTOS]` (Ex: `VEL-000101-BRA-18`, `VEL-000101-PRE-18`, `DEF-000102-01`).
  - Sufixo gerado extraindo até 3 caracteres maiúsculos alfanuméricos de cada atributo (Cor, Tamanho, Aroma). Se não houver texto suficiente, utiliza índice de 2 dígitos.

### 17.3. Imutabilidade e Estabilidade Histórica (Regra de Ouro)
- Depois que o SKU for gerado ou salvo:
  - Alterar o Nome do Produto **NUNCA** recalcula o SKU.
  - Alterar a Categoria ou Subcategoria **NUNCA** recalcula o SKU.
  - Alterar o Nome de uma Opção de Variação (ex: de "Preta" para "Preto") **NUNCA** altera o SKU da variante existente.
  - O SKU só é alterado se o operador explicitamente editar o campo.
  - Isso garante estabilidade absoluta para histórico de vendas, integrações com Google Sheets e etiquetas impressas.

### 17.4. Criação Incremental de Variantes e Desacoplamento de Exclusões
- Quando novas combinações forem criadas em um produto com variações já existentes (ex: adicionar "Azul / 18 cm"):
  - As variantes antigas preservam rigorosamente seus SKUs originais.
  - Somente a nova combinação recebe um novo SKU gerado.
- Exclusão e recriação: variantes excluídas não liberam seus SKUs para reuso automático imediato, preservando a rastreabilidade histórica.

### 17.5. Separação Estrita entre SKU e Código de Barras
- **Campos Separados no Schema e na Interface:**
  - `sku`: Código comercial interno da loja (`products.sku` / `product_variants.sku`).
  - `codigo_barras`: Campo independente para código de barras do fabricante ou escaneável (`products.codigo_barras` / EAN, GTIN, UPC).
  - O sistema não preenche automaticamente o código de barras com o SKU sem uma decisão expressa.

### 17.6. Busca Multi-Fator Integrada
- O mecanismo de busca nos módulos **Catálogo (Vitrine)**, **Estoque** e **PDV** localiza produtos e variantes por qualquer um dos seguintes critérios combinados:
  1. Nome do produto;
  2. Categoria principal;
  3. Subcategoria;
  4. SKU base do produto;
  5. SKU específico da variante;
  6. Código de barras.

### 17.7. Unicidade Global e Proteção no Banco de Dados
- **Namespace Global Único:** O sistema impede que dois produtos tenham o mesmo SKU, que duas variantes tenham o mesmo SKU, ou que uma variante compartilhe o mesmo SKU base do produto.
- **Validação Dupla (Frontend + Backend):**
  - **Frontend:** Função `validarUnicidadeSku(sku, produtoId, varianteId)` valida antes de salvar e emite alerta amigável na UI.
  - **Banco de Dados (PostgreSQL):**
    - Unique index parcial: `CREATE UNIQUE INDEX idx_casa_produtos_sku_unique ON public.casa_produtos(sku) WHERE sku IS NOT NULL;`
    - Trigger defensiva `trg_casa_produtos_garantir_sku`: gera SKU automático via `casa_gerar_sku()` caso inserido nulo ou vazio.
    - Backfill idempotente: script de migração popula com segurança SKUs únicos em produtos e variantes legadas.

### 17.8. Snapshot de Vendas e Google Sheets
- **Venda Registrada:** A tabela `casa_vendas` e a RPC `casa_registrar_venda_transacional` armazenam o snapshot do SKU vendido (`sku TEXT`) no exato momento da venda. Se o SKU do produto for alterado futuramente, as vendas anteriores permanecem íntegras.
- **Google Sheets:**
  - Aba `Produtos`: exporta coluna `sku`.
  - Aba `Variantes`: exporta coluna `sku_variant`.
  - Aba `Itens_Venda`: exporta coluna `sku` do item comercial vendido.

---

## 18. Matriz de Testes de Regressão e Falhas Permanentes

1. **Cadastro Cruzado:** Android cria produto com foto e SKU automático -> iPhone recebe via Realtime e exibe na vitrine sem recarregar.
2. **Edição Concorrente:** iPhone edita preço -> Android recebe e atualiza sem sobrescrever alterações locais mais novas.
3. **Exclusão sem Ressurreição:** Android exclui produto -> iPhone acorda do standby e remove o produto sem re-enviar para a nuvem.
4. **Venda Simultânea com Estoque 1:** Ambos tentam vender o último item -> Servidor aceita apenas um; o outro recebe erro de estoque insuficiente e não gera venda.
5. **Estorno Único:** iPhone estorna venda -> estoque volta 1x; tentativa simultânea no Android é rejeitada pelo banco.
6. **Resiliência Offline:** Android fica offline -> registra venda -> volta à rede -> Outbox drena e iPhone recebe.
7. **Retomada iOS do Standby:** iPhone fica bloqueado por minutos -> Android realiza operações -> iPhone desbloqueia -> reconciliação recupera todos os dados perdidos.
8. **Lista Vazia Íntegra:** Limpar todas as vendas -> fechar ambos os apps -> abrir novamente -> lista permanece vazia (`[]`).
9. **Exportação & Restauração:** Exportar backup JSON -> restaurar em outro aparelho -> dados convergem com validação completa e sem duplicações.
10. **Preservação de UI e Cálculos:** Todas as máscaras monetárias, cálculos de Markup Divisor, Curva ABC, Reserva e Custos Fixos operam com 100% de precisão.
11. **Geração e Estabilidade de SKU:** Cadastrar produto -> SKU automático é gerado -> renomear produto -> SKU permanece rigorosamente inalterado.
12. **Criação Incremental de Variantes:** Criar novas variantes posteriores -> somente a nova combinação recebe novo SKU; antigas não são regeneradas.
13. **Bloqueio de SKU Duplicado:** Tentar salvar produto ou variante com SKU já em uso -> sistema bloqueia com mensagem explicativa.
14. **Busca por SKU no PDV:** Digitar SKU completo ou parcial no campo de busca do PDV/Estoque -> produto/variante correspondente é localizado imediatamente.
15. **Atualizar Este Terminal sob Demanda:** Tocar no botão -> o sistema verifica o Service Worker (`registration.update()`), detecta assets novos, despacha `SKIP_WAITING`, aguarda `controllerchange` e recarrega uma única vez sem loop.
16. **Terminal Já Atualizado:** Tocar no botão quando o terminal já executa a versão mais recente -> o sistema informa amigavelmente que o terminal está atualizado e **não** recarrega a página desnecessariamente.
17. **Atualização Remota Global:** Admin clica em "Atualizar todos os terminais" -> Supabase grava release estruturado em `casa_configuracoes` (`versao_app`), envia broadcast e os demais aparelhos detectam a nova versão mesmo acordando de tela bloqueada (`pageshow` / `visibilitychange`).
18. **Preservação de Vendas e Outbox:** Disparar atualização com mutações pendentes na Outbox -> o código e assets são renovados sem qualquer perda de dados locais (`localStorage`, `IndexedDB`, `syncQueue`).

---

## 19. Sistema de Atualização, Versionamento e Ciclo de Vida do Service Worker (v23.4.1)

### 19.1. Autoridade Absoluta do Servidor e Valores Oficiais
Para eliminar o risco de um terminal antigo impor versão aos demais, o cliente **nunca** define a versão da aplicação. A autoridade oficial é estritamente o deploy/servidor através de dois artefatos:
1. **Manifesto do Servidor ([`app/version.json`](file:///c:/Users/Malone/OneDrive/Área%20de%20Trabalho/Antigravity/Empreender/Loja%20de%20Artigos%20Religiosos/app/version.json)):**
   - Publicado no servidor com a versão real do deploy (`version: "23.4"`, `build_id: "20260921-001500"`).
   - **Bypass de Cache:** O Service Worker NUNCA armazena `version.json` em cache (`cache: 'no-store'`).
2. **Constantes da Aplicação Local ([`app/js/version.js`](file:///c:/Users/Malone/OneDrive/Área%20de%20Trabalho/Antigravity/Empreender/Loja%20de%20Artigos%20Religiosos/app/js/version.js)):**
   - `APP_VERSION = "23.4"`
   - `BUILD_ID = "20260921-001500"`
   - `DB_SCHEMA_VERSION = 23`
   - `CACHE_NAME = "casa-sagrado-v23.4"`

### 19.2. Separação Conceitual Rígida
- **Sincronização de Dados (`reconciliarComServidor`):** Trata de produtos, vendas, categorias, tombstones e fila Outbox. Não atualiza código.
- **Pedido Global de Atualização (`app_update_request`):** Não contém versão. É apenas um pulso informando: *"Verifiquem o servidor"*.
- **Código do Aplicativo:** Reside no servidor e é gerenciado pelo Service Worker.

### 19.3. Bloqueio Absoluto de Downgrade Automático
- Implementação de `compararVersoesSemanticas(v1, v2)` para evitar falhas de ordenação numérica.
- Se a versão do servidor for inferior à versão instalada no terminal (`comp < 0`):
  - A atualização é **sumariamente bloqueada**.
  - Log emitido: `[UPDATE] Versão do servidor (vX) é inferior à versão instalada (vY). Downgrade automático bloqueado.`
  - Nenhuma recarga ocorre e nenhum cache é excluído.

### 19.4. Sinalização Remota sem Transmissão de Versão ("Solicitar Atualização em Todos os Terminais")
- Quando qualquer terminal (mesmo um celular antigo executando v21 ou v22) clica em **"Solicitar atualização em todos os terminais"**:
  1. Gera um UUID único (`request_id`).
  2. Publica no Supabase (`casa_configuracoes` chave `app_update_request`) e emite broadcast:
     ```json
     {
       "request_id": "UUID-v4",
       "requested_at": "2026-09-21T00:15:00Z",
       "requested_by_device": "device-id",
       "operador": "Operador"
     }
     ```
  3. **Zero versão é transmitida.**
  4. Cada terminal receptor recebe o sinal, consulta diretamente o servidor (`GET /version.json`), compara com sua versão local e decide se atualiza.
  5. Terminais já na versão mais recente permanecem nela sem sofrer reload.

### 19.5. Detecção em Terminais Suspensos (iOS Safari WebKit / Android)
- Terminais que estavam bloqueados ou em segundo plano durante o broadcast detectam o `request_id` pendente assim que voltam à atividade:
  - `visibilitychange` (retorno da aba);
  - `pageshow` (retorno do cache de suspensão do iOS Safari);
  - `focus` (foco da janela / desbloqueio);
  - `online` (restabelecimento de Wi-Fi ou dados móveis);
  - `reconciliarComServidor()` (passo 3 da reconciliação periódica).

### 19.6. Ciclo de Vida do Service Worker e Proteção de Reload
- `registration.update()` obrigatório com `{ updateViaCache: 'none' }`.
- Detecção e despacho controlado de `SKIP_WAITING` para workers em `waiting` ou `installing`.
- Ouvinte único de `controllerchange` com flag de proteção `reloading = false`.
- Reload acontece exatamente uma única vez, e apenas após o novo Service Worker assumir o controle.
- Se o terminal já estiver atualizado, exibe mensagem informativa e **não** recarrega.

### 19.7. Inviolabilidade do Estado Local e Operação do PDV
- Vendas em andamento e modais críticos de checkout/produto **nunca** são interrompidos abruptamente; o sistema exibe notificação amigável para atualizar após a conclusão.
- Proibição absoluta de `localStorage.clear()` ou exclusão de IndexedDB durante atualizações.
- A fila Outbox pendente (`state.syncQueue`), fotos locais e dados de negócio são 100% preservados.

### 19.8. Painel Diagnóstico no Modal de Sincronização
A interface administrativa exibe em tempo real:
- **Versão deste Terminal:** `v23.4 (20260921-001500)`
- **Versão no Servidor:** `v23.4 (20260921-001500)`
- **Status da Versão:** badge `Atualizado`, `Atualização disponível` ou `Downgrade bloqueado`
- **Service Worker:** `Ativo (Controlando)`
- **Último Pedido Global:** data/hora e operador do último `request_id` processado
- **Botões Claros:**
  - *"Buscar versão mais recente neste terminal"*
  - *"Solicitar atualização em todos os terminais"*


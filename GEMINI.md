# Casa do Sagrado — Regras de Projeto, Arquitetura e Aprendizados da IA
**Versão Atual Estável:** `v22.0` (Arquitetura Comercial Transacional, Outbox Idempotente, Multi-Tier Storage e Multi-Dispositivo Resiliente)  
**Data de Consolidação:** 20 de Setembro de 2026  

Este documento define as diretrizes técnicas, regras de arquitetura, padrões visuais e lições aprendidas consolidadas no desenvolvimento do sistema **Casa do Sagrado**. Todo assistente ou agente operando neste repositório DEVE seguir estas regras rigorosamente para evitar regressões.

---

## 1. Identidade e Filosofia do Projeto
- **Sistema:** Gestão Comercial, Ponto de Venda (PDV), Fundo de Reserva, Ponto de Equilíbrio Operacional, Markup Divisor, Curva ABC e Inteligência Comercial para Loja de Artigos Religiosos.
- **Padrão Arquitetural:** PWA Local-First com Sincronização Supabase (PostgreSQL). O sistema opera com latência zero no dispositivo e sincroniza de forma transacional e atômica com o servidor compartilhado.
- **Identidade Visual:** Dark Mode Corporativo/ERP Sagrado (`#0b0f17` fundo, `#161f2e` superfícies, `#f59e0b` ouro, `#10b981` verde, `#ef4444` vermelho, `#38bdf8` azul).
- **Sem Emojis:** Utilizar estritamente ícones vetoriais da biblioteca Lucide Icons (`<i data-lucide="..."></i>`).
- **Neutro e Profissional:** Nunca hardcodar nomes de sócios ou operadores na interface ou em mensagens de sincronização/atualização.

---

## 2. Regras Invioláveis de Arquitetura e Persistência

### Regra 1: Princípio Local-First Estrito com Latência Zero
- Toda mutação de dados (estoque de produtos, adição de vendas, estornos, configurações, categorias, custos fixos) DEVE ser refletida no objeto em memória (`state.*`) e persistida no `localStorage` e `IndexedDB` **de forma síncrona e imediata**, enfileirando o job na Outbox (`enfileirarMutacao`).
- A interface nunca deve aguardar resposta de rede para confirmar uma ação de tela.

### Regra 2: Soberania da Outbox e Proibição de Inferência por Ausência
- **JAMAIS** comparar coleções locais e remotas para fazer upload automático de itens que "não existem no banco".
- Apenas itens explicitamente registrados na `syncQueue` com status pendente devem ser enviados como novas criações. Itens ausentes na nuvem que não estão na Outbox local foram deletados remotamente e devem ser expurgados localmente.

### Regra 3: Idempotência Obrigatória para Mutações Críticas (`operation_id`)
- Toda operação que afeta estoque ou finanças (`VENDA_TRANSACIONAL`, `ESTORNO_TRANSACIONAL`, `PRODUTO_DELETE`) deve carregar um `operation_id = crypto.randomUUID()` imutável.
- O PostgreSQL deve verificar o `operation_id` na tabela `casa_operacoes_idempotencia` antes de aplicar qualquer alteração física para impedir efeitos cumulativos em retries de rede.

### Regra 4: Atomicidade no Banco via RPC e Bloqueio Pessimista (`FOR UPDATE`)
- Vendas e estornos DEVEM ser executados no Supabase via PostgreSQL Functions / RPCs (`casa_registrar_venda_transacional` e `casa_estornar_venda_transacional`).
- Toda leitura concorrente de saldo de estoque para venda deve utilizar `SELECT ... FOR UPDATE` para impedir que dois aparelhos vendam o último item simultaneamente. O estoque nunca pode ser negativo (`CHECK (estoque_atual >= 0)`).

### Regra 5: Soft-Delete Obrigatório para Estornos de Vendas
- Vendas NUNCA devem ser excluídas com `DELETE` físico direto no banco de dados.
- O estorno deve marcar `estornada = true`, registrar data/hora e operador, e devolver o estoque atômico, preservando a trilha de auditoria financeira e impedindo estornos duplicados.

### Regra 6: Exclusão Segura com Registro de Tombstones
- A exclusão de produtos deve gerar um registro persistente na tabela `casa_tombstones (entidade, registro_id, deleted_at)`.
- Dispositivos que retomam de períodos prolongados de suspensão devem consultar os tombstones remotos antes de reconciliar o catálogo para expurgar itens locais sem ressuscitá-los.

### Regra 7: Armazenamento Multi-Tier (IndexedDB para Imagens, LocalStorage Leve)
- O `localStorage` deve ser reservado exclusivamente para dados leves (metadados, configurações, identificadores).
- Fotografias de produtos devem ser armazenadas localmente no **IndexedDB** (`casa_sagrado_db.imagens`) e remotamente no **Supabase Storage** (`casa-produtos`), nunca como strings Base64 brutas no `localStorage`, prevenindo erros de cota (`QuotaExceededError`) no Safari do iPhone.

### Regra 8: Blindagem do Supabase (Nunca usar `.catch` em Builders)
- Construtores de consulta do Supabase (`PostgrestFilterBuilder`) implementam `.then()`, mas **NÃO POSSUEM método `.catch()` garantido** no runtime do navegador.
- Todas as chamadas de banco devem ser encapsuladas em blocos `try/catch` nativos com `async/await`.

### Regra 9: Respeito a Coleções Vazias (`[]`) sem Restauração Fantasma
- Coleções vazias (`[]`) retornadas pelo servidor são estados legítimos (ex: limpeza intencional de histórico).
- O código cliente NUNCA deve verificar apenas `dados.length > 0` para aceitar dados remotos. Sempre verificar `Array.isArray(dados)`.

### Regra 10: Identificadores Estritamente em UUID v4
- Toda entidade sincronizada (`casa_produtos`, `casa_vendas`, `casa_tombstones`, `casa_operacoes_idempotencia`) DEVE utilizar UUID v4 gerado via `crypto.randomUUID()`. Identificadores textuais legados causam erro de sintaxe Postgres (`22P02`).

---

## 3. Diretrizes de UI/UX Mobile-First e Multiplataforma

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
- Qualquer evolução estrutural deve atualizar `APP_VERSION` (`v22.0`), `DB_SCHEMA_VERSION` (`22`) e o `CACHE_NAME` do Service Worker (`casa-sagrado-v22.0`) de forma síncrona.
- Atualizações de Service Worker devem acionar recarga automática via listener de `controllerchange` com proteção contra loop.

### Regra 15: Neutralidade de Operador e Ausência de Dados Sensíveis
- Nomes de operadores nunca devem ser fixados no código-fonte.
- A chave de serviço (`service_role`) NUNCA deve ser incluída no cliente frontend. Logs de sincronização nunca devem imprimir credenciais ou dados sigilosos.

---

## 4. Diretrizes Comerciais e Financeiras

### Regra 16: Ponto de Equilíbrio Operacional & Custos Fixos
- O Ponto de Equilíbrio do dia é a relação entre a meta diária de custo fixo (`Total Custos Fixos Mensais ÷ Dias de Funcionamento no Mês`) e o lucro bruto apurado no dia.
- As despesas fixas devem ser cadastradas item a item (ex: Aluguel, Luz, Internet, MEI), com dias de funcionamento configuráveis.
- A persistência é síncrona local no `state.config.custosFixos` e assíncrona na nuvem via chave `custos_fixos` de `casa_configuracoes`.

### Regra 17: Exportação CSV Compatível com Excel & IA
- Relatórios tabulares de exportação para Excel no Brasil DEVEM utilizar separador ponto e vírgula (`;`), encoding UTF-8 com BOM (`\uFEFF`) e números decimais com vírgula (`,`) para abertura direta no Microsoft Excel brasileiro sem corrupção de caracteres especiais.

### Regra 18: Compressão Obrigatória de Fotos via Canvas HTML5
- Fotos capturadas por câmeras de smartphones (4 MB a 15 MB) NUNCA devem ser enviadas sem compressão prévia.
- O aplicativo DEVE processar a imagem localmente via `<canvas>` antes de persistir:
  - Redimensionamento proporcional para no máximo `600x600 px`;
  - Conversão para WebP (fallback JPEG) com qualidade calibrada em `0.75`;
  - O arquivo gerado oscila entre `30 KB` e `50 KB`, garantindo salvamento instantâneo no IndexedDB e upload leve no Supabase Storage.

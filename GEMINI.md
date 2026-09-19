# Casa do Sagrado — Regras de Projeto, Arquitetura e Aprendizados da IA

Este documento define as diretrizes técnicas, regras de arquitetura, padrões visuais e lições aprendidas consolidadas no desenvolvimento do sistema **Casa do Sagrado** (versão estável `v19`+). Todo assistente ou agente operando neste repositório DEVE seguir estas regras rigorosamente para evitar regressões.

---

## 1. Identidade e Filosofia do Projeto
- **Sistema:** Gestão Comercial, Ponto de Venda (PDV), Fundo de Reserva, Ponto de Equilíbrio Operacional, Markup Divisor, Curva ABC e Inteligência Comercial para Loja de Artigos Religiosos.
- **Padrão Arquitetural:** PWA Local-First com Sincronização Supabase (PostgreSQL). O sistema deve funcionar perfeitamente offline e persistir instantaneamente no dispositivo.
- **Identidade Visual:** Dark Mode Corporativo/ERP Sagrado (`#0b0f17` fundo, `#161f2e` superfícies, `#f59e0b` ouro, `#10b981` verde, `#ef4444` vermelho, `#38bdf8` azul).
- **Sem Emojis:** Utilizar estritamente ícones vetoriais da biblioteca Lucide Icons (`<i data-lucide="..."></i>`).
- **Neutro e Profissional:** Nunca hardcodar nomes de sócios ou operadores na interface ou em mensagens de sincronização/atualização.

---

## 2. Regras Invioláveis de Arquitetura e Código

### Regra 1: Princípio Local-First Estrito
- Toda mutação de dados (estoque de produtos, adição/remoção de vendas, configurações, categorias, custos fixos) DEVE ser refletida no objeto em memória (`state.*`) e persistida no `localStorage` via `salvarLocal()` **de forma síncrona e imediata**.
- O sucesso da ação para o usuário NÃO PODE depender de chamadas de rede. O estoque e o histórico devem atualizar no milissegundo zero.
- A sincronização com a nuvem (Supabase) deve ocorrer em segundo plano, sem bloquear a interface.

### Regra 2: Blindagem do Supabase (NUNCA usar `.catch` em Builders)
- Construtores de consulta do Supabase (`PostgrestFilterBuilder` retornados por `.from().update()`, `.delete()`, `.upsert()`, etc.) implementam `.then()`, mas **NÃO POSSUEM método `.catch()` garantido** no runtime do navegador.
- **PROIBIDO:** `state.supabase.from(...).update(...).catch(...)` — Isto lança um `TypeError: .catch is not a function` que quebra silenciosamente a thread do JavaScript.
- **OBRIGATÓRIO:** Encapsular sempre em blocos assíncronos protegidos com `try/catch` nativo:
  ```javascript
  if (state.supabase) {
    (async () => {
      try {
        await state.supabase.from('casa_produtos').update(...).eq('id', id);
      } catch (err) {
        console.warn('[Sync] Erro:', err);
      }
    })();
  }
  ```

### Regra 3: Sincronização Fiel de Coleções Vazias
- Ao receber dados da nuvem no arranque ou após recarregar, verificar `Array.isArray(dados)` e **NUNCA** verificar apenas `dados.length > 0`.
- Se o usuário apagou todas as vendas na nuvem, o retorno será `[]` (vazio). O sistema local deve aceitar a lista vazia e zerar o cache, e não manter dados fantasmas antigos.

### Regra 4: Realtime com Suporte a DELETE
- Qualquer canal de escuta do Supabase Realtime deve escutar tanto `INSERT` quanto `DELETE` (e `UPDATE`), garantindo que estornos e deleções reflitam em tempo real em todos os terminais abertos.

---

## 3. Diretrizes de UI/UX Mobile-First

### Regra 5: Viewport Mobile Dinâmico (`--app-height` & `window.innerHeight`) & Modo Standalone
- **Modo do Manifest:** NUNCA usar `"display": "fullscreen"` no `manifest.json`. Em aparelhos Android (especialmente Samsung One UI com barra de navegação clássica de 3 botões), o modo fullscreen inicializa a janela por trás dos botões do sistema no primeiro carregamento, empurrando o menu inferior para baixo e exigindo minimizar e reabrir o app para consertar. Utilizar sempre `"display": "standalone"`.
- **Altura Dinâmica do Viewport:** NUNCA usar `-webkit-fill-available`. Em navegadores móveis, o `100dvh` pode divergir momentaneamente da barra do sistema. Portanto, vincular dinamicamente a variável CSS `--app-height` ao `window.innerHeight` no JavaScript (`resize` e inicialização) e definir:
  ```css
  html {
    height: 100%;
    width: 100%;
  }
  body {
    height: 100%;
    height: var(--app-height, 100dvh);
    max-height: 100%;
    width: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  ```

### Regra 6: Posicionamento da Barra de Navegação & Respiro
- A barra inferior (`.bottom-nav`) DEVE ser um item flexível fixo no fluxo (`flex-shrink: 0;`), e NUNCA `position: fixed`.
- O container principal (`.app-viewport`) deve ser `flex: 1 1 0; min-height: 0; overflow-y: auto;`. Desta forma, ele termina fisicamente ACIMA da barra de navegação, sendo impossível qualquer card ficar escondido atrás dos botões.
- Na aba de Estoque, usar `padding-bottom: 72px;` em `.products-grid` para que o botão flutuante FAB (`+`) nunca cubra o último produto.
- Em atualizações e reloads, usar `window.location.replace()` limpo sem poluir a URL com parâmetros `?v=...` que quebram o escopo PWA no Android.
- Ao alternar entre abas, o scroll deve ser resetado para o topo: `viewport.scrollTop = 0;`.

### Regra 7: Touch-First & Confirmação Inline
- Para estorno de vendas individuais, priorizar **Confirmação Inline em 2 Toques (Tap-to-Confirm)** diretamente no botão da linha:
  - 1º Toque: Botão muda para `Confirmar?` (destaque vermelho vivo, com temporizador de 3,5s para reverter).
  - 2º Toque: Execução imediata do estorno com animação suave de saída da linha (`removing`), devolução de estoque e toast feedback.
  - Evita modais que quebram o fluxo e causam perda de clique em telas touch.

### Regra 8: Botões de Modais Concisos
- Botões de confirmação em modais com layout de 2 colunas devem ter textos curtos (máximo 12 a 15 caracteres, ex: `"Sim, limpar"`, `"Sim, excluir"`, `"Confirmar"`). Textos longos como `"Sim, Limpar Todas as Vendas"` extrapolam a caixa do modal.
- Altura padrão calibrada para `40px` e fonte `13px` com `white-space: nowrap`.

### Regra 9: Tipografia Sem Quebra Órfã
- Informações de preço e margem (ex: `Balcão: R$ 12,00`, `Margem: 35%`, `Meta: R$ 1.500,00`) DEVEM possuir `white-space: nowrap` para evitar que a porcentagem ou o símbolo monetário quebrem sozinhos em uma nova linha.
- Nunca incluir caracteres estáticos de separação (`•` ou `|`) entre elementos com `flex-wrap`, pois geram separadores órfãos soltos no final da linha. Usar `gap` CSS.

---

## 4. Novas Diretrizes Financeiras & Inteligência (v19)

### Regra 10: Ponto de Equilíbrio Operacional & Custos Fixos
- O Ponto de Equilíbrio do dia é a relação entre a **meta diária de custo fixo** (`Total Custos Fixos Mensais ÷ Dias de Funcionamento no Mês`) e o **lucro bruto apurado no dia**.
- As despesas fixas devem ser cadastradas item a item (ex: Aluguel, Luz, Internet, MEI), com dias de funcionamento configuráveis para acomodar folgas, feriados e variações do calendário comercial.
- A persistência é síncrona local no `state.config.custosFixos` e assíncrona na nuvem via chave `custos_fixos` de `casa_configuracoes`.

### Regra 11: Exportação CSV Compatível com Excel & IA
- Relatórios tabulares de exportação para Excel no Brasil DEVEM utilizar separador ponto e vírgula (`;`), encoding UTF-8 com BOM (`\uFEFF`) e números decimais com vírgula (`,`) para abertura direta no Microsoft Excel sem corrupção de caracteres especiais ou necessidade de assistente de importação.

---

## 5. Diretrizes de Catálogo Visual, Fotos & Inteligência Comercial (v20)

### Regra 12: Compressão Obrigatória de Fotos via Canvas HTML5
- Fotos capturadas por câmeras de smartphones (4 MB a 15 MB) NUNCA devem ser salvas diretamente no `localStorage` sob risco imediato de `QuotaExceededError`.
- O aplicativo DEVE processar a imagem localmente via `<canvas>` antes de persistir:
  - Redimensionamento proporcional para no máximo `600x600 px`;
  - Conversão para WebP (fallback JPEG) com qualidade calibrada em `0.75`;
  - A string Base64 resultante deve oscilar entre `30 KB` e `50 KB`, garantindo salvamento síncrono instantâneo no `localStorage` e tráfego leve no Supabase.

### Regra 13: Grade da Vitrine em Blocos (1:1) & Navegação de 5 Abas
- O Catálogo Visual opera como vitrine primária em blocos quadrados (`aspect-ratio: 1/1`), exibindo foto real (ou placeholder estilizado), badge sobreposto de status de estoque (`un`, `apenas X` ou `esgotado`), título e preço em ouro (`#f59e0b`).
- A navegação inferior (`.bottom-nav`) acomoda 5 abas (`Catálogo`, `Estoque`, `Vendas`, `Painel`, `Ferramentas`) com `font-size: 10px`, `letter-spacing: -0.02em` e `white-space: nowrap` para evitar qualquer quebra em celulares de tela estreita.
- O botão flutuante FAB (`+`) deve permanecer visível tanto na aba de Catálogo quanto na de Estoque.

### Regra 14: Modelo Comercial de Alta Margem (Kits e Fracionamento)
- Evitar vendas isoladas de baixíssimo valor unitário que geram prejuízo operacional de tempo e embalagem.
- Estratégia de ancoragem:
  - Velas de 7 dias avulsas no balcão (giro constante) e maços de velas palito c/ 8;
  - Fracionamento de ervas a granel em saquinhos zip kraft de 40g (margem de contribuição > 150%);
  - Montagem de kits de presentes em caixas kraft (20x16x5 cm) com unboxing perfumado (Alfazema), elevando o ticket médio para a faixa de R$ 20,00 a R$ 45,00 com markup divisor protegido.

---

## 6. Diretrizes de Sincronização Resiliente & Nuvem (v20.1)

### Regra 15: Resiliência de Schema & Reconciliação Bi-direcional
- **Degradação Graciosa de Colunas:** Se uma coluna opcional (como `imagem`) ainda não existir no schema do Supabase (erro `PGRST204`), o cliente DEVE capturar o erro, remover a propriedade do payload e salvar os dados cadastrais essenciais (nome, estoque, preços, categoria) imediatamente, sem falhar silenciosamente nem impedir a sincronização do estoque entre aparelhos.
- **Reconciliação Bi-direcional:** Ao abrir o app ou restaurar conexão, o sistema compara dados da nuvem e do cache local. Itens criados localmente que ainda não existam no Supabase são enviados automaticamente.
- **Ciclo de Vida Mobile:** Dispositivos móveis suspendem WebSockets ao bloquear tela ou trocar de app. Portanto, o app DEVE escutar `visibilitychange` (`visible`), evento `online` e rodar heartbeat leve periódico (a cada 25s) para garantir sincronismo contínuo sem depender de reload manual.


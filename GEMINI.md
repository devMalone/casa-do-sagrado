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

### Regra 5: Viewport Mobile Dinâmico (`100dvh`)
- Nunca usar `height: 100vh` fixo em layouts móveis de tela cheia. A barra de endereços do Android/Chrome quebra o layout.
- Utilizar sempre:
  ```css
  html {
    height: 100%;
    height: -webkit-fill-available;
  }
  body {
    height: 100%;
    height: 100vh;
    height: 100dvh;
    min-height: -webkit-fill-available;
    overflow: hidden;
  }
  ```

### Regra 6: Respiro Inferior Calibrado
- O container de rolagem principal (`.app-viewport`) deve ter respiro inferior de 24px acima da barra de navegação:
  ```css
  padding-bottom: calc(var(--bottom-nav-height) + var(--safe-bottom) + 24px) !important;
  ```
  Isso garante que botões no fim da página rolem com folga confortável sem deixar vazios pretos excessivos.
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

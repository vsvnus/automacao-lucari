# Changelog

## [Unreleased] - 2024-02-12

### UI / UX
- **Dashboard Grid:** Implementado novo layout `.stats-grid` substituindo o antigo `.stats-row` flexbox, melhorando o alinhamento e responsividade.
- **Card Design:** Cards de estatísticas (Webhooks, Clientes, Time Online) padronizados com ícones coloridos e tipografia mais clara.
- **Activity Feed:** Redesenhado com ícones semânticos (Mensagem, Atualização, Erro) e suporte a badges de status (`Novo Lead`, `Venda`, `Erro`).
- **Remoção de Poluição:** Removida a seção "Como Funciona" da tela inicial para focar nos dados.
- **Cores & Badges:** Adicionadas variáveis CSS para `badge-new` (azul), `badge-update` (roxo), `badge-sale` (verde) e `badge-error` (vermelho).

### Bug Fixes
- **Lead Name Normalization:** Corrigido bug onde leads sem nome no WhatsApp estavam sendo salvos com o nome da conta do Tintim (ex: "Lucas Raydan Advogados").
- **Fallback Name:** Implementado fallback inteligente para usar o número de telefone formatado (`+55 (11) ...`) quando o nome não está disponível.
- **Sheet Update:** Adicionado suporte para atualização da Coluna A (Nome do Lead) na planilha quando um status é atualizado via webhook.

### Code Quality
- **Refatoração JS:** Limpeza e padronização das funções de renderização no `app.js` e `webhookHandler.js`.
- **Testes:** Scripts de testes temporários removidos após validação.

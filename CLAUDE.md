# Dashboard + Automação Planilhas — Lucari (automacao-lucari)

> **Atualizado**: 2026-02-24 | **Versão**: 1.1 (pós correções fase A)

## Princípios de Operação

### Documentação Obrigatória
> **TODA alteração no código DEVE ser refletida neste CLAUDE.md.** Novas features, correções, endpoints, colunas de banco, dependências — tudo deve ser documentado aqui antes de considerar o trabalho concluído.

### Ciclo Autônomo de Produção
Este projeto é administrado por agentes de IA via terminal. O servidor deve funcionar como um ciclo fechado e autônomo:
- O gestor do projeto (Vinicius) é **project manager**, não desenvolvedor
- Toda operação (deploy, debug, migração) deve ser executável via IA no terminal
- O agente deve manter práticas corretas, documentação atualizada e código limpo
- **Logs de container são perdidos a cada reinicialização** — sempre verificar logs em tempo real, não confiar em logs históricos

### Git Workflow (OBRIGATÓRIO)

#### Regra de Ouro
> **NUNCA edite código na branch `main`.** Todo trabalho começa e acontece na branch `staging`.

#### Processo Completo

```
FASE 1 — PREPARAÇÃO (antes de escrever qualquer código)
1. git checkout staging
2. git pull origin staging
3. git pull origin main             ← sincroniza staging com produção
4. git push origin staging

FASE 2 — DESENVOLVIMENTO
5. Faça todas as alterações na branch staging
6. git add <arquivos específicos>   ← NUNCA use "git add ." ou "git add -A"
7. git commit -m "descrição clara"
8. git push origin staging

FASE 3 — DEPLOY STAGING
9.  SSH: ssh -i ~/.ssh/hetzner_lucari root@178.156.164.91
10. bash /opt/staging/deploy.sh
11. Testar em staging.vin8n.online

FASE 4 — PROMOÇÃO PARA PRODUÇÃO
12. git checkout main
13. git pull origin main
14. git merge staging                ← merge (NÃO rebase)
15. git push origin main
16. Coolify auto-deploys em ~1 min
17. git checkout staging             ← volte para staging imediatamente
```

#### Regras Críticas

| Regra | Por quê |
|-------|---------|
| Sempre começar com `git checkout staging` + `git pull` | Evita trabalhar sobre versão desatualizada |
| Sincronizar staging com main ANTES de começar | Evita divergência entre branches |
| Usar `git merge` (não `git rebase`) para staging→main | Rebase reescreve histórico e causa conflitos em cascata |
| Nunca usar `git push --force` | Destrói histórico de outros contribuidores |
| Nunca fazer commit direto na main | Main só recebe merges de staging |
| Usar `git add <arquivo>` específico | Evita commitar .env, credenciais, temporários |
| Voltar para staging após push na main | Próximo trabalho já começa no lugar certo |

## Visão Geral

Dashboard para gestão de leads recebidos via webhooks Tintim. Automatiza inserção em Google Sheets por cliente/mês, com painel de métricas, alertas e gerenciamento de usuários.

## URLs

| Ambiente | URL |
|----------|-----|
| Produção | dashboard.vin8n.online |
| Staging | staging.vin8n.online |
| Health | `GET /health` |

## Estrutura de Arquivos

```
src/
├── server.js          — Express server, routes, auth, health endpoint
├── webhookHandler.js  — Tintim webhook processing (new leads + status updates)
├── sheetsService.js   — Google Sheets API (insert/update leads, monthly tabs)
├── pgService.js       — PostgreSQL (logging, clients, dashboard stats, alerts, users)
├── clientManager.js   — Client config loader (from PostgreSQL)
├── supabaseService.js — Legacy (not actively used)
└── utils/
    ├── logger.js      — Winston logger
    ├── formatter.js   — Phone/date formatting (BR)
    └── validator.js   — Tintim payload validation
public/
├── index.html         — Dashboard SPA (single page, todas as seções)
├── app.js             — Dashboard frontend logic (modals, CRUD, charts)
├── alerts.js          — Client alert system
├── style.css          — All styles (inclui modal .modal-overlay.visible)
└── login.html         — Login page
infra/
└── schema-leads.sql   — Migrações de banco (CREATE TABLE + ALTER TABLE)
```

## Banco de Dados (leads_automation / leads_automation_staging)

### Tabelas
- `clients` — clientes cadastrados
- `lead_trail` — trail de leads por cliente
- `leads_log` — log de leads processados
- `webhook_events` — deduplicação de webhooks (30s window)
- `system_settings` — configurações do sistema (key-value)
- `users` — autenticação (email, password_hash, name, role, updated_at)
- `session` — sessões Express

### Migrações Recentes (2026-02-24)
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'admin';
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
```
Necessárias para o CRUD de usuários funcionar corretamente.

## Correções Recentes (2026-02-24)

### Bug Fix: Webhook URL mostrando email
- **Causa**: ID duplicado `#settings-webhook-input` em `index.html` — existia em dois cards diferentes
- **Fix**: Removido card duplicado da seção automação (mantido apenas na seção settings)

### Bug Fix: Botão "Novo Usuário" não funciona
- **Causa**: CSS usa `.modal-overlay.visible` para `display:flex`, mas JS usava `.classList.add('active')`
- **Fix**: Alterado `app.js` para usar `visible` em `openUserModal()` e `closeUserModal()`
- **Padrão**: TODOS os modals do app usam classe `visible` (nunca `active`)

### Bug Fix: Aba Usuários vazia
- **Causa**: Colunas `role` e `updated_at` não existiam na tabela `users`
- **Fix**: ALTER TABLE adicionando as colunas (aplicado em prod e staging)

## Integrações

### Google Sheets
- Service account: `automacao-wpp@automacao-planilha-487020.iam.gserviceaccount.com`
- PROD: `GOOGLE_CREDENTIALS_JSON` env var (Coolify)
- STAGING: `config/google-credentials.json` (in .gitignore)
- Fallback: B64 env → JSON env → file

### Tintim (Webhook)
- Endpoint: `POST /webhook/tintim`
- Events: `lead.create`, `lead.update`
- Filtro: só Meta/Google Ads → planilha (orgânico ignorado)

## Problemas Comuns

### "Google Sheets não disponível"
- Verificar `GOOGLE_CREDENTIALS_JSON` ou `config/google-credentials.json`
- JSON precisa ter `client_email` — `{}` vazio falha silenciosamente
- `GET /health` → `integrations.googleSheets`

### Leads não vão para planilha
- Leads orgânicos são filtrados (design)
- Verificar `docker logs <container>` para `Lead orgânico ignorado`
- Verificar `leads_log.processing_result`

### Leads duplicados
- Window de idempotência: 30 segundos (`checkDuplicateWebhook`)
- Tintim às vezes envia mesmo webhook múltiplas vezes

### Modal não abre
- TODOS os modals usam classe CSS `visible` (nunca `active`)
- Padrão: `modal.classList.add('visible')` / `modal.classList.remove('visible')`

## Owner
- **Vinicius Pimentel** (vinnipimentelgestor@gmail.com)
- GitHub: vsvnus | Company: Lucari

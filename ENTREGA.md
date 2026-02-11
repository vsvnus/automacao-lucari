# 📄 Guia de Entrega — Automação de Leads WhatsApp/Tintim

Este documento explica como transferir o controle do sistema para o cliente final e como gerenciar a ferramenta no dia a dia.

---

## 1. O Que Este Sistema Faz

### Fluxo Completo

```
📱 Lead manda mensagem no WhatsApp (via Meta Ads)
    ↓
🔔 Tintim detecta → dispara webhook "CONVERSA CRIADA"
    ↓
🤖 Servidor recebe → Insere nova linha na planilha:
    Nome (Auto) | Telefone | Meta Ads | Data | Produto | Status = "Lead Gerado"
    ↓
📋 Equipe atende, negocia e fecha a venda no Tintim
    ↓
🔔 Tintim detecta mudança de status → dispara "CONVERSA ALTERADA"
    ↓
🤖 Servidor recebe → Busca lead pelo telefone → Atualiza:
    Data Fechamento | Valor da Venda | Status = nome do status no Tintim
```

### Funcionalidades

| Feature | Descrição |
|---------|-----------|
| **Inserção automática de leads** | Novos leads do WhatsApp são inseridos na planilha com todos os dados |
| **Tag visual (Auto)** | Nome do lead aparece com **(Auto)** em **verde** para diferenciar da inserção manual |
| **Abas mensais automáticas** | Sistema cria abas no formato "Mês-AA" (ex: Fevereiro-26) com cabeçalho formatado |
| **Detecção de produto** | Analisa mensagem e campanha UTM para detectar o serviço automaticamente |
| **Atualização de status** | Quando status muda no Tintim, a planilha é atualizada (inclui data e valor de venda) |
| **Multi-cliente** | Suporta múltiplos clientes na mesma instalação, cada um com sua planilha |
| **Dashboard web** | Painel visual para gerenciar clientes sem mexer em código |
| **Keep-alive** | Configurado com UptimeRobot para nunca dormir no Render |

---

## 2. Onde o Sistema Roda

| Componente | Serviço | URL |
|------------|---------|-----|
| **Servidor** | Render (free tier) | `https://SEU-APP.onrender.com` |
| **Dashboard** | Render (mesma URL) | `https://SEU-APP.onrender.com/` |
| **Health Check** | Render | `https://SEU-APP.onrender.com/health` |
| **Banco de Dados** | Supabase (PostgreSQL) | `https://SEU-PROJETO.supabase.co` |
| **Keep-alive** | UptimeRobot | Pinga `/health` a cada 5 min |
| **Planilha** | Google Sheets | Planilha configurada por cliente |
| **Webhook source** | Tintim | Envia para `/webhook/tintim` |

---

## 3. Como Dar Controle Total (Transferência)

Para que o responsável tenha 100% de posse, ele precisa de acesso a:

### A. GitHub (Código)

1. Transfira o repositório (Settings → Transfer Ownership) ou adicione como collaborator
2. O Render está conectado a este repo — qualquer push no `main` faz deploy automático

### B. Render (Hospedagem)

1. Crie uma conta em [render.com](https://render.com)
2. Conecte o repositório GitHub
3. Configure as variáveis de ambiente:
   - `SUPABASE_URL` → URL do projeto Supabase
   - `SUPABASE_SERVICE_ROLE_KEY` → Service Role Key do Supabase
   - `GOOGLE_CREDENTIALS_JSON` → conteúdo completo do JSON da Service Account
   - `NODE_ENV` → `production`
4. Build Command: `npm install`
5. Start Command: `npm start`

### B2. Supabase (Banco de Dados)

1. Acesse [supabase.com](https://supabase.com) e faça login na conta do projeto
2. O banco já tem as tabelas: `clients`, `leads_log`, `webhook_events`, `system_settings`
3. Clientes e logs são **persistentes** — não se perdem no redeploy do Render

### C. Google Cloud (Planilhas)

1. O responsável deve ter acesso à conta que criou a **Service Account**
2. Todas as planilhas dos clientes devem estar compartilhadas com o email da Service Account como **Editor**
3. O email da Service Account tem formato: `nome@projeto.iam.gserviceaccount.com`

### D. Tintim (Webhooks)

1. No painel do Tintim → Configurações → Webhooks
2. As URLs de "Conversa criada" e "Conversa alterada" devem apontar para:
   ```
   https://SEU-APP.onrender.com/webhook/tintim
   ```

### E. UptimeRobot (Keep-alive)

1. Acesse [uptimerobot.com](https://uptimerobot.com) e crie uma conta
2. Adicione monitor HTTP(s) para `https://SEU-APP.onrender.com/health` com intervalo de 5 minutos
3. Isso impede o Render de dormir o servidor

---

## 4. Dashboard Administrativo

Acessível em `https://SEU-APP.onrender.com/`

**O que pode ser feito:**

- 📊 **Ver estatísticas**: Clientes ativos, tempo online, fonte de dados
- ➕ **Cadastrar clientes**: Clicar em "Novo Cliente" e preencher (salva no Supabase!)
- 🗑️ **Remover clientes**: Desativar da configuração
- 🔄 **Recarregar**: Forçar re-leitura do banco de dados
- 🔗 **Editar Webhook URL**: Em Configurações, altere a URL do webhook

> ⚠️ O dashboard **não tem login**. Qualquer pessoa com a URL pode acessar. Para um ambiente com muitos usuários, considere adicionar autenticação básica.

> 💡 **Persistência**: Clientes e configurações são salvos no **Supabase** (PostgreSQL). Redeploys no Render **não perdem dados**.

---

## 5. Como Adicionar Novo Cliente

1. No **Tintim**, copie o **Instance ID** do cliente (UUID)
2. No **Google Sheets**, crie a planilha e copie o **Spreadsheet ID** (parte da URL)
3. Compartilhe a planilha com o email da Service Account
4. No **Dashboard**, clique em "Novo Cliente" e preencha os dados
5. Pronto! O sistema já começa a capturar leads automaticamente

---

## 6. Colunas da Planilha

| Coluna | Campo | Preenchido por |
|:------:|-------|:--------------:|
| A | Nome do Lead **(Auto)** | 🤖 Automação |
| B | Telefone | 🤖 Automação |
| C | Meio de Contato | 🤖 `Meta Ads` |
| D | Data 1º Contato | 🤖 Automação |
| E | Data Fechamento | 🤖 Automação (na venda) |
| F | Valor Fechamento | 🤖 Automação (na venda) |
| G | Produto | 🤖 Auto-detectado |
| H | Status Lead | 🤖 Automação |
| I-M | DIA 1 a DIA 5 | ✍️ Equipe |
| N | Comentários | 🤖 + ✍️ |

---

## 7. Segurança Atual

| Medida | Status |
|--------|:------:|
| Credenciais Google fora do Git | ✅ |
| HTTPS automático (Render) | ✅ |
| Security Headers (XSS, HSTS, etc.) | ✅ |
| Rate Limiting no webhook (60 req/min) | ✅ |
| Limite de payload (1MB) | ✅ |
| Autenticação no Dashboard | ⚠️ Futuro |

---

## 8. Como Cobrar o Cliente (Modelo de Negócio)

Como é uma **infraestrutura multi-cliente**, é possível:

1. **Taxa de setup**: Pela configuração inicial (Tintim, planilha, produtos)
2. **Mensalidade (SaaS)**: Por manter o sistema rodando e automatizando os leads
3. **Escalabilidade**: É possível ter dezenas de clientes no mesmo servidor, adicionando pelo Dashboard

---

## 9. Manutenção

| Tarefa | Frequência | Como |
|--------|:----------:|------|
| Verificar se o servidor está ativo | Automático | UptimeRobot notifica por email se cair |
| Verificar logs | Semanal | Render → Dashboard → Logs |
| Adicionar novos clientes | Sob demanda | Dashboard web |
| Atualizar código | Sob demanda | Push no GitHub → deploy automático |

---

## 10. Stack Técnica

| Tecnologia | Uso |
|------------|-----|
| **Node.js** + **Express** | Servidor web e API |
| **Supabase** (PostgreSQL) | Banco de dados (clientes, logs, config) |
| **Google Sheets API v4** | Leitura e escrita na planilha |
| **Google Drive API v3** | Verificação de compartilhamento |
| **Winston** | Sistema de logging |
| **Tintim** | Plataforma de gestão de WhatsApp |
| **Render** | Hosting (free tier) |
| **UptimeRobot** | Keep-alive para o Render |

---

**Sistema entregue e pronto para produção! 🚀**

Caso queira evoluções futuras (login no dashboard, relatórios por período, integração com CRM), basta entrar em contato.

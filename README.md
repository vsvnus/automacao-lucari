# 🚀 WhatsApp Leads Automation

Automação que captura leads do WhatsApp (via [Tintim](https://tintim.app)) e registra automaticamente nas planilhas Google Sheets de cada cliente, com abas mensais, detecção de produto, atualização de status de venda e tag visual `(Auto)`.

## 📋 Visão Geral

```
Lead manda mensagem no WhatsApp
         │
         ▼
  Tintim detecta a conversa
         │
         ▼
  Dispara webhook para o servidor
  (conversa criada OU conversa alterada)
         │
         ▼
  Servidor identifica o cliente (multi-tenant)
         │
         ▼
  ┌──────────────────────────────────────┐
  │  CONVERSA CRIADA (event_type ausente) │
  │  → Insere nova linha na planilha      │
  │  → Nome (Auto), Telefone, Data,       │
  │    Produto, Status = "Lead Gerado"    │
  └──────────────────────────────────────┘
  ┌──────────────────────────────────────┐
  │  CONVERSA ALTERADA (lead.update)     │
  │  → Busca lead pelo telefone           │
  │  → Atualiza Status, Data Fechamento,  │
  │    Valor da Venda                     │
  └──────────────────────────────────────┘
```

## ⚡ Quick Start

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar Google Service Account

1. Vá ao [Google Cloud Console](https://console.cloud.google.com/)
2. Crie ou selecione um projeto
3. Ative as APIs: **Google Sheets API** e **Google Drive API**
4. Crie uma **Service Account** (IAM & Admin → Service Accounts)
5. Gere uma chave JSON e salve como `config/google-credentials.json`
6. Compartilhe a planilha do cliente com o email da Service Account como **Editor**

### 3. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

| Variável | Descrição | Obrigatório |
|----------|-----------|:-----------:|
| `GOOGLE_CREDENTIALS_JSON` | JSON da Service Account (para produção/Render) | Em produção |
| `PORT` | Porta do servidor (padrão: 3000) | Não |
| `MAX_RETRIES` | Tentativas de retry na API Google (padrão: 3) | Não |
| `RETRY_DELAY` | Delay entre retries em ms (padrão: 2000) | Não |
| `NODE_ENV` | `production` ativa HSTS | Não |

### 4. Configurar clientes

Edite `config/clients.json`:

```json
{
  "clients": [
    {
      "id": "meu-cliente",
      "name": "Nome do Cliente",
      "tintim_instance_id": "UUID-DA-INSTANCIA-TINTIM",
      "spreadsheet_id": "ID_DA_PLANILHA_GOOGLE",
      "sheet_name": "auto",
      "active": true
    }
  ]
}
```

| Campo | Descrição |
|-------|-----------|
| `id` | Identificador único do cliente (slug) |
| `name` | Nome legível do cliente |
| `tintim_instance_id` | UUID da instância no Tintim (encontra em Configurações → Instância) |
| `spreadsheet_id` | ID da planilha Google (na URL: `docs.google.com/spreadsheets/d/ESTE_ID/edit`) |
| `sheet_name` | `"auto"` = cria abas mensais automáticas (Fevereiro-26), ou nome fixo da aba |

### 5. Iniciar o servidor

```bash
# Produção
npm start

# Desenvolvimento (auto-reload)
npm run dev
```

### 6. Configurar Webhooks no Tintim

No painel do Tintim, vá em **Configurações → Webhooks** e configure:

| Evento | URL |
|--------|-----|
| **Conversa criada** | `https://seu-dominio.onrender.com/webhook/tintim` |
| **Conversa alterada** | `https://seu-dominio.onrender.com/webhook/tintim` |

> Os demais campos (Nova mensagem, Alteração na origem) podem ficar vazios.

## 📁 Estrutura do Projeto

```
whatsapp-leads-automation/
├── config/
│   ├── clients.json              # Configuração dos clientes (multi-tenant)
│   └── google-credentials.json   # Credenciais Google (NÃO vai pro Git)
├── src/
│   ├── server.js                 # Servidor Express + endpoints + segurança
│   ├── webhookHandler.js         # Processamento dos webhooks do Tintim
│   ├── sheetsService.js          # Integração Google Sheets API v4
│   ├── clientManager.js          # Gerenciamento multi-tenant
│   └── utils/
│       ├── logger.js             # Sistema de logging (Winston)
│       ├── formatter.js          # Formatação BR (telefone, datas)
│       └── validator.js          # Validação de payloads
├── public/
│   ├── index.html                # Dashboard administrativo
│   ├── app.js                    # Lógica do dashboard
│   └── styles.css                # Estilos do dashboard
├── logs/                         # Arquivos de log (auto-gerado)
│   ├── combined.log              # Todos os logs
│   ├── error.log                 # Apenas erros
│   └── leads.log                 # Auditoria de leads processados
├── .env                          # Variáveis de ambiente (local)
├── .env.example                  # Exemplo de .env
├── .gitignore
├── package.json
├── README.md
└── ENTREGA.md                    # Guia de entrega para o cliente
```

## 🔌 Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/` | Dashboard administrativo |
| `GET` | `/health` | Health check (usado pelo UptimeRobot) |
| `POST` | `/webhook/tintim` | Recebimento de webhooks do Tintim |
| `GET` | `/admin/clients` | Listar clientes configurados |
| `POST` | `/admin/clients` | Adicionar novo cliente |
| `DELETE` | `/admin/clients/:id` | Remover cliente |
| `POST` | `/admin/reload` | Recarregar configurações sem reiniciar |
| `GET` | `/admin/stats` | Estatísticas do sistema |

## 📊 Estrutura da Planilha

A planilha segue o padrão de colunas A-N:

| Coluna | Campo | Preenchido por |
|:------:|-------|:--------------:|
| A | Nome do Lead | 🤖 Automação (com tag **(Auto)** em verde) |
| B | Telefone | 🤖 Automação — formato `(XX)XXXXX-XXXX` |
| C | Meio de Contato | 🤖 Automação — `"Meta Ads"` |
| D | Data 1º Contato | 🤖 Automação — `DD/MM/YYYY` |
| E | Data Fechamento | 🤖 Automação (quando status = venda) |
| F | Valor Fechamento | 🤖 Automação — `R$ X.XXX,XX` |
| G | Produto | 🤖 Automação (auto-detectado por keywords) |
| H | Status Lead | 🤖 Automação — `"Lead Gerado"` → atualizado pelo Tintim |
| I-M | DIA 1 a DIA 5 | ✍️ Equipe (preenchimento manual) |
| N | Comentários | 🤖 Automação + ✍️ Equipe |

### Abas Mensais

Quando `sheet_name: "auto"`, o sistema cria abas no formato **Mês-AA** (ex: `Fevereiro-26`), com:
- Cabeçalho formatado (fundo azul, texto branco, negrito)
- Colunas auto-dimensionadas
- Linha do cabeçalho congelada

### Detecção Automática de Produto

O sistema detecta o produto pela mensagem do lead ou dados de campanha UTM:

| Keywords detectadas | Produto atribuído |
|---------------------|-------------------|
| bpc, loas, benefício, deficiência, idoso | `BPC/LOAS` |
| maternidade, gestante, grávida, bebê | `SALÁRIO-MATERNIDADE` |
| auxílio-doença, doença, afastamento | `AUXÍLIO-DOENÇA` |
| aposentadoria, aposentar, inss | `APOSENTADORIA` |

### Atualização de Status (Conversa Alterada)

Quando o Tintim envia `event_type: "lead.update"`:

1. O sistema busca o lead na planilha pelo **telefone** (matching flexível pelos últimos 9 dígitos)
2. Atualiza a coluna **H (Status)** com o novo status
3. Se for **status de venda** (venda, fechou, ganho, convertido, etc.) ou tiver `sale_amount`:
   - Preenche **E (Data Fechamento)** com a data atual
   - Preenche **F (Valor)** com o valor formatado em R$
4. Atualiza **N (Comentários)** com registro da mudança

## 🔒 Segurança

| Medida | Status |
|--------|:------:|
| Credenciais Google via Service Account (não usa senha pessoal) | ✅ |
| `google-credentials.json` fora do Git (`.gitignore`) | ✅ |
| Suporte a credenciais via variável de ambiente (produção) | ✅ |
| Security Headers (X-Content-Type, X-Frame, XSS-Protection, HSTS) | ✅ |
| Rate Limiting no webhook (60 req/min por IP) | ✅ |
| Limite de tamanho do payload JSON (1MB) | ✅ |
| Permissions-Policy (câmera, microfone, geolocalização bloqueados) | ✅ |
| HTTPS via Render (TLS automático) | ✅ |
| **Autenticação no dashboard `/admin/*`** | ⚠️ Futuro |

## 🌐 Deploy (Render)

O sistema está configurado para deploy no Render (free tier):

1. Conecte o repositório GitHub ao Render
2. Configure as variáveis de ambiente:
   - `GOOGLE_CREDENTIALS_JSON` = conteúdo do JSON da Service Account
   - `NODE_ENV` = `production`
3. Build Command: `npm install`
4. Start Command: `npm start`

### Keep-Alive com UptimeRobot

O Render free tier dorme após 15min de inatividade. Para manter 24/7:

1. Crie uma conta no [UptimeRobot](https://uptimerobot.com)
2. Adicione um monitor HTTP(s):
   - **URL**: `https://seu-app.onrender.com/health`
   - **Intervalo**: 5 minutos
3. Isso mantém o servidor ativo permanentemente

> ⚠️ O free tier tem 750h/mês. Para garantir 24/7, tenha apenas **1 web service** ativo por conta.

## ➕ Adicionar Novo Cliente

**Não precisa alterar código!** Apenas:

1. Abra `config/clients.json` ou use o Dashboard
2. Adicione com os campos: `id`, `name`, `tintim_instance_id`, `spreadsheet_id`, `sheet_name`
3. Compartilhe a planilha com o email da Service Account
4. O sistema recarrega automaticamente a cada 5 minutos, ou force:
   ```bash
   curl -X POST https://seu-app.onrender.com/admin/reload
   ```

## 📈 Escalabilidade

- **Multi-tenant nativo**: Cada cliente tem sua própria planilha e instância Tintim
- **Cache de planilhas**: IDs cacheados para evitar buscas repetidas
- **Indexação O(1)**: Clientes indexados por `tintim_instance_id`
- **Retry com backoff exponencial**: Falhas temporárias do Google tratadas automaticamente
- **Abas mensais automáticas**: Sem intervenção manual para criar abas por mês
- **Hot reload**: Novos clientes carregados sem reiniciar o servidor
- **Logs rotativos**: Rotação automática (5MB combined, 10MB leads)

## 🐛 Troubleshooting

### "Nenhum cliente para instanceId"
- Verifique se o `tintim_instance_id` em `clients.json` corresponde ao UUID real no Tintim
- Use `GET /admin/clients` para verificar os clientes carregados

### "Lead não encontrado na planilha" (atualização de status)
- O sistema busca pelo telefone na aba do mês atual
- Se o lead foi inserido em outro mês, a busca não encontrará (limitação conhecida)
- Verifique nos logs se o telefone está no formato esperado

### "Erro ao inicializar Google Sheets Service"
- Verifique se `GOOGLE_CREDENTIALS_JSON` está configurado no Render
- Ou se `config/google-credentials.json` existe localmente
- Confirme que as APIs Sheets e Drive estão ativadas no Google Cloud Console

### Verificar logs
```bash
# Logs em tempo real (local)
tail -f logs/combined.log

# Apenas erros
tail -f logs/error.log

# Histórico de leads
tail -f logs/leads.log

# No Render: vá em Dashboard → seu serviço → Logs
```

## 📝 Licença

ISC

# 🚀 WhatsApp Leads Automation

Automação que captura leads de campanhas WhatsApp do Meta Ads e registra automaticamente nas planilhas Google Sheets de cada cliente.

## 📋 Visão Geral

```
Meta WhatsApp Business API
         │
         ▼
   Webhook (POST /webhook)
         │
         ▼
   Identifica Cliente (multi-tenant)
         │
         ▼
   Valida Dados do Lead
         │
         ▼
   Insere no Google Sheets (com retry)
         │
         ▼
   ✅ Lead registrado na planilha do cliente
```

## ⚡ Quick Start

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

```bash
# Editar o arquivo .env (já criado com valores padrão)
# Altere os valores de:
#   META_APP_SECRET → App Secret do seu aplicativo Meta
#   META_VERIFY_TOKEN → Token customizado para verificação do webhook
```

### 3. Configurar Google Service Account

1. Vá ao [Google Cloud Console](https://console.cloud.google.com/)
2. Crie ou selecione um projeto
3. Ative as APIs:
   - **Google Sheets API**
   - **Google Drive API**
4. Crie uma **Service Account**:
   - Vá em **IAM & Admin → Service Accounts**
   - Clique em **Create Service Account**
   - Dê um nome (ex: `whatsapp-leads-bot`)
   - Clique em **Create and Continue** → **Done**
5. Gere uma chave JSON:
   - Clique na Service Account criada
   - Vá em **Keys → Add Key → Create New Key → JSON**
   - Salve o arquivo como `config/google-credentials.json`
6. Compartilhe as pastas do Drive com o email da Service Account:
   - O email terá formato: `nome@projeto.iam.gserviceaccount.com`
   - Compartilhe **cada pasta de cliente** no Drive com esse email (permissão de **Editor**)

### 4. Configurar clientes

Edite `config/clients.json`:

```json
{
  "clients": [
    {
      "id": "meu-cliente",
      "name": "Nome do Cliente",
      "whatsapp_business_account_id": "SEU_WABA_ID",
      "phone_number_id": "SEU_PHONE_NUMBER_ID",
      "google_drive_folder_id": "ID_DA_PASTA_NO_DRIVE",
      "spreadsheet_name": "Leads WhatsApp",
      "sheet_name": "Leads",
      "products": ["Produto A", "Produto B"],
      "active": true
    }
  ]
}
```

#### Como encontrar os IDs:

| ID | Onde encontrar |
|----|----------------|
| `whatsapp_business_account_id` | Meta Business Suite → Configurações → WhatsApp → ID da Conta |
| `phone_number_id` | Meta Business Suite → WhatsApp → Configurações do Telefone |
| `google_drive_folder_id` | URL da pasta no Google Drive: `drive.google.com/drive/folders/ESTE_É_O_ID` |

### 5. Iniciar o servidor

```bash
# Produção
npm start

# Desenvolvimento (auto-reload)
npm run dev
```

### 6. Configurar Webhook no Meta

1. Vá ao [Meta for Developers](https://developers.facebook.com/)
2. Selecione seu App → **WhatsApp → Configuration**
3. Em **Webhook**:
   - **Callback URL**: `https://seu-dominio.com/webhook`
   - **Verify Token**: o mesmo valor do `META_VERIFY_TOKEN` no `.env`
4. Clique em **Verify and Save**
5. Em **Webhook Fields**, ative: `messages`

> ⚠️ **Importante**: O Meta exige HTTPS. Use um serviço como [ngrok](https://ngrok.com/) para testes locais:
> ```bash
> ngrok http 3000
> ```

## 📁 Estrutura do Projeto

```
whatsapp-leads-automation/
├── config/
│   ├── clients.json              # Configuração dos clientes
│   └── google-credentials.json   # Credenciais Google (não vai pro git)
├── src/
│   ├── server.js                 # Servidor Express + endpoints
│   ├── webhookHandler.js         # Processamento dos webhooks do Meta
│   ├── sheetsService.js          # Integração Google Sheets + Drive
│   ├── clientManager.js          # Gerenciamento multi-tenant
│   ├── test.js                   # Script de teste
│   └── utils/
│       ├── logger.js             # Sistema de logging (Winston)
│       └── validator.js          # Validação de dados e assinaturas
├── logs/                         # Arquivos de log (auto-gerado)
│   ├── combined.log              # Todos os logs
│   ├── error.log                 # Apenas erros
│   └── leads.log                 # Log de auditoria de leads
├── .env                          # Variáveis de ambiente
├── .env.example                  # Exemplo de .env
├── .gitignore
├── package.json
└── README.md
```

## 🔌 Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/health` | Health check com uptime, memória e nº de clientes |
| `GET` | `/webhook` | Verificação do webhook pelo Meta |
| `POST` | `/webhook` | Recebimento de leads |
| `POST` | `/admin/reload` | Recarregar `clients.json` sem reiniciar |
| `GET` | `/admin/clients` | Listar clientes configurados |
| `GET` | `/admin/stats` | Estatísticas do sistema |

## ➕ Adicionar Novo Cliente

**Não precisa alterar código!** Apenas:

1. Abra `config/clients.json`
2. Adicione um novo objeto ao array `clients`:
   ```json
   {
     "id": "novo-cliente",
     "name": "Novo Cliente",
     "whatsapp_business_account_id": "ID_WABA_DO_CLIENTE",
     "phone_number_id": "PHONE_NUMBER_ID_DO_CLIENTE",
     "google_drive_folder_id": "ID_DA_PASTA_NO_DRIVE",
     "spreadsheet_name": "Leads WhatsApp",
     "sheet_name": "Leads",
     "products": ["Produto X"],
     "active": true
   }
   ```
3. Compartilhe a pasta do Google Drive com a Service Account
4. O sistema recarrega automaticamente a cada 5 minutos, ou force:
   ```bash
   curl -X POST http://localhost:3000/admin/reload
   ```

## 📊 Estrutura da Planilha

A planilha é criada automaticamente com o seguinte formato:

| Data/Hora | Nome | Telefone | Produto | Status | Origem | ID Lead | ID Mensagem Meta |
|-----------|------|----------|---------|--------|--------|---------|------------------|
| 10/02/2026 17:30:00 | João da Silva | 5511988887777 | Produto A | Novo Lead | WhatsApp Meta | uuid-xxx | wamid.xxx |

## 🧪 Testar

Com o servidor rodando:

```bash
npm test
```

Isso envia um webhook simulado para `http://localhost:3000/webhook`.

## 🔒 Segurança

- ✅ Credenciais do Google via Service Account (não usa senha pessoal)
- ✅ Validação HMAC-SHA256 dos webhooks do Meta
- ✅ Verify Token customizável
- ✅ Credenciais fora do código (`.env` + `.gitignore`)
- ✅ Raw body preservado para validação de assinatura
- ⚠️ Em produção, use HTTPS (obrigatório pelo Meta)
- ⚠️ Considere adicionar autenticação nos endpoints `/admin/*`

## 🐛 Troubleshooting

### "Nenhum cliente encontrado para este webhook"
- Verifique se o `whatsapp_business_account_id` ou `phone_number_id` no `clients.json` correspondem aos valores reais no Meta Business Suite
- Use `GET /admin/clients` para verificar os clientes carregados

### "Erro ao buscar planilha no Drive"
- Verifique se a pasta do Drive está compartilhada com o email da Service Account
- Confirme que o `google_drive_folder_id` está correto

### "Erro ao inicializar Google Sheets Service"
- Verifique se o arquivo `config/google-credentials.json` existe e é válido
- Confirme que as APIs Sheets e Drive estão ativadas no Google Cloud Console

### Verificar logs
```bash
# Logs em tempo real
tail -f logs/combined.log

# Apenas erros
tail -f logs/error.log

# Histórico de leads
tail -f logs/leads.log
```

## 📈 Escalabilidade

O sistema foi projetado para escalar:

- **Cache de planilhas**: IDs de planilhas são cacheados para evitar buscas repetidas no Drive
- **Indexação de clientes**: Clientes são indexados por WABA ID e Phone Number ID para lookup O(1)
- **Retry com backoff exponencial**: Falhas temporárias do Google são tratadas automaticamente
- **Hot reload**: Novos clientes são carregados sem reiniciar o servidor
- **Logs rotativos**: Arquivos de log têm tamanho máximo e rotação automática

## 📝 Licença

ISC

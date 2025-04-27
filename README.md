# Ald-a Catálogo de Móveis

Plataforma de automação de catálogos para indústria moveleira que utiliza IA para processar e extrair informações de catálogos em diversos formatos.

## Instruções para Deploy na Vercel

### Pré-requisitos

- Conta na [Vercel](https://vercel.com)
- Conta no [GitHub](https://github.com)
- Banco de dados PostgreSQL (recomendado: [Neon](https://neon.tech))
- Bucket Amazon S3
- Projeto Firebase configurado
- API keys (Anthropic, OpenAI)

### Passos para Deploy

1. **Preparar o código**
   - Faça um fork ou clone deste repositório para sua conta GitHub
   - Certifique-se de que o arquivo `vercel.json` está configurado corretamente

2. **Configurar variáveis de ambiente na Vercel**
   
   Configure as seguintes variáveis de ambiente no dashboard da Vercel:

   ```
   DATABASE_URL=postgresql://user:password@host:port/database
   
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=seu-access-key
   AWS_SECRET_ACCESS_KEY=seu-secret-key
   AWS_S3_BUCKET_NAME=seu-bucket
   
   ANTHROPIC_API_KEY=sua-chave-api
   OPENAI_API_KEY=sua-chave-api
   
   VITE_FIREBASE_API_KEY=sua-api-key
   VITE_FIREBASE_PROJECT_ID=seu-project-id
   VITE_FIREBASE_APP_ID=seu-app-id
   FIREBASE_CLIENT_EMAIL=seu-client-email
   FIREBASE_PRIVATE_KEY=sua-private-key
   ```

3. **Conectar repositório na Vercel**
   - No dashboard da Vercel, clique em "Add New" > "Project"
   - Selecione seu repositório GitHub
   - Configure o Build Command: `npm run build`
   - Configure o Output Directory: `dist`
   - Adicione as variáveis de ambiente mencionadas acima
   - Clique em "Deploy"

4. **Configurações após o deploy**
   - No console do Firebase, adicione o domínio da Vercel (.vercel.app) à lista de domínios autorizados
   - No console do S3, configure as políticas CORS para permitir requisições do domínio da Vercel
   - No dashboard do Neon, configure para permitir conexões de IPs da Vercel

### Solução de problemas comuns

Se você encontrar o erro 404 NOT_FOUND após o deploy:

1. **Verifique as rotas no vercel.json**
   - Confirme que o arquivo está formatado corretamente

2. **Verifique as funções serverless**
   - Confirme que o diretório `api` contém corretamente o arquivo `index.js` e `package.json`

3. **Verifique os logs de build**
   - No dashboard da Vercel, verifique os logs de build e deploy para identificar possíveis erros

4. **Teste o banco de dados**
   - Verifique se o banco de dados Neon está acessível a partir da Vercel
   - Teste a string de conexão localmente

5. **Teste o S3**
   - Verifique se o bucket S3 está configurado corretamente
   - Confirme que as políticas IAM permitem acesso ao bucket

Se o problema persistir, entre em contato com o suporte da Vercel ou abra uma issue neste repositório.
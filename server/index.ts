import express, { type Request, Response, NextFunction, Router as ExpressRouter } from "express";
import { registerRoutes } from "./routes_v2";
import { serveStatic, log } from "./vite";
import { createServer as createViteServer } from 'vite';
import session from "express-session";
import testRoutes from "./test-routes";
// @ts-ignore
import { reprocessRouter } from "./routes-reprocessor.js";
import { pdfRouter } from "./pdf-routes";
import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { addS3ImageRoutes } from "./s3-image-routes";
// Importar middleware CORS
import cors, { CorsOptions } from "cors";
import multer from "multer";
// @ts-ignore
import { getS3UploadMiddleware, checkS3Configuration } from "./s3-service.js";

// Importar módulos de banco de dados e storage
import { migrate } from "./db";
import { storage } from "./storage";
import { initializeClipModel } from './clip-service';

// Importar serviço WebSocket aprimorado
import { webSocketManager } from './websocket-service';

// Importe para rotas de PDF simples (corrigindo o erro de require)
import { pdfRouterSimple } from './pdf-routes-simple';

const app = express();
const httpServer = createServer(app); // Criar httpServer no escopo superior

// Manter o activeConnections para compatibilidade
const activeConnections = new Map<string, Set<WebSocket>>();

// Exportar wss para que outros módulos possam usá-lo para enviar mensagens
export const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

// Inicializar o gerenciador WebSocket com o servidor WebSocket
webSocketManager.initialize(wss);

// Conectar eventos do WebSocket para gerenciar conexões
wss.on('connection', (socket, request) => {
    console.log('[WebSocket] Nova conexão recebida');
    
    // Processar a URL da solicitação para obter o ID do projeto
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    const projectId = url.searchParams.get('projectId');
    
    if (projectId) {
        // Adicionar a conexão ao mapa de conexões ativas para compatibilidade com código legado
        if (!activeConnections.has(projectId)) {
            activeConnections.set(projectId, new Set());
        }
        activeConnections.get(projectId)?.add(socket);
        console.log(`[WebSocket] Cliente conectado ao projeto ${projectId}`);
    }
    
    // Definir handlers para eventos de socket
    socket.on('close', () => {
        console.log('[WebSocket] Conexão fechada');
        
        // Remover do mapa de conexões ativas (para compatibilidade)
        if (projectId) {
            const connections = activeConnections.get(projectId);
            if (connections) {
                connections.delete(socket);
                if (connections.size === 0) {
                    activeConnections.delete(projectId);
                }
            }
        }
    });
    
    socket.on('error', (error) => {
        console.error('[WebSocket] Erro na conexão:', error);
    });
});

// Função para enviar mensagens para todos os clientes de um projeto específico
// Agora usando o gerenciador WebSocket aprimorado, mas mantendo a API antiga
export function broadcastToProject(projectId: string, message: object) {
    // Log para rastreamento
    console.log(`[WebSocket Backend] Tentando broadcast para projeto ID: '${projectId}' (tipo: ${typeof projectId})`);
    
    // Usar o novo gerenciador WebSocket com o tipo correto importado
    const sentCount = webSocketManager.broadcastToProject(projectId, 'PROJECT_UPDATE', message);
    console.log(`[WebSocket Backend] Mensagem enviada para ${sentCount} clientes`);
    
    // Também usar o mecanismo antigo para compatibilidade
    console.log('[WebSocket Backend] Conexões ativas no Map (chaves dos projetos):', Array.from(activeConnections.keys()));

    const connections = activeConnections.get(projectId);
    if (connections) {
        console.log(`[WebSocket Backend] Encontradas ${connections.size} conexões para o projeto ${projectId}. Fazendo broadcast...`);
        const messageString = JSON.stringify(message);
        connections.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageString);
            } else {
                console.warn(`[WebSocket Backend] Cliente para projeto ${projectId} não está com readyState OPEN.`);
            }
        });
    } else {
        console.log(`[WebSocket Backend] Nenhuma conexão WebSocket ativa encontrada para o projeto ${projectId} no Map.`);
    }
}

// Configurar CORS para permitir requisições do domínio de deploy
const corsOptions: CorsOptions = {
  origin: function(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    if (!origin || process.env.NODE_ENV !== 'production') {
      callback(null, true);
      return;
    }
    const allowedOrigins = [
      'https://alda-automation-brunoeted.replit.app',
      'https://ald-a.com.br',
      'https://www.ald-a.com.br'
    ];
    if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.replit.app')) {
      callback(null, true);
    } else {
      callback(new Error('Bloqueado pelo CORS'));
    }
  },
  credentials: true // Importante: permite enviar cookies com a requisição
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: false, limit: '100mb' }));

// Configuração da sessão (DEVE SER ANTES DAS ROTAS DE PDF)
const SESSION_SECRET = process.env.SESSION_SECRET || 'alda-session-secret';
app.use(session({
  store: storage.sessionStore, // Usar o sessionStore configurado no storage
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production' ? 'auto' : false, // 'auto' permite que o Express detecte HTTPS
    maxAge: 1000 * 60 * 60 * 24 * 7, // 1 semana
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax' // Permitir cookies cross-site em produção
  }
}));

// Registrar rotas de teste
//app.use('/api/test', testRoutes);

// Registrar rotas de reprocessamento
//app.use('/api/admin', reprocessRouter);

// Registrar rotas especiais para PDF (versão original)
//app.use('/api/pdf', pdfRouter);

// Only import PDF routes in development
if (process.env.NODE_ENV === 'development') {
  app.use('/api/pdf', pdfRouterSimple);
} else {
  app.use('/api/pdf', (req, res) => {
    res.status(503).json({ message: 'PDF processing not available in production' });
  });
}

// Inicializa com localStorage como fallback, será sobrescrito se S3 estiver OK
let upload = multer({ 
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      const uploadPath = path.resolve(import.meta.dirname, '../uploads'); // Ajustar path se necessário
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
      cb(null, Date.now() + '-' + file.originalname);
    }
  })
});

(async () => {
  // Executar migração
  try {
    console.log("Iniciando migração do banco de dados...");
    await migrate();
    console.log("Migração concluída com sucesso!");
  } catch (error) {
    console.error("Erro durante migração do banco de dados:", error);
    // Considerar se deve sair em caso de falha na migração, dependendo da criticidade
  }

  // Inicializar o modelo CLIP localmente
  try {
    console.log("Inicializando modelo CLIP local...");
    await initializeClipModel(); 
    console.log("Modelo CLIP local inicializado com sucesso.");
  } catch (error) {
    console.error("Falha ao inicializar modelo CLIP local:", error);
    process.exit(1); // Sair se o modelo essencial não puder ser carregado
  }

  // Configuração S3 e definição do middleware de Upload GLOBAL
  console.log("Configurando middleware de upload...");
  try {
    const s3Config = await checkS3Configuration();
    if (s3Config.status === 'success') {
      console.log(`✅ Amazon S3 conectado com sucesso - Bucket: ${s3Config.bucket}, Região: ${s3Config.region}`);
      // @ts-ignore
      if (typeof getS3UploadMiddleware === 'function') {
        // A rota de upload de catálogo em server/routes.ts usará esta instância `upload` exportada.
        // Se outras rotas precisarem de configurações de upload diferentes, elas podem definir seus próprios middlewares multer.
        upload = getS3UploadMiddleware('catalogs'); 
        console.log('Upload de arquivos principal configurado para usar Amazon S3 para catálogos.');
      } else {
        console.warn('getS3UploadMiddleware não é uma função. Usando localStorage para uploads.');
      }
    } else {
      console.warn(`AVISO: Não foi possível conectar ao S3: ${s3Config.message}. Uploads usarão localStorage.`);
    }
  } catch (error: any) {
    console.warn(`AVISO: Erro durante a configuração do S3: ${error.message}. Uploads usarão localStorage.`);
  }

  // Adicionar rotas de imagem S3 diretamente ao `app` (se existirem e forem separadas)
  // Estas rotas provavelmente servem imagens, então devem vir ANTES do manipulador de API genérico se não usarem /api
  console.log("Configurando rotas de imagem S3...");
  try {
    if (typeof addS3ImageRoutes === 'function') {
      await addS3ImageRoutes(app); 
      console.log("Rotas de imagem S3 adicionadas diretamente ao app.");
    } else {
      console.warn('addS3ImageRoutes não é uma função. Rotas de imagem S3 não serão adicionadas.');
    }
  } catch (error) {
      console.error('ERRO ao adicionar rotas de imagem S3:', error);
  }

  // CRIAR E REGISTRAR O ROUTER DEDICADO PARA /api
  console.log("Criando router dedicado para /api...");
  const apiRouter = ExpressRouter(); 
  
  console.log("Registrando rotas da API no apiRouter dedicado...");
  // Passar a instância `upload` configurada para `registerRoutes`
  await registerRoutes(apiRouter, upload);
  
  app.use('/api', apiRouter); 
  console.log("Router da API montado em /api.");
  
  let vite: any = null;

  if (app.get("env") === "development") {
    console.log("Configurando Vite para desenvolvimento...");
    vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'info'
    });
    console.log("Instância do Vite criada.");
    
    // Adicionar middlewares do Vite DEPOIS do /api router
    console.log("Adicionando middlewares do Vite...");
    app.use(vite.middlewares);
    console.log("Middlewares do Vite adicionados.");
  }

  // Manipulador de erros da API (DEPOIS do Vite middleware, ANTES do fallback geral se houver)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("ERRO NA API:", err); 
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    if (!res.headersSent) {
        res.status(status).json({ message });
    } else {
        res.end();
    }
  });
  console.log("Manipulador de erros da API registrado.");

  // Servir Estáticos (Produção) OU ADICIONAR FALLBACK VITE (Dev)
  if (app.get("env") !== "development") {
    console.log("Configurando para servir estáticos (produção)...");
    serveStatic(app); 
  } else if (vite) {
    // READICIONAR Catch-all do Vite (DEVE SER O ÚLTIMO middleware)
    console.log("Registrando fallback do Vite para index.html...");
    app.use("*", async (req, res, next) => {
        const url = req.originalUrl;
        console.log(`[Vite Fallback] Recebida requisição para: ${url}`);
        try {
            const clientTemplate = path.resolve(import.meta.dirname, "..", "client", "index.html");
            let template = await fs.promises.readFile(clientTemplate, "utf-8");
            template = await vite.transformIndexHtml(url, template);
            console.log("[Vite Fallback] Enviando index.html transformado.");
            res.status(200).set({ "Content-Type": "text/html" }).end(template);
        } catch (e) {
            if (e instanceof Error) vite.ssrFixStacktrace(e);
            console.error("[Vite Fallback] Erro:", e);
            next(e); 
        }
    });
    console.log("Fallback do Vite registrado.");
  } 

  // ===== CRIAR HTTP SERVER E WEBSOCKET SERVER =====
  const portString = process.env.PORT || "5000";
  const port = parseInt(portString, 10);
  
  httpServer.listen(port, "0.0.0.0", () => {
     log(`serving on port ${port}`);
  });

})();

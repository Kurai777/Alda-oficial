import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./vite";
import { createServer as createViteServer } from 'vite';
import session from "express-session";
import testRoutes from "./test-routes";
import { reprocessRouter } from "./routes-reprocessor.js";
import { pdfRouter } from "./pdf-routes";
import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { addS3ImageRoutes } from "./s3-image-routes";

// Importar módulos de banco de dados e storage
import { migrate } from "./db";
import { storage } from "./storage";

const app = express();
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
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 1 semana
    httpOnly: true
  }
}));

// Registrar rotas de teste
//app.use('/api/test', testRoutes);

// Registrar rotas de reprocessamento
//app.use('/api/admin', reprocessRouter);

// Registrar rotas especiais para PDF (versão original)
//app.use('/api/pdf', pdfRouter);

// Importar e registrar rotas simplificadas para PDF
import { pdfRouterSimple } from './pdf-routes-simple';
app.use('/api/pdf', pdfRouterSimple);

(async () => {
  // Executar migração
  try {
    console.log("Iniciando migração do banco de dados...");
    await migrate();
    console.log("Migração concluída com sucesso!");
  } catch (error) {
    console.error("Erro durante migração do banco de dados:", error);
  }

  // ===== ADICIONAR CONFIGURAÇÃO S3 E ROTAS DE IMAGEM =====
  // === COMENTAR TEMPORARIAMENTE ADD S3 IMAGE ROUTES ===
  /*
  try {
      const { addS3ImageRoutes } = await import('./s3-image-routes');
      await addS3ImageRoutes(app); // <<< Adicionar rotas de imagem ao app principal
      console.log("Rotas de imagem S3 adicionadas ao app.");
  } catch (error) {
      console.error('ERRO CRÍTICO ao adicionar rotas de imagem S3:', error);
  }
  */
  // ======================================================
  
  // ===== REGISTRAR ROTAS PRINCIPAIS DA API DIRETAMENTE NO APP =====
  console.log("Registrando rotas principais da API no app...");
  await registerRoutes(app); 
  console.log("Rotas principais da API registradas.");
  // ===============================================================
  
  let vite: any = null;

  // Configurar e Adicionar Middlewares do Vite (se dev)
  if (app.get("env") === "development") {
    console.log("Configurando Vite para desenvolvimento...");
    vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'info'
    });
    console.log("Instância do Vite criada.");
    
    // Adicionar middlewares do Vite AQUI (depois das rotas API)
    console.log("Adicionando middlewares do Vite...");
    app.use(vite.middlewares); // <<< Manter DEPOIS do /api router
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
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  wss.on('connection', (ws) => {
    console.log('Cliente WebSocket conectado');
    ws.on('message', (message) => {
      // ... (lógica broadcast)
    });
    ws.on('close', () => {
      console.log('Cliente WebSocket desconectado');
    });
  });
  console.log("Servidor WebSocket configurado.");
  // ================================================

  // Iniciar servidor USANDO o httpServer
  const port = 5000;
  httpServer.listen(port, "0.0.0.0", () => {
     log(`serving on port ${port}`);
  });

})();

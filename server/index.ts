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
app.use('/api/test', testRoutes);

// Registrar rotas de reprocessamento
app.use('/api/admin', reprocessRouter);

// Registrar rotas especiais para PDF
app.use('/api/pdf', pdfRouter);

(async () => {
  // Executar migração
  try {
    console.log("Iniciando migração do banco de dados...");
    await migrate();
    console.log("Migração concluída com sucesso!");
  } catch (error) {
    console.error("Erro durante migração do banco de dados:", error);
  }

  // ===== MOVER REGISTRO DAS ROTAS PRINCIPAIS PARA ANTES DO VITE =====
  // REGISTRAR ROTAS DA API PRIMEIRO (DENTRO DO ASYNC)
  console.log("Registrando rotas principais da API...");
  await registerRoutes(app); // Manter dentro do async, mas ANTES do Vite
  console.log("Rotas principais da API registradas.");
  // ==================================================================
  
  let vite: any = null; // Variável para guardar instância do Vite

  // 1. CONFIGURAR VITE (se dev) - AGORA DEPOIS DAS ROTAS
  if (app.get("env") === "development") {
    console.log("Configurando Vite para desenvolvimento (fase 1)...");
    vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'info'
    });
    console.log("Instância do Vite criada.");
  }

  // 2. ADICIONAR MIDDLEWARES DO VITE (se dev)
  if (vite) {
      console.log("Adicionando middlewares do Vite (exceto fallback)...");
      app.use(vite.middlewares); 
      console.log("Middlewares do Vite adicionados.");
  }

  // 3. Manipulador de erros da API (antes do fallback HTML)
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

  // 4. SERVIR ESTÁTICOS (produção) OU CATCH-ALL VITE (dev)
  if (app.get("env") !== "development") {
    console.log("Configurando para servir estáticos (produção)...");
    serveStatic(app); 
  } else if (vite) {
    // Catch-all do Vite (DEVE SER O ÚLTIMO middleware)
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

  // Iniciar servidor
  const port = 5000;
  app.listen(port, "0.0.0.0", () => {
     log(`serving on port ${port}`);
  });

})();

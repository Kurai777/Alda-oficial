import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./vite";
import { createServer as createViteServer } from 'vite';
import session from "express-session";
import testRoutes from "./test-routes";
import { reprocessRouter } from "./routes-reprocessor.js";
import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";

// Importar módulos de banco de dados e storage
import { migrate } from "./db";
import { storage } from "./storage";

const app = express();
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: false, limit: '100mb' }));

// Registrar rotas de teste
app.use('/api/test', testRoutes);

// Registrar rotas de reprocessamento
app.use('/api/admin', reprocessRouter);

// Configuração da sessão
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

// COMENTAR TEMPORARIAMENTE O MIDDLEWARE DE LOG
/*
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});
*/

(async () => {
  // Executar migração para garantir que as tabelas existam
  try {
    console.log("Iniciando migração do banco de dados...");
    await migrate();
    console.log("Migração concluída com sucesso!");
  } catch (error) {
    console.error("Erro durante migração do banco de dados:", error);
  }
  
  const server = await registerRoutes(app);

  // Manipulador de erros da API (deve vir ANTES do fallback do Vite)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("ERRO NA API:", err); // Logar erro da API
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    // Garantir que resposta seja JSON
    if (!res.headersSent) {
        res.status(status).json({ message });
    } else {
        res.end();
    }
    // Não chamar next(err) aqui para não cair no fallback HTML
  });

  // Configurar Vite ou Estático
  if (app.get("env") === "development") {
    console.log("Configurando Vite para desenvolvimento...");
    const vite = await createViteServer({
        server: { middlewareMode: true }, // Usar modo middleware simples
        appType: 'custom',
        logLevel: 'info'
    });
    // Usar APENAS os middlewares do Vite, SEM o catch-all manual
    app.use(vite.middlewares);
    console.log("Middlewares do Vite adicionados.");

    // READICIONAR Catch-all do Vite para servir index.html
    app.use("*", async (req, res, next) => {
        const url = req.originalUrl;
        console.log(`[Vite Fallback] Recebida requisição para: ${url}`);
        try {
            const clientTemplate = path.resolve(import.meta.dirname, "..", "client", "index.html");
            let template = await fs.promises.readFile(clientTemplate, "utf-8");
            // Injetar HMR e outros scripts do Vite
            template = await vite.transformIndexHtml(url, template);
            console.log("[Vite Fallback] Enviando index.html transformado.");
            res.status(200).set({ "Content-Type": "text/html" }).end(template);
        } catch (e) {
            if (e instanceof Error) vite.ssrFixStacktrace(e);
            console.error("[Vite Fallback] Erro:", e);
            next(e); // Passar erro para o próximo handler
        }
    });

  } else {
    console.log("Configurando para servir estáticos (produção)...");
    serveStatic(app); // serveStatic já inclui o fallback para index.html
  }

  // Iniciar servidor
  const port = 5000;
  app.listen(port, "0.0.0.0", () => {
     log(`serving on port ${port}`);
  });

})();

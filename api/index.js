// Ponto de entrada para serverless API na Vercel
import { createServer } from 'http';
import { registerRoutes } from '../server/routes.js';
import express from 'express';
import session from 'express-session';
import { storage } from '../server/storage.js';
import cors from 'cors';

// Configurar aplicação Express
const app = express();

// Middleware para parsing de JSON e URL encoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configurar CORS para ambiente de produção
app.use(cors({
  origin: process.env.VERCEL_URL || '*',
  credentials: true
}));

// Configurar sessão
const sessionSettings = {
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  store: storage.sessionStore,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 1 semana
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
};

app.use(session(sessionSettings));

// Registrar rotas
const server = registerRoutes(app);

// Exportar para uso com serverless
export default server;
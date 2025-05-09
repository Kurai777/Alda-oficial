import { Router, type Request, type Response, type NextFunction } from "express";
import bcrypt from 'bcrypt';
import { storage } from "./storage"; // Ajuste o caminho se necessário
import type { InsertUser } from '@shared/schema'; // Ajuste o caminho se necessário

// HttpError será gerenciado pelo globalErrorHandler em server/routes.ts
// SALT_ROUNDS é definido aqui pois é específico para hashing de senhas em auth.
const SALT_ROUNDS = 10;

// Middleware requireAuth ajustado para usar next(err)
// Este middleware é específico para este router, ou poderia ser importado de um local comum
// se o globalErrorHandler e HttpError estiverem acessíveis/definidos adequadamente.
const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session || !req.session.userId) {
    const err: Error & { status?: number, isOperational?: boolean } = new Error("Autenticação necessária.");
    err.status = 401;
    err.isOperational = true;
    return next(err); // Passa para o globalErrorHandler
  }
  next();
};

const authRouter = Router();

// ========================================
// ROTAS DE AUTENTICAÇÃO (SESSÃO + BCRYPT)
// ========================================

// Registro de Usuário
authRouter.post("/backend/auth/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name, companyName } = req.body;
    if (!email || !password || !name) {
      const err: Error & { status?: number, isOperational?: boolean } = new Error("Email, senha e nome são obrigatórios");
      err.status = 400; err.isOperational = true; return next(err);
    }
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await storage.createUser({
      email, password: hashedPassword, name, companyName: companyName || "Empresa Padrão",
    });
    req.session.userId = user.id;
    return res.status(201).json({
      id: user.id, email: user.email, name: user.name, companyName: user.companyName
    });
  } catch (error: any) {
    if (error.message && error.message.includes('UNIQUE constraint failed: users.email')) { // Exemplo de checagem de erro específico do SQLite/Drizzle
        const err: Error & { status?: number, isOperational?: boolean } = new Error("Este email já está cadastrado.");
        err.status = 409; // Conflict
        err.isOperational = true;
        return next(err);
    }
    console.error("[AuthRoute] Erro ao registrar usuário:", error);
    return next(error);
  }
});

// Login de Usuário
authRouter.post("/backend/auth/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      const err: Error & { status?: number, isOperational?: boolean } = new Error("Email e senha são obrigatórios");
      err.status = 400; err.isOperational = true; return next(err);
    }
    const user = await storage.getUserByEmail(email);
    if (!user) {
      const err: Error & { status?: number, isOperational?: boolean } = new Error("Credenciais inválidas (email não encontrado)");
      err.status = 401; err.isOperational = true; return next(err);
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      const err: Error & { status?: number, isOperational?: boolean } = new Error("Credenciais inválidas (senha incorreta)");
      err.status = 401; err.isOperational = true; return next(err);
    }
    req.session.userId = user.id;
    return res.status(200).json({
      id: user.id, email: user.email, name: user.name, companyName: user.companyName
    });
  } catch (error) {
    console.error("[AuthRoute] Erro no login:", error);
    return next(error);
  }
});

// Obter Usuário Logado
authRouter.get("/backend/auth/me", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await storage.getUser(req.session.userId!);
    if (!user) {
      req.session.destroy(() => {}); // Limpar sessão inválida
      const err: Error & { status?: number, isOperational?: boolean } = new Error("Usuário da sessão não encontrado.");
      err.status = 401; err.isOperational = true; return next(err);
    }
    return res.status(200).json({
      id: user.id, email: user.email, name: user.name, companyName: user.companyName
    });
  } catch (error) {
    console.error("[AuthRoute] Erro ao obter /auth/me:", error);
    return next(error);
  }
});

// Atualizar Perfil do Usuário
authRouter.put("/backend/auth/me", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.session.userId!;
    const receivedData = req.body;
    if (!receivedData || typeof receivedData !== 'object' || Object.keys(receivedData).length === 0) {
      const err: Error & { status?: number, isOperational?: boolean } = new Error("Dados inválidos ou vazios para atualização.");
      err.status = 400; err.isOperational = true; return next(err);
    }

    const updateDataForDb: Partial<InsertUser & { company_logo_url?: string | null, company_address?: string | null, company_phone?: string | null, company_cnpj?: string | null, quote_payment_terms?: string | null, quote_validity_days?: number | null, cash_discount_percentage?: number | null }> = {};
    const allowedFields: string[] = ['name', 'companyName', 'companyAddress', 'companyPhone', 'companyCnpj', 'companyLogoUrl', 'quotePaymentTerms', 'quoteValidityDays', 'cashDiscountPercentage'];
    const dbFieldMapping: Record<string, string> = {
        companyAddress: 'company_address',
        companyPhone: 'company_phone',
        companyCnpj: 'company_cnpj',
        companyLogoUrl: 'company_logo_url',
        quotePaymentTerms: 'quote_payment_terms',
        quoteValidityDays: 'quote_validity_days',
        cashDiscountPercentage: 'cash_discount_percentage'
    };

    for (const key of allowedFields) {
        if (key in receivedData && receivedData[key] !== undefined) {
            const dbKey = dbFieldMapping[key] || key;
            (updateDataForDb as any)[dbKey] = receivedData[key];
        }
    }
    
    if (Object.keys(updateDataForDb).length === 0) {
      const err: Error & { status?: number, isOperational?: boolean } = new Error("Nenhum dado válido fornecido para atualização.");
      err.status = 400; err.isOperational = true; return next(err);
    }

    const updatedUser = await storage.updateUser(userId, updateDataForDb);
    if (!updatedUser) {
      const err: Error & { status?: number, isOperational?: boolean } = new Error("Usuário não encontrado para atualização.");
      err.status = 404; err.isOperational = true; return next(err);
    }
    const { password, ...userToSend } = updatedUser;
    return res.status(200).json(userToSend);
  } catch (error) {
    console.error("[AuthRoute] Erro ao atualizar perfil:", error);
    return next(error);
  }
});

// Logout de Usuário
authRouter.post("/backend/auth/logout", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  // requireAuth garante que req.session existe
  req.session.destroy((err) => {
    if (err) {
      console.error("[AuthRoute] Erro ao destruir sessão no logout:", err);
      const httpErr: Error & { status?: number, isOperational?: boolean } = new Error("Erro ao encerrar sessão");
      httpErr.status = 500;
      return next(httpErr);
    }
    res.clearCookie('connect.sid'); // Nome padrão do cookie de sessão do express-session
    return res.status(200).json({ message: "Logout realizado com sucesso" });
  });
});

// ===================================================
// ROTAS COMPATÍVEIS COM O CLIENTE (/api/...)
// ===================================================

authRouter.post("/api/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name, companyName } = req.body;
    if (!email || !password || !name) {
      const err: Error & { status?: number, isOperational?: boolean } = new Error("Email, senha e nome são obrigatórios");
      err.status = 400; err.isOperational = true; return next(err);
    }
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await storage.createUser({
      email, password: hashedPassword, name, companyName: companyName || "Empresa Padrão",
    });
    req.session.userId = user.id;
    return res.status(201).json(
      { id: user.id, email: user.email, name: user.name, companyName: user.companyName }
    );
  } catch (error: any) {
     if (error.message && error.message.includes('UNIQUE constraint failed: users.email')) {
        const err: Error & { status?: number, isOperational?: boolean } = new Error("Este email já está cadastrado.");
        err.status = 409; err.isOperational = true; return next(err);
    }
    console.error("[AuthRoute] Erro em /api/register:", error);
    return next(error);
  }
});

authRouter.post("/api/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      const err: Error & { status?: number, isOperational?: boolean } = new Error("Email e senha são obrigatórios");
      err.status = 400; err.isOperational = true; return next(err);
    }
    const user = await storage.getUserByEmail(email);
    if (!user) {
      const err: Error & { status?: number, isOperational?: boolean } = new Error("Credenciais inválidas");
      err.status = 401; err.isOperational = true; return next(err);
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      const err: Error & { status?: number, isOperational?: boolean } = new Error("Credenciais inválidas");
      err.status = 401; err.isOperational = true; return next(err);
    }
    req.session.userId = user.id;
    return res.status(200).json(
      { id: user.id, email: user.email, name: user.name, companyName: user.companyName }
    );
  } catch (error) {
    console.error("[AuthRoute] Erro em /api/login:", error);
    return next(error);
  }
});

authRouter.get("/api/user", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await storage.getUser(req.session.userId!);
    if (!user) {
      req.session.destroy(() => {});
      const err: Error & { status?: number, isOperational?: boolean } = new Error("Usuário da sessão não encontrado.");
      err.status = 401; err.isOperational = true; return next(err);
    }
    return res.status(200).json(
      { id: user.id, email: user.email, name: user.name, companyName: user.companyName }
    );
  } catch (error) {
    console.error("[AuthRoute] Erro em /api/user:", error);
    return next(error);
  }
});

authRouter.post("/api/logout", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("[AuthRoute] Erro ao destruir sessão em /api/logout:", err);
      const httpErr: Error & { status?: number, isOperational?: boolean } = new Error("Erro ao encerrar sessão");
      httpErr.status = 500;
      return next(httpErr);
    }
    res.clearCookie('connect.sid');
    return res.status(200).json({ message: "Logout realizado com sucesso" });
  });
});

export default authRouter; 
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.pool = void 0;
exports.migrate = migrate;
var serverless_1 = require("@neondatabase/serverless");
var neon_serverless_1 = require("drizzle-orm/neon-serverless");
var ws_1 = require("ws");
var schema = require("@shared/schema");
serverless_1.neonConfig.webSocketConstructor = ws_1.default;
if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}
exports.pool = new serverless_1.Pool({ connectionString: process.env.DATABASE_URL });
exports.db = (0, neon_serverless_1.drizzle)(exports.pool, { schema: schema });
// Exportar uma função para executar migrações para criar tabelas se necessário
function migrate() {
    return __awaiter(this, void 0, void 0, function () {
        var tables, tableNames_1, requiredTables, missingTables, users, products, catalogs, quotes, moodboards, aiDesignProjects, aiDesignChatMessages, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('Verificando tabelas do banco de dados...');
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 19, , 20]);
                    return [4 /*yield*/, exports.pool.query("\n      SELECT table_name \n      FROM information_schema.tables \n      WHERE table_schema = 'public'\n    ")];
                case 2:
                    tables = _a.sent();
                    tableNames_1 = tables.rows.map(function (row) { return row.table_name; });
                    console.log('Tabelas existentes:', tableNames_1);
                    requiredTables = [
                        'users', 'products', 'catalogs', 'quotes', 'moodboards',
                        'ai_design_projects', 'ai_design_chat_messages'
                    ];
                    missingTables = requiredTables.filter(function (table) { return !tableNames_1.includes(table); });
                    if (!(missingTables.length > 0)) return [3 /*break*/, 17];
                    console.log('Tabelas a serem criadas:', missingTables);
                    users = schema.users, products = schema.products, catalogs = schema.catalogs, quotes = schema.quotes, moodboards = schema.moodboards, aiDesignProjects = schema.aiDesignProjects, aiDesignChatMessages = schema.aiDesignChatMessages;
                    if (!missingTables.includes('users')) return [3 /*break*/, 4];
                    console.log('Criando tabela users...');
                    return [4 /*yield*/, exports.pool.query("\n          CREATE TABLE IF NOT EXISTS users (\n            id SERIAL PRIMARY KEY,\n            email TEXT NOT NULL UNIQUE,\n            password TEXT NOT NULL,\n            company_name TEXT,\n            logo_url TEXT,\n            address TEXT,\n            phone TEXT,\n            created_at TIMESTAMP DEFAULT NOW()\n          )\n        ")];
                case 3:
                    _a.sent();
                    _a.label = 4;
                case 4:
                    if (!missingTables.includes('catalogs')) return [3 /*break*/, 6];
                    console.log('Criando tabela catalogs...');
                    return [4 /*yield*/, exports.pool.query("\n          CREATE TABLE IF NOT EXISTS catalogs (\n            id SERIAL PRIMARY KEY,\n            user_id INTEGER NOT NULL,\n            name TEXT NOT NULL,\n            description TEXT,\n            status TEXT DEFAULT 'pending',\n            image_url TEXT,\n            firestore_catalog_id TEXT,\n            created_at TIMESTAMP DEFAULT NOW()\n          )\n        ")];
                case 5:
                    _a.sent();
                    _a.label = 6;
                case 6:
                    if (!missingTables.includes('products')) return [3 /*break*/, 8];
                    console.log('Criando tabela products...');
                    return [4 /*yield*/, exports.pool.query("\n          CREATE TABLE IF NOT EXISTS products (\n            id SERIAL PRIMARY KEY,\n            user_id INTEGER NOT NULL,\n            catalog_id INTEGER NOT NULL,\n            name TEXT NOT NULL,\n            description TEXT,\n            code TEXT,\n            price NUMERIC,\n            category TEXT,\n            image_url TEXT,\n            colors TEXT[],\n            materials TEXT[],\n            sizes TEXT[],\n            width NUMERIC,\n            height NUMERIC,\n            depth NUMERIC,\n            created_at TIMESTAMP DEFAULT NOW()\n          )\n        ")];
                case 7:
                    _a.sent();
                    _a.label = 8;
                case 8:
                    if (!missingTables.includes('quotes')) return [3 /*break*/, 10];
                    console.log('Criando tabela quotes...');
                    return [4 /*yield*/, exports.pool.query("\n          CREATE TABLE IF NOT EXISTS quotes (\n            id SERIAL PRIMARY KEY,\n            user_id INTEGER NOT NULL,\n            client_name TEXT NOT NULL,\n            client_email TEXT,\n            client_phone TEXT,\n            status TEXT DEFAULT 'draft',\n            items JSONB DEFAULT '[]',\n            total_price NUMERIC DEFAULT 0,\n            notes TEXT,\n            created_at TIMESTAMP DEFAULT NOW()\n          )\n        ")];
                case 9:
                    _a.sent();
                    _a.label = 10;
                case 10:
                    if (!missingTables.includes('moodboards')) return [3 /*break*/, 12];
                    console.log('Criando tabela moodboards...');
                    return [4 /*yield*/, exports.pool.query("\n          CREATE TABLE IF NOT EXISTS moodboards (\n            id SERIAL PRIMARY KEY,\n            user_id INTEGER NOT NULL,\n            name TEXT NOT NULL,\n            description TEXT,\n            items JSONB DEFAULT '[]',\n            created_at TIMESTAMP DEFAULT NOW()\n          )\n        ")];
                case 11:
                    _a.sent();
                    _a.label = 12;
                case 12:
                    if (!missingTables.includes('ai_design_projects')) return [3 /*break*/, 14];
                    console.log('Criando tabela ai_design_projects...');
                    return [4 /*yield*/, exports.pool.query("\n          CREATE TABLE IF NOT EXISTS ai_design_projects (\n            id SERIAL PRIMARY KEY,\n            user_id INTEGER NOT NULL,\n            title TEXT NOT NULL,\n            status TEXT DEFAULT 'pending',\n            floor_plan_image_url TEXT,\n            render_image_url TEXT,\n            generated_floor_plan_url TEXT,\n            generated_render_url TEXT,\n            quote_id INTEGER,\n            moodboard_id INTEGER,\n            created_at TIMESTAMP DEFAULT NOW()\n          )\n        ")];
                case 13:
                    _a.sent();
                    _a.label = 14;
                case 14:
                    if (!missingTables.includes('ai_design_chat_messages')) return [3 /*break*/, 16];
                    console.log('Criando tabela ai_design_chat_messages...');
                    return [4 /*yield*/, exports.pool.query("\n          CREATE TABLE IF NOT EXISTS ai_design_chat_messages (\n            id SERIAL PRIMARY KEY,\n            project_id INTEGER NOT NULL,\n            role TEXT NOT NULL,\n            content TEXT NOT NULL,\n            attachment_url TEXT,\n            created_at TIMESTAMP DEFAULT NOW()\n          )\n        ")];
                case 15:
                    _a.sent();
                    _a.label = 16;
                case 16:
                    console.log('Tabelas criadas com sucesso.');
                    return [3 /*break*/, 18];
                case 17:
                    console.log('Todas as tabelas necessárias já existem.');
                    _a.label = 18;
                case 18: return [3 /*break*/, 20];
                case 19:
                    error_1 = _a.sent();
                    console.error('Erro ao verificar/criar tabelas:', error_1);
                    throw error_1;
                case 20: return [2 /*return*/];
            }
        });
    });
}

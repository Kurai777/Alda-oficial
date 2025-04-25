import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

// Exportar uma função para executar migrações para criar tabelas se necessário
export async function migrate() {
  console.log('Verificando tabelas do banco de dados...');
  // Verificar se as tabelas existem e criá-las se necessário
  try {
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    // Verificar se as tabelas principais existem
    const tableNames = tables.rows.map(row => row.table_name);
    console.log('Tabelas existentes:', tableNames);
    
    // Lista de tabelas necessárias
    const requiredTables = [
      'users', 'products', 'catalogs', 'quotes', 'moodboards', 
      'ai_design_projects', 'ai_design_chat_messages'
    ];
    
    // Verificar quais tabelas precisam ser criadas
    const missingTables = requiredTables.filter(
      table => !tableNames.includes(table)
    );
    
    if (missingTables.length > 0) {
      console.log('Tabelas a serem criadas:', missingTables);
      
      // Criar as tabelas usando os esquemas definidos
      const { users, products, catalogs, quotes, moodboards, aiDesignProjects, aiDesignChatMessages } = schema;
      
      // Criar tabela de usuários
      if (missingTables.includes('users')) {
        console.log('Criando tabela users...');
        await pool.query(`
          CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            company_name TEXT,
            logo_url TEXT,
            address TEXT,
            phone TEXT,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
      }
      
      // Criar tabela de catálogos
      if (missingTables.includes('catalogs')) {
        console.log('Criando tabela catalogs...');
        await pool.query(`
          CREATE TABLE IF NOT EXISTS catalogs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'pending',
            image_url TEXT,
            firestore_catalog_id TEXT,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
      }
      
      // Criar tabela de produtos
      if (missingTables.includes('products')) {
        console.log('Criando tabela products...');
        await pool.query(`
          CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            catalog_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            code TEXT,
            price NUMERIC,
            category TEXT,
            image_url TEXT,
            colors TEXT[],
            materials TEXT[],
            sizes TEXT[],
            width NUMERIC,
            height NUMERIC,
            depth NUMERIC,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
      }
      
      // Criar tabela de cotações
      if (missingTables.includes('quotes')) {
        console.log('Criando tabela quotes...');
        await pool.query(`
          CREATE TABLE IF NOT EXISTS quotes (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            client_name TEXT NOT NULL,
            client_email TEXT,
            client_phone TEXT,
            status TEXT DEFAULT 'draft',
            items JSONB DEFAULT '[]',
            total_price NUMERIC DEFAULT 0,
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
      }
      
      // Criar tabela de moodboards
      if (missingTables.includes('moodboards')) {
        console.log('Criando tabela moodboards...');
        await pool.query(`
          CREATE TABLE IF NOT EXISTS moodboards (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            items JSONB DEFAULT '[]',
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
      }
      
      // Criar tabela de projetos de design com IA
      if (missingTables.includes('ai_design_projects')) {
        console.log('Criando tabela ai_design_projects...');
        await pool.query(`
          CREATE TABLE IF NOT EXISTS ai_design_projects (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            floor_plan_image_url TEXT,
            render_image_url TEXT,
            generated_floor_plan_url TEXT,
            generated_render_url TEXT,
            quote_id INTEGER,
            moodboard_id INTEGER,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
      }
      
      // Criar tabela de mensagens de chat para projetos de design com IA
      if (missingTables.includes('ai_design_chat_messages')) {
        console.log('Criando tabela ai_design_chat_messages...');
        await pool.query(`
          CREATE TABLE IF NOT EXISTS ai_design_chat_messages (
            id SERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            attachment_url TEXT,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
      }
      
      console.log('Tabelas criadas com sucesso.');
    } else {
      console.log('Todas as tabelas necessárias já existem.');
    }
  } catch (error) {
    console.error('Erro ao verificar/criar tabelas:', error);
    throw error;
  }
}

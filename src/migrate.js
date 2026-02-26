// src/migrate.js — Roda migrations e seeds automaticamente no Railway
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('📦 Verificando banco de dados...');

    // Verifica se o banco já foi inicializado (tabela roles existe)
    const { rows } = await client.query(`
      SELECT COUNT(*) as count FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'roles'
    `);

    if (parseInt(rows[0].count) > 0) {
      console.log('✔ Banco já inicializado — pulando migrations.');
      return;
    }

    console.log('🔧 Rodando migration inicial...');
    const schemaPath = path.join(__dirname, '../../database/migrations/001_initial_schema.sql');

    if (!fs.existsSync(schemaPath)) {
      // Fallback: schema embutido no próprio script
      console.log('⚠ Arquivo SQL não encontrado, usando schema embutido...');
      await runEmbeddedSchema(client);
    } else {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await client.query(schema);
      console.log('✔ Schema aplicado');

      const seedPath = path.join(__dirname, '../../database/seeds/001_initial_data.sql');
      if (fs.existsSync(seedPath)) {
        const seed = fs.readFileSync(seedPath, 'utf8');
        await client.query(seed);
        console.log('✔ Seeds inseridos');
      }
    }

    console.log('✅ Banco pronto!');
  } catch (err) {
    console.error('❌ Erro na migration:', err.message);
    // Não encerra — deixa o servidor tentar mesmo assim
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

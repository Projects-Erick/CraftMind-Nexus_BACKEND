// database.js — PostgreSQL com conversão automática de ? → $1, $2...
const { Pool } = require('pg');
const logger   = require('./logger');

class Database {
  constructor() { this.pool = null; }

  async connect() {
    // Railway fornece DATABASE_URL; fallback para variáveis individuais (Termux/local)
    const poolConfig = process.env.DATABASE_URL
      ? {
          connectionString: process.env.DATABASE_URL,
          ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        }
      : {
          host:     process.env.DB_HOST     || 'localhost',
          port:     parseInt(process.env.DB_PORT) || 5432,
          user:     process.env.DB_USER     || 'craftmind',
          password: process.env.DB_PASSWORD || '',
          database: process.env.DB_NAME     || 'craftmind_nexus',
        };

    this.pool = new Pool({
      ...poolConfig,
      max:      20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    this.pool.on('error', (err) => logger.error('PG pool error:', err));
    await this.pool.query('SELECT 1');
    logger.info('✔ PostgreSQL conectado com sucesso');
    return this.pool;
  }

  // Converte ? → $1, $2, $3... automaticamente (mantém rotas inalteradas)
  _convert(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  async query(sql, params = []) {
    try {
      const { rows } = await this.pool.query(this._convert(sql), params);
      return rows;
    } catch (err) {
      logger.error('DB query error:', { sql: sql.substring(0, 120), error: err.message });
      throw err;
    }
  }

  async queryOne(sql, params = []) {
    const rows = await this.query(sql, params);
    return rows[0] || null;
  }

  // INSERT ... RETURNING id → retorna { insertId }
  async insert(sql, params = []) {
    const cleanSql = sql.replace(/;?\s*$/, '');
    const pgSql    = this._convert(cleanSql) + ' RETURNING id';
    try {
      const { rows } = await this.pool.query(pgSql, params);
      return { insertId: rows[0]?.id };
    } catch (err) {
      logger.error('DB insert error:', { sql: pgSql.substring(0, 120), error: err.message });
      throw err;
    }
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    await client.query('BEGIN');
    try {
      const result = await callback({
        query: async (sql, params = []) => {
          const { rows } = await client.query(this._convert(sql), params);
          return rows;
        },
        insert: async (sql, params = []) => {
          const pgSql = this._convert(sql.replace(/;?\s*$/, '')) + ' RETURNING id';
          const { rows } = await client.query(pgSql, params);
          return { insertId: rows[0]?.id };
        }
      });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = new Database();

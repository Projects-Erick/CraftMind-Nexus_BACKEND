// src/migrate.js — Roda migrations e seeds automaticamente no Railway
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function runEmbeddedSchema(client) {
  console.log('🔧 Aplicando schema embutido...');

  await client.query(`
    -- Tipos ENUM
    DO $$ BEGIN
      CREATE TYPE role_name       AS ENUM ('admin', 'secretary', 'teacher', 'student'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE TYPE question_type   AS ENUM ('multiple_choice', 'true_false', 'open', 'code', 'design'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE TYPE difficulty_type AS ENUM ('easy', 'medium', 'hard'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE TYPE assignment_type AS ENUM ('exam', 'quiz', 'practice_code', 'practice_design', 'homework'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE TYPE assign_status   AS ENUM ('draft', 'published', 'closed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE TYPE sub_status      AS ENUM ('in_progress', 'submitted', 'graded', 'late'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE TYPE code_lang       AS ENUM ('java', 'javascript', 'python'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE TYPE compile_status  AS ENUM ('pending', 'success', 'error', 'timeout'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE TYPE run_status      AS ENUM ('pending', 'success', 'error', 'timeout', 'wrong_answer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE TYPE xp_source       AS ENUM ('submission', 'bonus', 'achievement', 'attendance', 'penalty'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE TYPE notif_type      AS ENUM ('info', 'success', 'warning', 'assignment', 'grade'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE TYPE mc_act_type     AS ENUM ('quiz_start', 'quiz_complete', 'code_submit', 'design_submit', 'assignment_open'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    -- Trigger de updated_at
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $fn$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $fn$ LANGUAGE plpgsql;

    -- ROLES
    CREATE TABLE IF NOT EXISTS roles (
      id          SERIAL PRIMARY KEY,
      name        role_name NOT NULL UNIQUE,
      description VARCHAR(255),
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
    INSERT INTO roles (name, description) VALUES
      ('admin',     'Acesso total ao sistema'),
      ('secretary', 'Gestão escolar e relatórios'),
      ('teacher',   'Criação de conteúdo e avaliação'),
      ('student',   'Realização de atividades')
    ON CONFLICT (name) DO NOTHING;

    -- USERS
    CREATE TABLE IF NOT EXISTS users (
      id                 SERIAL PRIMARY KEY,
      username           VARCHAR(50)  NOT NULL UNIQUE,
      email              VARCHAR(100) UNIQUE,
      password_hash      VARCHAR(255) NOT NULL,
      role_id            INTEGER      NOT NULL REFERENCES roles(id),
      minecraft_uuid     VARCHAR(36)  UNIQUE,
      minecraft_username VARCHAR(16),
      display_name       VARCHAR(100),
      avatar_url         VARCHAR(500),
      bio                TEXT,
      is_active          BOOLEAN      DEFAULT TRUE,
      last_login         TIMESTAMPTZ  NULL,
      created_at         TIMESTAMPTZ  DEFAULT NOW(),
      updated_at         TIMESTAMPTZ  DEFAULT NOW()
    );
    DROP TRIGGER IF EXISTS trg_users_upd ON users;
    CREATE TRIGGER trg_users_upd BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- SESSIONS
    CREATE TABLE IF NOT EXISTS sessions (
      id         VARCHAR(128) PRIMARY KEY,
      user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      VARCHAR(512) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ  NOT NULL,
      ip_address VARCHAR(45),
      user_agent TEXT,
      created_at TIMESTAMPTZ  DEFAULT NOW()
    );

    -- SCHOOL YEARS
    CREATE TABLE IF NOT EXISTS school_years (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(50) NOT NULL,
      level       VARCHAR(20) NOT NULL CHECK (level IN ('fundamental','medio')),
      year_number INTEGER     NOT NULL,
      is_active   BOOLEAN     DEFAULT TRUE,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
    INSERT INTO school_years (name, level, year_number) VALUES
      ('6º Ano - Ensino Fundamental', 'fundamental', 6),
      ('7º Ano - Ensino Fundamental', 'fundamental', 7),
      ('8º Ano - Ensino Fundamental', 'fundamental', 8),
      ('9º Ano - Ensino Fundamental', 'fundamental', 9),
      ('1º Ano - Ensino Médio',       'medio',       1),
      ('2º Ano - Ensino Médio',       'medio',       2),
      ('3º Ano - Ensino Médio',       'medio',       3)
    ON CONFLICT DO NOTHING;

    -- SUBJECTS
    CREATE TABLE IF NOT EXISTS subjects (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(100) NOT NULL,
      code        VARCHAR(20)  NOT NULL UNIQUE,
      level       VARCHAR(20)  NOT NULL DEFAULT 'ambos' CHECK (level IN ('fundamental','medio','ambos')),
      color       VARCHAR(7)   DEFAULT '#3B82F6',
      icon        VARCHAR(50)  DEFAULT 'book',
      description TEXT,
      is_active   BOOLEAN      DEFAULT TRUE,
      created_at  TIMESTAMPTZ  DEFAULT NOW()
    );
    INSERT INTO subjects (name, code, level, color, icon) VALUES
      ('Matemática',        'MAT',  'ambos',       '#EF4444', 'calculator'),
      ('Língua Portuguesa', 'PORT', 'ambos',       '#3B82F6', 'book-open'),
      ('Ciências',          'CIEN', 'fundamental', '#22C55E', 'flask'),
      ('História',          'HIST', 'ambos',       '#F59E0B', 'landmark'),
      ('Geografia',         'GEO',  'ambos',       '#14B8A6', 'globe'),
      ('Inglês',            'ING',  'ambos',       '#8B5CF6', 'languages'),
      ('Artes',             'ART',  'fundamental', '#EC4899', 'palette'),
      ('Educação Física',   'EDF',  'fundamental', '#F97316', 'activity'),
      ('Física',            'FIS',  'medio',       '#6366F1', 'zap'),
      ('Química',           'QUIM', 'medio',       '#10B981', 'atom'),
      ('Biologia',          'BIO',  'medio',       '#84CC16', 'dna'),
      ('Filosofia',         'FIL',  'medio',       '#94A3B8', 'brain'),
      ('Sociologia',        'SOC',  'medio',       '#F472B6', 'users'),
      ('Literatura',        'LIT',  'medio',       '#A78BFA', 'feather'),
      ('Redação',           'RED',  'medio',       '#60A5FA', 'pencil')
    ON CONFLICT (code) DO NOTHING;

    -- CLASSES
    CREATE TABLE IF NOT EXISTS classes (
      id             SERIAL PRIMARY KEY,
      name           VARCHAR(100) NOT NULL,
      code           VARCHAR(20)  NOT NULL UNIQUE,
      school_year_id INTEGER      NOT NULL REFERENCES school_years(id),
      academic_year  INTEGER      NOT NULL DEFAULT EXTRACT(YEAR FROM NOW())::INT,
      max_students   INTEGER      DEFAULT 40,
      is_active      BOOLEAN      DEFAULT TRUE,
      created_at     TIMESTAMPTZ  DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS class_students (
      id          SERIAL PRIMARY KEY,
      class_id    INTEGER NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
      student_id  INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
      enrolled_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (class_id, student_id)
    );
    CREATE TABLE IF NOT EXISTS class_teachers (
      id          SERIAL PRIMARY KEY,
      class_id    INTEGER NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
      teacher_id  INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
      subject_id  INTEGER NOT NULL REFERENCES subjects(id),
      assigned_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (class_id, teacher_id, subject_id)
    );

    -- QUESTIONS
    CREATE TABLE IF NOT EXISTS questions (
      id               SERIAL PRIMARY KEY,
      teacher_id       INTEGER         NOT NULL REFERENCES users(id),
      subject_id       INTEGER         NOT NULL REFERENCES subjects(id),
      school_year_id   INTEGER         NOT NULL REFERENCES school_years(id),
      title            VARCHAR(500)    NOT NULL,
      content          TEXT            NOT NULL,
      question_type    question_type   NOT NULL,
      difficulty       difficulty_type NOT NULL DEFAULT 'medium',
      points           NUMERIC(5,2)    DEFAULT 10.00,
      time_limit_seconds INTEGER       DEFAULT 0,
      explanation      TEXT,
      tags             JSONB,
      is_active        BOOLEAN         DEFAULT TRUE,
      created_at       TIMESTAMPTZ     DEFAULT NOW(),
      updated_at       TIMESTAMPTZ     DEFAULT NOW()
    );
    DROP TRIGGER IF EXISTS trg_questions_upd ON questions;
    CREATE TRIGGER trg_questions_upd BEFORE UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE IF NOT EXISTS question_options (
      id            SERIAL PRIMARY KEY,
      question_id   INTEGER  NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      option_letter CHAR(1)  NOT NULL,
      content       TEXT     NOT NULL,
      is_correct    BOOLEAN  DEFAULT FALSE,
      order_index   INTEGER  DEFAULT 0
    );

    -- ASSIGNMENTS
    CREATE TABLE IF NOT EXISTS assignments (
      id                 SERIAL PRIMARY KEY,
      teacher_id         INTEGER         NOT NULL REFERENCES users(id),
      class_id           INTEGER         NOT NULL REFERENCES classes(id),
      subject_id         INTEGER         NOT NULL REFERENCES subjects(id),
      title              VARCHAR(255)    NOT NULL,
      description        TEXT,
      type               assignment_type NOT NULL,
      status             assign_status   DEFAULT 'draft',
      max_score          NUMERIC(5,2)    DEFAULT 100.00,
      xp_reward          INTEGER         DEFAULT 100,
      time_limit_minutes INTEGER         DEFAULT 0,
      starts_at          TIMESTAMPTZ     NULL,
      ends_at            TIMESTAMPTZ     NULL,
      instructions       TEXT,
      config             JSONB,
      created_at         TIMESTAMPTZ     DEFAULT NOW(),
      updated_at         TIMESTAMPTZ     DEFAULT NOW()
    );
    DROP TRIGGER IF EXISTS trg_assignments_upd ON assignments;
    CREATE TRIGGER trg_assignments_upd BEFORE UPDATE ON assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE IF NOT EXISTS assignment_questions (
      id              SERIAL PRIMARY KEY,
      assignment_id   INTEGER      NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      question_id     INTEGER      NOT NULL REFERENCES questions(id),
      order_index     INTEGER      DEFAULT 0,
      points_override NUMERIC(5,2) NULL
    );

    -- SUBMISSIONS
    CREATE TABLE IF NOT EXISTS submissions (
      id                 SERIAL PRIMARY KEY,
      assignment_id      INTEGER    NOT NULL REFERENCES assignments(id),
      student_id         INTEGER    NOT NULL REFERENCES users(id),
      status             sub_status DEFAULT 'in_progress',
      score              NUMERIC(5,2) NULL,
      xp_earned          INTEGER    DEFAULT 0,
      started_at         TIMESTAMPTZ DEFAULT NOW(),
      submitted_at       TIMESTAMPTZ NULL,
      graded_at          TIMESTAMPTZ NULL,
      graded_by          INTEGER    NULL REFERENCES users(id),
      feedback           TEXT,
      time_spent_seconds INTEGER    DEFAULT 0,
      minecraft_world    VARCHAR(100),
      UNIQUE (assignment_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS submission_answers (
      id              SERIAL PRIMARY KEY,
      submission_id   INTEGER      NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      question_id     INTEGER      NOT NULL REFERENCES questions(id),
      answer_text     TEXT,
      selected_option CHAR(1),
      is_correct      BOOLEAN      NULL,
      score_earned    NUMERIC(5,2) DEFAULT 0,
      answered_at     TIMESTAMPTZ  DEFAULT NOW(),
      UNIQUE (submission_id, question_id)
    );

    -- CODE SUBMISSIONS
    CREATE TABLE IF NOT EXISTS code_submissions (
      id                SERIAL PRIMARY KEY,
      submission_id     INTEGER        NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      language          code_lang      NOT NULL DEFAULT 'python',
      source_code       TEXT           NOT NULL,
      stdin             TEXT,
      expected_output   TEXT,
      actual_output     TEXT,
      execution_time_ms INTEGER,
      memory_used_kb    INTEGER,
      compile_status    compile_status DEFAULT 'pending',
      run_status        run_status     DEFAULT 'pending',
      error_message     TEXT,
      submitted_at      TIMESTAMPTZ    DEFAULT NOW()
    );

    -- DESIGN SUBMISSIONS
    CREATE TABLE IF NOT EXISTS design_submissions (
      id              SERIAL PRIMARY KEY,
      submission_id   INTEGER  NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      canvas_data     JSONB    NOT NULL,
      png_url         VARCHAR(500),
      teacher_rating  INTEGER  NULL CHECK (teacher_rating BETWEEN 0 AND 100),
      teacher_comment TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    -- XP & GAMIFICATION
    CREATE TABLE IF NOT EXISTS student_xp (
      id          SERIAL PRIMARY KEY,
      student_id  INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      total_xp    INTEGER DEFAULT 0,
      level       INTEGER DEFAULT 1,
      class_rank  INTEGER NULL,
      year_rank   INTEGER NULL,
      school_rank INTEGER NULL,
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );
    DROP TRIGGER IF EXISTS trg_xp_upd ON student_xp;
    CREATE TRIGGER trg_xp_upd BEFORE UPDATE ON student_xp FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE IF NOT EXISTS xp_transactions (
      id          SERIAL PRIMARY KEY,
      student_id  INTEGER   NOT NULL REFERENCES users(id),
      xp_amount   INTEGER   NOT NULL,
      source_type xp_source NOT NULL,
      source_id   INTEGER   NULL,
      description VARCHAR(255),
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id              SERIAL PRIMARY KEY,
      code            VARCHAR(50)  NOT NULL UNIQUE,
      name            VARCHAR(100) NOT NULL,
      description     TEXT,
      icon            VARCHAR(100),
      xp_reward       INTEGER DEFAULT 0,
      condition_type  VARCHAR(50),
      condition_value INTEGER,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    INSERT INTO achievements (code, name, description, icon, xp_reward, condition_type, condition_value) VALUES
      ('FIRST_SUBMISSION', 'Primeira Entrega',   'Completou sua primeira atividade',       'star',    50,  'submissions_count',  1),
      ('PERFECT_SCORE',    'Nota Perfeita',       'Tirou 100 em uma atividade',             'trophy',  200, 'perfect_score',      1),
      ('STREAK_7',         'Uma Semana Dedicado', 'Acessou o servidor 7 dias seguidos',     'fire',    150, 'login_streak',       7),
      ('CODE_MASTER',      'Mestre do Código',    'Completou 10 atividades de programação', 'code',    300, 'code_submissions',   10),
      ('PIXEL_ARTIST',     'Artista Pixel',       'Completou 5 atividades de design',       'palette', 200, 'design_submissions', 5),
      ('HONOR_ROLL',       'Honra ao Mérito',     'Média acima de 9.0 no bimestre',         'medal',   500, 'average_score',      90)
    ON CONFLICT (code) DO NOTHING;

    CREATE TABLE IF NOT EXISTS student_achievements (
      id             SERIAL PRIMARY KEY,
      student_id     INTEGER NOT NULL REFERENCES users(id),
      achievement_id INTEGER NOT NULL REFERENCES achievements(id),
      earned_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (student_id, achievement_id)
    );

    -- GRADES
    CREATE TABLE IF NOT EXISTS grades (
      id            SERIAL PRIMARY KEY,
      student_id    INTEGER     NOT NULL REFERENCES users(id),
      class_id      INTEGER     NOT NULL REFERENCES classes(id),
      subject_id    INTEGER     NOT NULL REFERENCES subjects(id),
      bimester      INTEGER     NOT NULL CHECK (bimester BETWEEN 1 AND 4),
      academic_year INTEGER     NOT NULL,
      grade         NUMERIC(5,2),
      absences      INTEGER     DEFAULT 0,
      observations  TEXT,
      updated_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (student_id, class_id, subject_id, bimester, academic_year)
    );

    -- MINECRAFT SYNC
    CREATE TABLE IF NOT EXISTS minecraft_sessions (
      id             SERIAL PRIMARY KEY,
      user_id        INTEGER     NOT NULL REFERENCES users(id),
      minecraft_uuid VARCHAR(36) NOT NULL,
      server_name    VARCHAR(100),
      joined_at      TIMESTAMPTZ DEFAULT NOW(),
      left_at        TIMESTAMPTZ NULL,
      is_active      BOOLEAN     DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS minecraft_activity (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER     NOT NULL REFERENCES users(id),
      activity_type mc_act_type NOT NULL,
      assignment_id INTEGER     NULL,
      data          JSONB,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    -- AUDIT & NOTIFICATIONS
    CREATE TABLE IF NOT EXISTS activity_logs (
      id          BIGSERIAL PRIMARY KEY,
      user_id     INTEGER NULL,
      action      VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50),
      entity_id   INTEGER,
      details     JSONB,
      ip_address  VARCHAR(45),
      user_agent  TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      VARCHAR(255) NOT NULL,
      message    TEXT         NOT NULL,
      type       notif_type   DEFAULT 'info',
      is_read    BOOLEAN      DEFAULT FALSE,
      action_url VARCHAR(500),
      created_at TIMESTAMPTZ  DEFAULT NOW()
    );

    -- QUESTION TEMPLATES
    CREATE TABLE IF NOT EXISTS question_templates (
      id             SERIAL PRIMARY KEY,
      subject_id     INTEGER         NOT NULL REFERENCES subjects(id),
      school_year_id INTEGER         NOT NULL REFERENCES school_years(id),
      topic          VARCHAR(255)    NOT NULL,
      content        TEXT            NOT NULL,
      type           question_type   NOT NULL,
      difficulty     difficulty_type NOT NULL,
      correct_option CHAR(1),
      option_a       TEXT,
      option_b       TEXT,
      option_c       TEXT,
      option_d       TEXT,
      option_e       TEXT,
      explanation    TEXT
    );

    -- INDEXES
    CREATE INDEX IF NOT EXISTS idx_users_mc_uuid      ON users(minecraft_uuid);
    CREATE INDEX IF NOT EXISTS idx_users_role         ON users(role_id);
    CREATE INDEX IF NOT EXISTS idx_subs_student       ON submissions(student_id);
    CREATE INDEX IF NOT EXISTS idx_subs_assignment    ON submissions(assignment_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_class  ON assignments(class_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status);
    CREATE INDEX IF NOT EXISTS idx_xp_transactions    ON xp_transactions(student_id);
    CREATE INDEX IF NOT EXISTS idx_grades_student     ON grades(student_id, academic_year);
    CREATE INDEX IF NOT EXISTS idx_notif_user         ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_logs_user          ON activity_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_logs_created       ON activity_logs(created_at);
  `);

  console.log('✔ Schema embutido aplicado com sucesso');
}

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('📦 Verificando banco de dados...');

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
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = migrate;

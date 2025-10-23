// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// Gzip compression for all responses (reduces bandwidth by 70-90%)
app.use(compression());

app.use(cors());
app.use(express.json());

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads', 'quiz-images');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'question-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'));
  }
};


const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Database connection with pooling limits (optimized for 1GB server)
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  max: 10, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection cannot be established
});

// Track which quiz is currently active (DEPRECATED - will be replaced with session-based system)
let currentQuizId = null;

// ============= SESSION UTILITIES =============

// Generate a unique 3-character session code
async function generateSessionCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  let attempts = 0;
  const maxAttempts = 20;

  do {
    code = Array.from({length: 3}, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');

    const existing = await pool.query(
      'SELECT id FROM game_sessions WHERE session_code = $1',
      [code]
    );

    if (existing.rows.length === 0) {
      return code;
    }

    attempts++;
  } while (attempts < maxAttempts);

  throw new Error('Failed to generate unique session code');
}

// Validate session and check expiry (1 hour timeout)
async function validateSession(sessionCode) {
  if (!sessionCode) return null;

  const result = await pool.query(
    'SELECT * FROM game_sessions WHERE session_code = $1',
    [sessionCode]
  );

  if (result.rows.length === 0) return null;

  const session = result.rows[0];
  const oneHourAgo = new Date(Date.now() - 3600000); // 1 hour in milliseconds

  // Check if session has expired
  if (new Date(session.last_activity) < oneHourAgo) {
    // Delete expired session
    await pool.query('DELETE FROM game_sessions WHERE id = $1', [session.id]);
    return null;
  }

  // Update last activity timestamp
  await pool.query(
    'UPDATE game_sessions SET last_activity = CURRENT_TIMESTAMP WHERE id = $1',
    [session.id]
  );

  return session;
}

// MIGRATION: Rename game_session to quizzes
(async () => {
  try {
    console.log('Starting database migration...');

    // Step 1: Rename game_session table to quizzes
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='game_session') THEN
          -- Check if quizzes table doesn't already exist
          IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='quizzes') THEN
            ALTER TABLE game_session RENAME TO quizzes;
            RAISE NOTICE 'Renamed game_session to quizzes';
          ELSE
            RAISE NOTICE 'Quizzes table already exists, skipping rename';
          END IF;
        END IF;
      END
      $$;
    `);

    // Step 2: Create clean quizzes table (if starting fresh)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quizzes (
        id SERIAL PRIMARY KEY,
        quiz_name VARCHAR(200) NOT NULL,
        quiz_date DATE NOT NULL,
        archived BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Step 2b: Add archived column to existing quizzes table
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quizzes' AND column_name='archived') THEN
          ALTER TABLE quizzes ADD COLUMN archived BOOLEAN DEFAULT FALSE;
          RAISE NOTICE 'Added archived column to quizzes';
        END IF;
      END
      $$;
    `);

    // Step 3: Remove old fields from quizzes table if they exist
    await pool.query(`
      DO $$
      BEGIN
        -- Remove status column (belongs to sessions, not quiz templates)
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quizzes' AND column_name='status') THEN
          ALTER TABLE quizzes DROP COLUMN status;
          RAISE NOTICE 'Removed status from quizzes';
        END IF;

        -- Remove current_round_id (belongs to sessions, not quiz templates)
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quizzes' AND column_name='current_round_id') THEN
          ALTER TABLE quizzes DROP COLUMN current_round_id;
          RAISE NOTICE 'Removed current_round_id from quizzes';
        END IF;

        -- Remove marking_mode (belongs to sessions, not quiz templates)
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quizzes' AND column_name='marking_mode') THEN
          ALTER TABLE quizzes DROP COLUMN marking_mode;
          RAISE NOTICE 'Removed marking_mode from quizzes';
        END IF;
      END
      $$;
    `);

    // Step 4: Create rounds table (must come before game_sessions due to FK)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rounds (
        id SERIAL PRIMARY KEY,
        quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE,
        name VARCHAR(200) NOT NULL,
        round_type VARCHAR(50) NOT NULL,
        round_order INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Step 5: Rename game_session_id to quiz_id in rounds table
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rounds' AND column_name='game_session_id') THEN
          ALTER TABLE rounds RENAME COLUMN game_session_id TO quiz_id;
          RAISE NOTICE 'Renamed rounds.game_session_id to quiz_id';
        END IF;
      END
      $$;
    `);

    // Step 6: Create game_sessions table (active session instances)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_sessions (
        id SERIAL PRIMARY KEY,
        session_code VARCHAR(3) UNIQUE NOT NULL,
        quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE,
        owner_id VARCHAR(36),
        status VARCHAR(20) DEFAULT 'active',
        current_round_id INTEGER REFERENCES rounds(id) ON DELETE SET NULL,
        marking_mode BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Step 6b: Truncate existing session codes and update column to VARCHAR(3)
    await pool.query(`
      DO $$
      BEGIN
        -- Check current column type
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='game_sessions'
          AND column_name='session_code'
          AND character_maximum_length != 3
        ) THEN
          -- First, truncate any existing codes to 3 characters
          UPDATE game_sessions SET session_code = LEFT(session_code, 3);
          -- Then alter the column type
          ALTER TABLE game_sessions ALTER COLUMN session_code TYPE VARCHAR(3);
          RAISE NOTICE 'Updated session_code to VARCHAR(3) and truncated existing codes';
        END IF;
      END
      $$;
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_session_code ON game_sessions(session_code)
    `);

    // Step 7: Create players table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        session_id INTEGER REFERENCES game_sessions(id) ON DELETE CASCADE,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT players_session_name_unique UNIQUE(session_id, name)
      )
    `);

    // Step 8: Create questions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS questions (
        id SERIAL PRIMARY KEY,
        round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
        question_text TEXT NOT NULL,
        answer TEXT,
        image_url TEXT,
        question_order INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Step 9: Create player_answers table with session support
    await pool.query(`
      CREATE TABLE IF NOT EXISTS player_answers (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES game_sessions(id) ON DELETE CASCADE,
        player_name VARCHAR(100) NOT NULL,
        question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
        round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
        answer_text TEXT NOT NULL,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Step 10: Add session_id to player_answers if it doesn't exist
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='player_answers' AND column_name='session_id') THEN
          ALTER TABLE player_answers ADD COLUMN session_id INTEGER REFERENCES game_sessions(id) ON DELETE CASCADE;
          RAISE NOTICE 'Added session_id to player_answers';
        END IF;
      END
      $$;
    `);

    // Step 11: Update player_answers UNIQUE constraint
    await pool.query(`
      DO $$
      BEGIN
        -- Drop old constraint if exists
        IF EXISTS (SELECT 1 FROM information_schema.table_constraints
                   WHERE constraint_name='player_answers_player_name_question_id_key' AND table_name='player_answers') THEN
          ALTER TABLE player_answers DROP CONSTRAINT player_answers_player_name_question_id_key;
          RAISE NOTICE 'Dropped old player_answers constraint';
        END IF;

        -- Add new constraint
        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                       WHERE constraint_name='player_answers_session_player_question_unique' AND table_name='player_answers') THEN
          ALTER TABLE player_answers ADD CONSTRAINT player_answers_session_player_question_unique
            UNIQUE(session_id, player_name, question_id);
          RAISE NOTICE 'Added new player_answers constraint';
        END IF;
      END
      $$;
    `);

    // Step 12: Create marking_assignments table (session-only)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marking_assignments (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES game_sessions(id) ON DELETE CASCADE,
        marker_name VARCHAR(100) NOT NULL,
        markee_name VARCHAR(100) NOT NULL,
        round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, marker_name, round_id)
      )
    `);

    // Step 13: Remove quiz_id from marking_assignments if exists
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='marking_assignments' AND column_name='quiz_id') THEN
          ALTER TABLE marking_assignments DROP COLUMN quiz_id;
          RAISE NOTICE 'Removed quiz_id from marking_assignments';
        END IF;
      END
      $$;
    `);

    // Step 14: Add session_id to marking_assignments if it doesn't exist
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='marking_assignments' AND column_name='session_id') THEN
          ALTER TABLE marking_assignments ADD COLUMN session_id INTEGER REFERENCES game_sessions(id) ON DELETE CASCADE;
          RAISE NOTICE 'Added session_id to marking_assignments';
        END IF;
      END
      $$;
    `);

    // Step 14b: Update UNIQUE constraint for marking_assignments
    await pool.query(`
      DO $$
      BEGIN
        -- Drop old constraints if they exist
        IF EXISTS (SELECT 1 FROM information_schema.table_constraints
                   WHERE constraint_name='marking_assignments_marker_name_round_id_key' AND table_name='marking_assignments') THEN
          ALTER TABLE marking_assignments DROP CONSTRAINT marking_assignments_marker_name_round_id_key;
          RAISE NOTICE 'Dropped old marking_assignments constraint';
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.table_constraints
                   WHERE constraint_name='marking_assignments_quiz_id_marker_name_round_id_key' AND table_name='marking_assignments') THEN
          ALTER TABLE marking_assignments DROP CONSTRAINT marking_assignments_quiz_id_marker_name_round_id_key;
          RAISE NOTICE 'Dropped old quiz_id-based constraint';
        END IF;

        -- Add new session-based constraint
        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                       WHERE constraint_name='marking_assignments_session_id_marker_name_round_id_key' AND table_name='marking_assignments') THEN
          ALTER TABLE marking_assignments ADD CONSTRAINT marking_assignments_session_id_marker_name_round_id_key
            UNIQUE(session_id, marker_name, round_id);
          RAISE NOTICE 'Added new session-based constraint to marking_assignments';
        END IF;
      END
      $$;
    `);

    // Step 15: Create peer_marks table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS peer_marks (
        id SERIAL PRIMARY KEY,
        assignment_id INTEGER REFERENCES marking_assignments(id) ON DELETE CASCADE,
        question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
        score DECIMAL(3,1) NOT NULL CHECK (score IN (0, 0.5, 1)),
        marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(assignment_id, question_id)
      )
    `);

    // Step 16: Create triggered_rounds table (session-only)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS triggered_rounds (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES game_sessions(id) ON DELETE CASCADE,
        round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
        triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, round_id)
      )
    `);

    // Step 17: Remove quiz_id from triggered_rounds if exists
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='triggered_rounds' AND column_name='quiz_id') THEN
          ALTER TABLE triggered_rounds DROP COLUMN quiz_id;
          RAISE NOTICE 'Removed quiz_id from triggered_rounds';
        END IF;
      END
      $$;
    `);

    // Step 18: Add session_id to triggered_rounds if it doesn't exist
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='triggered_rounds' AND column_name='session_id') THEN
          ALTER TABLE triggered_rounds ADD COLUMN session_id INTEGER REFERENCES game_sessions(id) ON DELETE CASCADE;
          RAISE NOTICE 'Added session_id to triggered_rounds';
        END IF;
      END
      $$;
    `);

    console.log('✅ Database migration completed successfully!');

    // DISABLED: Don't reset game state on server restart - this deletes user data!
    // await pool.query('UPDATE quizzes SET current_round_id = NULL');
    // await pool.query('DELETE FROM players');
    // await pool.query("UPDATE quizzes SET status = 'waiting'");

    // console.log('Game state reset: cleared players, active rounds, and reset all games to waiting');
    
  } catch (err) {
    console.error('Table creation error:', err);
  }
})();


// ============= QUIZ ENDPOINTS =============

// Create a new quiz
app.post('/api/quiz/create', async (req, res) => {
  const { quiz_name, quiz_date } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO quizzes (quiz_name, quiz_date) VALUES ($1, $2) RETURNING *",
      [quiz_name, quiz_date]
    );
    currentQuizId = result.rows[0].id;
    res.json({ quiz: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all active (non-archived) quizzes
app.get('/api/quizzes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM quizzes WHERE archived = FALSE ORDER BY quiz_date DESC, created_at DESC');
    res.json({ quizzes: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Select a quiz to work on (OLD SYSTEM - deprecated, kept for compatibility)
app.post('/api/quiz/select/:id', async (req, res) => {
  try {
    const quizId = parseInt(req.params.id);
    const result = await pool.query('SELECT * FROM quizzes WHERE id = $1', [quizId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    currentQuizId = quizId;

    // Clear players when switching quizzes (old system only)
    await pool.query('DELETE FROM players WHERE session_id IS NULL');

    res.json({ quiz: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get current active quiz (OLD SYSTEM - deprecated)
app.get('/api/quiz/current', async (req, res) => {
  try {
    if (!currentQuizId) {
      return res.json({ quiz: null });
    }
    const result = await pool.query('SELECT * FROM quizzes WHERE id = $1', [currentQuizId]);
    if (result.rows.length === 0) {
      currentQuizId = null;
      return res.json({ quiz: null });
    }
    res.json({ quiz: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get quiz by ID (for session management)
app.get('/api/quiz/:id', async (req, res) => {
  try {
    const quizId = parseInt(req.params.id);
    const result = await pool.query('SELECT * FROM quizzes WHERE id = $1', [quizId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quiz not found' });
    }
    res.json({ quiz: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check if game is active (lobby is active only when status is 'active')
app.get('/api/game/status', async (req, res) => {
  const sessionCode = req.query.session;

  try {
    let quizId = currentQuizId;

    // NEW SYSTEM: If session code provided, validate and get session's quiz_id
    if (sessionCode) {
      const session = await validateSession(sessionCode);
      if (!session) {
        return res.status(404).json({ error: 'Session not found or expired' });
      }

      // Query game_sessions table for session status
      const sessionResult = await pool.query(
        `SELECT s.status, s.current_round_id, s.marking_mode, r.round_type, r.name as round_name
         FROM game_sessions s
         LEFT JOIN rounds r ON s.current_round_id = r.id
         WHERE s.id = $1`,
        [session.id]
      );

      if (sessionResult.rows.length === 0) {
        return res.json({
          active: false,
          status: 'waiting',
          current_round_id: null,
          current_round_type: null,
          current_round_name: null,
          marking_mode: false
        });
      }

      const row = sessionResult.rows[0];
      const isActive = row.status === 'active' || row.status === 'closed';

      return res.json({
        active: isActive,
        status: row.status,
        current_round_id: row.current_round_id,
        current_round_type: row.round_type,
        current_round_name: row.round_name,
        marking_mode: row.marking_mode || false
      });
    }

    // OLD SYSTEM: No session, use currentQuizId
    if (!quizId) {
      return res.json({
        active: false,
        status: 'waiting',
        current_round_id: null,
        current_round_type: null,
        current_round_name: null
      });
    }

    // OLD SYSTEM: This path is deprecated, quizzes don't have status/current_round
    // Return empty response for old system
    return res.json({
      active: false,
      status: 'waiting',
      current_round_id: null,
      current_round_type: null,
      current_round_name: null,
      marking_mode: false
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle game status (UPDATED FOR 3 STATES)
app.post('/api/game/toggle-status', async (req, res) => {
  const sessionCode = req.query.session;

  try {
    let quizId = currentQuizId;
    let tableName = 'game_session';
    let sessionId = null;

    // NEW SYSTEM: If session code provided, use game_sessions table
    if (sessionCode) {
      const session = await validateSession(sessionCode);
      if (!session) {
        return res.status(404).json({ error: 'Session not found or expired' });
      }
      tableName = 'game_sessions';
      sessionId = session.id;
      quizId = session.id; // Use session id for updates
    } else {
      // OLD SYSTEM: Use currentQuizId
      if (!quizId) {
        return res.status(400).json({ error: 'No active quiz selected' });
      }
    }

    const currentStatusResult = await pool.query(
      `SELECT status FROM ${tableName} WHERE id = $1`,
      [quizId]
    );

    if (currentStatusResult.rows.length === 0) {
        return res.status(404).json({ error: 'Quiz/session not found' });
    }

    const currentStatus = currentStatusResult.rows[0].status;
    let newStatus = '';
    let updateQuery = '';

    if (currentStatus === 'waiting') {
        newStatus = 'active';
        // When starting the game, ensure round is clear just in case
        updateQuery = `UPDATE ${tableName} SET status = $1, current_round_id = NULL WHERE id = $2 RETURNING *`;
    } else if (currentStatus === 'active') {
        // Game is running, close the lobby
        newStatus = 'closed';
        updateQuery = `UPDATE ${tableName} SET status = $1 WHERE id = $2 RETURNING *`;
    } else if (currentStatus === 'closed') {
        // Game is running, re-open the lobby
        newStatus = 'active';
        updateQuery = `UPDATE ${tableName} SET status = $1 WHERE id = $2 RETURNING *`;
    } else {
        // Fallback to waiting and ensure active round is cleared
        newStatus = 'waiting';
        updateQuery = `UPDATE ${tableName} SET status = $1, current_round_id = NULL WHERE id = $2 RETURNING *`;
    }

    // If we transition to 'waiting' (e.g. game over), clear active round AND flush players
    if (newStatus === 'waiting') {
        updateQuery = `UPDATE ${tableName} SET status = $1, current_round_id = NULL WHERE id = $2 RETURNING *`;

        // Flush players based on session or old system
        if (sessionId) {
          await pool.query('DELETE FROM players WHERE session_id = $1', [sessionId]);
        } else {
          await pool.query('DELETE FROM players WHERE session_id IS NULL');
        }
    }

    // Update the status in the database
    const updateResult = await pool.query(
      updateQuery,
      [newStatus, quizId]
    );

    res.json({ quiz: updateResult.rows[0], message: `Game status set to ${newStatus}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Archive a quiz (soft delete)
app.delete('/api/quiz/:id', async (req, res) => {
  try {
    await pool.query('UPDATE quizzes SET archived = TRUE WHERE id = $1', [req.params.id]);
    if (currentQuizId === parseInt(req.params.id)) {
      currentQuizId = null;
    }
    res.json({ success: true, message: 'Quiz archived successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restore an archived quiz
app.post('/api/quiz/:id/restore', async (req, res) => {
  try {
    await pool.query('UPDATE quizzes SET archived = FALSE WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Quiz restored successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get archived quizzes
app.get('/api/quizzes/archived', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM quizzes WHERE archived = TRUE ORDER BY quiz_date DESC, created_at DESC');
    res.json({ quizzes: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============= PLAYER ENDPOINTS =============

// Join game - add player
app.post('/api/join', async (req, res) => {
  const { name } = req.body;
  const sessionCode = req.query.session;

  try {
    let sessionId = null;

    // NEW SYSTEM: If session code provided, validate and get session_id
    if (sessionCode) {
      const session = await validateSession(sessionCode);
      if (!session) {
        return res.status(404).json({ error: 'Session not found or expired' });
      }
      sessionId = session.id;
    }

    // Check if player already exists in this session (or in old system with NULL)
    const existing = await pool.query(
      'SELECT * FROM players WHERE name = $1 AND session_id IS NOT DISTINCT FROM $2',
      [name, sessionId]
    );

    if (existing.rows.length === 0) {
      await pool.query(
        'INSERT INTO players (name, session_id) VALUES ($1, $2)',
        [name, sessionId]
      );
    }

    // Return all players for this session (or NULL for old system)
    const result = await pool.query(
      'SELECT name FROM players WHERE session_id IS NOT DISTINCT FROM $1 ORDER BY joined_at',
      [sessionId]
    );
    res.json({ players: result.rows.map(r => r.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all players
app.get('/api/players', async (req, res) => {
  const sessionCode = req.query.session;

  try {
    let sessionId = null;

    // NEW SYSTEM: If session code provided, validate and get session_id
    if (sessionCode) {
      const session = await validateSession(sessionCode);
      if (!session) {
        return res.status(404).json({ error: 'Session not found or expired' });
      }
      sessionId = session.id;
    }

    // Get players for this session (or NULL for old system)
    const result = await pool.query(
      'SELECT name FROM players WHERE session_id IS NOT DISTINCT FROM $1 ORDER BY joined_at',
      [sessionId]
    );
    res.json({ players: result.rows.map(r => r.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset game - clear all players
app.post('/api/reset', async (req, res) => {
  try {
    await pool.query('DELETE FROM players');
    res.json({ players: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a specific player
app.delete('/api/player/remove/:name', async (req, res) => {
  const { name } = req.params;
  const sessionCode = req.query.session;

  try {
    let sessionId = null;

    // NEW SYSTEM: If session code provided, get session_id
    if (sessionCode) {
      const session = await validateSession(sessionCode);
      if (!session) {
        return res.status(404).json({ error: 'Session not found or expired' });
      }
      sessionId = session.id;
    }

    // Delete player with session filter
    const result = await pool.query(
      'DELETE FROM players WHERE name = $1 AND session_id IS NOT DISTINCT FROM $2 RETURNING *',
      [name, sessionId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // Return updated list of players for this session
    const playersResult = await pool.query(
      'SELECT name FROM players WHERE session_id IS NOT DISTINCT FROM $1 ORDER BY joined_at',
      [sessionId]
    );

    res.json({
      players: playersResult.rows.map(r => r.name),
      message: `${name} removed.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============= MC QUESTION DISPLAY ENDPOINTS =============

// NEW ENDPOINT: MC sets the round to be displayed
app.post('/api/game/set-round/:roundId', async (req, res) => {
  const roundId = parseInt(req.params.roundId);
  const sessionCode = req.query.session;

  try {
    let quizId = currentQuizId;
    let tableName = 'game_session';

    // NEW SYSTEM: If session code provided, use game_sessions table
    if (sessionCode) {
      const session = await validateSession(sessionCode);
      if (!session) {
        return res.status(404).json({ error: 'Session not found or expired' });
      }
      tableName = 'game_sessions';
      quizId = session.quiz_id; // Use session's quiz_id for validation
    } else {
      // OLD SYSTEM: Use currentQuizId
      if (!quizId) {
        return res.status(400).json({ error: 'No active quiz selected' });
      }
    }

    // Check for "clear display" signal (roundId === 0)
    if (roundId === 0) {
      await pool.query(`UPDATE ${tableName} SET current_round_id = NULL WHERE ${sessionCode ? 'session_code' : 'id'} = $1`, [sessionCode || quizId]);
      return res.json({ success: true, message: 'Display cleared (current_round_id set to NULL)' });
    }

    // Validate that the round belongs to the current quiz
    const roundResult = await pool.query(
      'SELECT id FROM rounds WHERE id = $1 AND quiz_id = $2',
      [roundId, quizId]
    );

    if (roundResult.rows.length === 0) {
      return res.status(404).json({ error: 'Round not found for current quiz.' });
    }

    // Set the current_round_id in the game session
    await pool.query(
      `UPDATE ${tableName} SET current_round_id = $1 WHERE ${sessionCode ? 'session_code' : 'id'} = $2`,
      [roundId, sessionCode || quizId]
    );

    res.json({ success: true, roundId: roundId, message: `Round ${roundId} set for display.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NEW ENDPOINT: Players poll this to get the current round and questions
app.get('/api/game/display-data', async (req, res) => {
  const sessionCode = req.query.session;

  try {
    let currentRoundId = null;

    // NEW SYSTEM: If session code provided, get from game_sessions
    if (sessionCode) {
      const session = await validateSession(sessionCode);
      if (!session) {
        return res.json({ round: null, questions: [] });
      }

      currentRoundId = session.current_round_id;
    } else {
      // OLD SYSTEM: Use currentQuizId (deprecated)
      if (!currentQuizId) {
        return res.json({ round: null, questions: [] });
      }

      // OLD: This path won't work anymore since quizzes don't have current_round_id
      // Return empty for old system
      return res.json({ round: null, questions: [] });
    }

    if (!currentRoundId) {
      return res.json({ round: null, questions: [] });
    }

    // 2. Get the round details
    const roundResult = await pool.query(
      'SELECT id, name, round_type FROM rounds WHERE id = $1',
      [currentRoundId]
    );
    const round = roundResult.rows[0];

    // 3. Get all questions (and non-sensitive data: NO ANSWER) for that round
    const questionsResult = await pool.query(
      'SELECT id, question_text, image_url, question_order FROM questions WHERE round_id = $1 ORDER BY question_order',
      [currentRoundId]
    );
    const questions = questionsResult.rows;

    res.json({ round: round, questions: questions });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============= ROUND ENDPOINTS =============

// Create a new round
app.post('/api/rounds', async (req, res) => {
  const { name, round_type, quiz_id } = req.body;
  try {
    // Use quiz_id from request body (for sessions) or fall back to currentQuizId (old system)
    const quizId = quiz_id || currentQuizId;

    if (!quizId) {
      return res.status(400).json({ error: 'No active quiz selected' });
    }

    // Get next order number
    const orderResult = await pool.query(
      'SELECT COALESCE(MAX(round_order), 0) + 1 as next_order FROM rounds WHERE quiz_id = $1',
      [quizId]
    );
    const nextOrder = orderResult.rows[0].next_order;

    const result = await pool.query(
      'INSERT INTO rounds (quiz_id, name, round_type, round_order) VALUES ($1, $2, $3, $4) RETURNING *',
      [quizId, name, round_type, nextOrder]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all rounds for current game
app.get('/api/rounds', async (req, res) => {
  try {
    // Use quiz_id from query parameter (for sessions) or fall back to currentQuizId (old system)
    const quizId = req.query.quiz_id ? parseInt(req.query.quiz_id) : currentQuizId;

    if (!quizId) {
      return res.json({ rounds: [] });
    }

    const result = await pool.query(
      'SELECT * FROM rounds WHERE quiz_id = $1 ORDER BY round_order',
      [quizId]
    );
    res.json({ rounds: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a round
app.put('/api/rounds/:id', async (req, res) => {
  const { name, round_type } = req.body;
  try {
    const result = await pool.query(
      'UPDATE rounds SET name = $1, round_type = $2 WHERE id = $3 RETURNING *',
      [name, round_type, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a round (UPDATED to clear current_round_id if necessary)
app.delete('/api/rounds/:id', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    // Clear display if this round was active
    await pool.query('UPDATE quizzes SET current_round_id = NULL WHERE current_round_id = $1', [roundId]);
    await pool.query('DELETE FROM rounds WHERE id = $1', [roundId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============= QUESTION ENDPOINTS =============

// Upload image for question
app.post('/api/questions/upload-image', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Return the URL path to access this image
    const imageUrl = `/uploads/quiz-images/${req.file.filename}`;
    res.json({ 
      imageUrl: imageUrl,
      filename: req.file.filename 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a question to a round
app.post('/api/questions', async (req, res) => {
  const { round_id, question_text, answer, image_url } = req.body;
  try {
    // Get next order number
    const orderResult = await pool.query(
      'SELECT COALESCE(MAX(question_order), 0) + 1 as next_order FROM questions WHERE round_id = $1',
      [round_id]
    );
    const nextOrder = orderResult.rows[0].next_order;
    
    const result = await pool.query(
      'INSERT INTO questions (round_id, question_text, answer, image_url, question_order) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [round_id, question_text, answer, image_url, nextOrder]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a question
app.delete('/api/questions/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM questions WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============= PLAYER ANSWER ENDPOINTS =============

// Submit an answer for a specific question
app.post('/api/answers/submit', async (req, res) => {
  const { player_name, question_id, round_id, answer_text } = req.body;
  const sessionCode = req.query.session;

  try {
    if (!player_name || !question_id || !round_id || !answer_text) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    let sessionId = null;

    // NEW SYSTEM: If session code provided, validate and get session_id
    if (sessionCode) {
      const session = await validateSession(sessionCode);
      if (!session) {
        return res.status(404).json({ error: 'Session not found or expired' });
      }
      sessionId = session.id;
    }

    // Use UPSERT to allow players to update their answers
    // The constraint is now (session_id, player_name, question_id)
    await pool.query(
      `INSERT INTO player_answers (session_id, player_name, question_id, round_id, answer_text)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id, player_name, question_id)
       DO UPDATE SET answer_text = $5, submitted_at = CURRENT_TIMESTAMP`,
      [sessionId, player_name, question_id, round_id, answer_text]
    );

    res.json({ success: true, message: 'Answer submitted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get player's answers for a specific round
app.get('/api/answers/:playerName/:roundId', async (req, res) => {
  const { playerName, roundId } = req.params;
  const sessionCode = req.query.session;

  try {
    let sessionId = null;

    // NEW SYSTEM: If session code provided, validate and get session_id
    if (sessionCode) {
      const session = await validateSession(sessionCode);
      if (!session) {
        return res.json({ answers: {} }); // Return empty if session invalid
      }
      sessionId = session.id;
    }

    const result = await pool.query(
      `SELECT question_id, answer_text FROM player_answers
       WHERE player_name = $1 AND round_id = $2 AND session_id IS NOT DISTINCT FROM $3`,
      [playerName, roundId, sessionId]
    );

    // Return as a map of question_id -> answer_text
    const answers = {};
    result.rows.forEach(row => {
      answers[row.question_id] = row.answer_text;
    });

    res.json({ answers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get questions for a round
app.get('/api/rounds/:roundId/questions', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM questions WHERE round_id = $1 ORDER BY question_order',
      [req.params.roundId]
    );
    res.json({ questions: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============= MARKING ENDPOINTS =============

// MC triggers marking for ALL rounds in the current quiz
app.post('/api/marking/trigger-all-rounds', async (req, res) => {
  const sessionCode = req.query.session;

  try {
    let quizId = currentQuizId;
    let sessionId = null;

    // NEW SYSTEM: If session code provided, get session and quiz_id
    if (sessionCode) {
      const session = await validateSession(sessionCode);
      if (!session) {
        return res.status(404).json({ error: 'Session not found or expired' });
      }
      quizId = session.quiz_id;
      sessionId = session.id;
    } else {
      // OLD SYSTEM: Use currentQuizId
      if (!quizId) {
        return res.status(400).json({ error: 'No active quiz selected' });
      }
    }

    // Get all rounds for this quiz
    const roundsResult = await pool.query(
      'SELECT id FROM rounds WHERE quiz_id = $1 ORDER BY round_order',
      [quizId]
    );

    if (roundsResult.rows.length === 0) {
      return res.status(400).json({ error: 'No rounds found for this quiz' });
    }

    // Get all players who have joined (not necessarily answered)
    let playersResult;
    if (sessionId) {
      // NEW: Get players for this specific session
      playersResult = await pool.query(
        `SELECT name FROM players
         WHERE session_id = $1
         ORDER BY name`,
        [sessionId]
      );
    } else {
      // OLD: Get players for old system (session_id IS NULL)
      playersResult = await pool.query(
        `SELECT name FROM players
         WHERE session_id IS NULL
         ORDER BY name`,
        []
      );
    }

    const allPlayers = playersResult.rows.map(row => row.name);

    if (allPlayers.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 players to create marking assignments' });
    }

    // Shuffle players randomly ONCE for the entire quiz
    const shuffled = [...allPlayers].sort(() => Math.random() - 0.5);

    // Create anonymous labels for each player (Player A, Player B, etc.)
    const anonymousLabels = {};
    shuffled.forEach((playerName, index) => {
      anonymousLabels[playerName] = `Player ${String.fromCharCode(65 + index)}`; // A, B, C, etc.
    });

    let totalAssignments = 0;

    // Create the same circular assignments for each round
    for (const roundRow of roundsResult.rows) {
      const roundId = roundRow.id;

      // Check if already triggered
      const existingTrigger = await pool.query(
        'SELECT id FROM triggered_rounds WHERE session_id IS NOT DISTINCT FROM $1 AND round_id = $2',
        [sessionId, roundId]
      );

      if (existingTrigger.rows.length > 0) {
        continue; // Skip already triggered rounds
      }

      // Create assignments for all players (even if they haven't answered yet)
      for (let i = 0; i < shuffled.length; i++) {
        const marker = shuffled[i];
        const markee = shuffled[(i + 1) % shuffled.length];

        const result = await pool.query(
          `INSERT INTO marking_assignments (session_id, marker_name, markee_name, round_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (session_id, marker_name, round_id) DO NOTHING
           RETURNING *`,
          [sessionId, marker, markee, roundId]
        );

        if (result.rows.length > 0) {
          totalAssignments++;
        }
      }

      // Mark this round as triggered
      await pool.query(
        'INSERT INTO triggered_rounds (session_id, round_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [sessionId, roundId]
      );
    }

    res.json({
      success: true,
      message: `Marking assignments created for all rounds (${totalAssignments} total assignments)`,
      assignments: totalAssignments,
      rounds: roundsResult.rows.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// MC enables/disables marking mode
app.post('/api/marking/toggle-mode', async (req, res) => {
  const sessionCode = req.query.session;

  try {
    // NEW SYSTEM: Session-based marking only
    if (sessionCode) {
      const session = await validateSession(sessionCode);
      if (!session) {
        return res.status(404).json({ error: 'Session not found or expired' });
      }

      const currentResult = await pool.query(
        'SELECT marking_mode FROM game_sessions WHERE id = $1',
        [session.id]
      );

      const currentMode = currentResult.rows[0]?.marking_mode || false;
      const newMode = !currentMode;

      await pool.query(
        'UPDATE game_sessions SET marking_mode = $1 WHERE id = $2',
        [newMode, session.id]
      );

      // AUTO-TRIGGER: If enabling marking mode, automatically create assignments
      let assignmentsCreated = 0;
      if (newMode) {
        // Get all rounds for this quiz
        const roundsResult = await pool.query(
          'SELECT id FROM rounds WHERE quiz_id = $1 ORDER BY round_order',
          [session.quiz_id]
        );

        // Get all players for this session
        const playersResult = await pool.query(
          'SELECT name FROM players WHERE session_id = $1 ORDER BY name',
          [session.id]
        );

        const allPlayers = playersResult.rows.map(row => row.name);

        if (allPlayers.length >= 2 && roundsResult.rows.length > 0) {
          // Shuffle players randomly ONCE for the entire quiz
          const shuffled = [...allPlayers].sort(() => Math.random() - 0.5);

          // Create the same circular assignments for each round
          for (const roundRow of roundsResult.rows) {
            const roundId = roundRow.id;

            // Check if already triggered
            const existingTrigger = await pool.query(
              'SELECT id FROM triggered_rounds WHERE session_id = $1 AND round_id = $2',
              [session.id, roundId]
            );

            if (existingTrigger.rows.length === 0) {
              // Create assignments for all players
              for (let i = 0; i < shuffled.length; i++) {
                const marker = shuffled[i];
                const markee = shuffled[(i + 1) % shuffled.length];

                const result = await pool.query(
                  `INSERT INTO marking_assignments (session_id, marker_name, markee_name, round_id)
                   VALUES ($1, $2, $3, $4)
                   ON CONFLICT (session_id, marker_name, round_id) DO NOTHING
                   RETURNING *`,
                  [session.id, marker, markee, roundId]
                );

                if (result.rows.length > 0) {
                  assignmentsCreated++;
                }
              }

              // Mark this round as triggered
              await pool.query(
                'INSERT INTO triggered_rounds (session_id, round_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [session.id, roundId]
              );
            }
          }
        }
      }

      res.json({
        marking_mode: newMode,
        message: newMode
          ? `Marking mode enabled. ${assignmentsCreated} assignments created.`
          : 'Marking mode disabled',
        assignments_created: assignmentsCreated
      });
    } else {
      // OLD SYSTEM: Marking mode not supported without sessions
      return res.status(400).json({ error: 'Marking mode requires a session. Please create a session first.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get marking assignments for a player (all triggered rounds)
app.get('/api/marking/assignments/:playerName', async (req, res) => {
  const { playerName } = req.params;
  const sessionCode = req.query.session;

  try {
    let sessionId = null;

    // NEW SYSTEM: If session code provided, get session_id
    if (sessionCode) {
      const session = await validateSession(sessionCode);
      if (!session) {
        return res.json({ assignments: [] });
      }
      sessionId = session.id;
    } else {
      // OLD SYSTEM: Use currentQuizId
      if (!currentQuizId) {
        return res.json({ assignments: [] });
      }
    }

    // Optimized: Single query with JOINs to get all data at once
    const result = await pool.query(
      `SELECT
        ma.id as assignment_id,
        ma.markee_name,
        ma.round_id,
        r.name as round_name,
        r.round_type,
        r.round_order,
        q.id as question_id,
        q.question_text,
        q.image_url,
        q.question_order,
        q.answer as correct_answer,
        pa.answer_text,
        pm.score
       FROM marking_assignments ma
       JOIN rounds r ON ma.round_id = r.id
       LEFT JOIN questions q ON q.round_id = ma.round_id
       LEFT JOIN player_answers pa ON pa.question_id = q.id AND pa.player_name = ma.markee_name AND pa.session_id IS NOT DISTINCT FROM $2
       LEFT JOIN peer_marks pm ON pm.assignment_id = ma.id AND pm.question_id = q.id
       WHERE ma.marker_name = $1 AND ma.session_id IS NOT DISTINCT FROM $2
       ORDER BY r.round_order, q.question_order`,
      [playerName, sessionId]
    );

    // Group results by assignment
    const assignmentsMap = {};

    result.rows.forEach(row => {
      const assignmentId = row.assignment_id;

      // Initialize assignment if not exists
      if (!assignmentsMap[assignmentId]) {
        assignmentsMap[assignmentId] = {
          assignment_id: row.assignment_id,
          markee_name: row.markee_name,
          round_id: row.round_id,
          round_name: row.round_name,
          round_type: row.round_type,
          questions: [],
          answers: {},
          marks: {}
        };
      }

      // Add question if it exists and hasn't been added yet
      if (row.question_id && !assignmentsMap[assignmentId].questions.find(q => q.id === row.question_id)) {
        assignmentsMap[assignmentId].questions.push({
          id: row.question_id,
          question_text: row.question_text,
          image_url: row.image_url,
          question_order: row.question_order,
          correct_answer: row.correct_answer
        });
      }

      // Add answer if exists
      if (row.question_id && row.answer_text) {
        assignmentsMap[assignmentId].answers[row.question_id] = row.answer_text;
      }

      // Add mark if exists
      if (row.question_id && row.score !== null) {
        assignmentsMap[assignmentId].marks[row.question_id] = row.score;
      }
    });

    // Convert map to array
    const assignments = Object.values(assignmentsMap);

    res.json({ assignments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit a peer mark for a question
app.post('/api/marking/submit', async (req, res) => {
  const { assignment_id, question_id, score } = req.body;

  try {
    if (!assignment_id || !question_id || score === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate score
    if (![0, 0.5, 1].includes(parseFloat(score))) {
      return res.status(400).json({ error: 'Score must be 0, 0.5, or 1' });
    }

    // Upsert the mark
    await pool.query(
      `INSERT INTO peer_marks (assignment_id, question_id, score)
       VALUES ($1, $2, $3)
       ON CONFLICT (assignment_id, question_id)
       DO UPDATE SET score = $3, marked_at = CURRENT_TIMESTAMP`,
      [assignment_id, question_id, score]
    );

    res.json({ success: true, message: 'Mark submitted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get marking results for MC to view
app.get('/api/marking/results', async (req, res) => {
  const sessionCode = req.query.session;

  try {
    let sessionId = null;

    // NEW SYSTEM: If session code provided, get session_id
    if (sessionCode) {
      const session = await validateSession(sessionCode);
      if (!session) {
        return res.json({ results: [] });
      }
      sessionId = session.id;
    } else {
      // OLD SYSTEM: Use currentQuizId
      if (!currentQuizId) {
        return res.json({ results: [] });
      }
    }

    // Get all marks for the current game
    const result = await pool.query(
      `SELECT
        ma.markee_name,
        r.name as round_name,
        r.id as round_id,
        q.question_text,
        q.question_order,
        pa.answer_text,
        pm.score,
        ma.marker_name
       FROM marking_assignments ma
       JOIN rounds r ON ma.round_id = r.id
       JOIN questions q ON q.round_id = r.id
       LEFT JOIN player_answers pa ON pa.player_name = ma.markee_name AND pa.question_id = q.id AND pa.session_id IS NOT DISTINCT FROM $1
       LEFT JOIN peer_marks pm ON pm.assignment_id = ma.id AND pm.question_id = q.id
       WHERE ma.session_id IS NOT DISTINCT FROM $1
       ORDER BY ma.markee_name, r.round_order, q.question_order`,
      [sessionId]
    );

    res.json({ results: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear all marking data for current quiz
app.post('/api/marking/clear', async (req, res) => {
  const sessionCode = req.query.session;

  try {
    // NEW SYSTEM: Session-based marking only
    if (sessionCode) {
      const session = await validateSession(sessionCode);
      if (!session) {
        return res.status(404).json({ error: 'Session not found or expired' });
      }

      // Delete peer marks through cascade
      await pool.query(
        'DELETE FROM marking_assignments WHERE session_id = $1',
        [session.id]
      );

      // Delete triggered rounds records
      await pool.query(
        'DELETE FROM triggered_rounds WHERE session_id = $1',
        [session.id]
      );

      // Turn off marking mode
      await pool.query(
        'UPDATE game_sessions SET marking_mode = FALSE WHERE id = $1',
        [session.id]
      );

      res.json({
        success: true,
        message: 'All marking data cleared for session'
      });
    } else {
      // OLD SYSTEM: Marking not supported without sessions
      // For old system, just delete assignments with NULL session_id
      await pool.query('DELETE FROM marking_assignments WHERE session_id IS NULL');
      await pool.query('DELETE FROM triggered_rounds WHERE session_id IS NULL');

      res.json({
        success: true,
        message: 'All marking data cleared'
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============= SESSION ENDPOINTS (NEW - MULTI-GAME SUPPORT) =============

// Create a new game session from a quiz template
app.post('/api/sessions/create', async (req, res) => {
  const { quiz_id, owner_id } = req.body;
  try {
    // Verify quiz exists and get full quiz data
    const quizResult = await pool.query(
      'SELECT * FROM quizzes WHERE id = $1',
      [quiz_id]
    );

    if (quizResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    // Generate unique session code
    const sessionCode = await generateSessionCode();

    // Create game session with owner_id - sessions are active immediately
    const result = await pool.query(
      `INSERT INTO game_sessions (session_code, quiz_id, status, current_round_id, marking_mode, owner_id)
       VALUES ($1, $2, 'active', NULL, FALSE, $3)
       RETURNING *`,
      [sessionCode, quiz_id, owner_id]
    );

    const session = result.rows[0];
    const quiz = quizResult.rows[0];

    // Generate lobby URL
    const lobbyUrl = `/lobby?session=${sessionCode}`;

    res.json({
      success: true,
      session: session,
      quiz: quiz,
      sessionCode: sessionCode,
      lobbyUrl: lobbyUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get session details by code
app.get('/api/sessions/:code', async (req, res) => {
  try {
    const sessionCode = req.params.code.toUpperCase();
    const session = await validateSession(sessionCode);

    if (!session) {
      return res.status(404).json({ error: 'Session not found or expired' });
    }

    // Get quiz details
    const quizResult = await pool.query(
      'SELECT id, quiz_name, quiz_date FROM quizzes WHERE id = $1',
      [session.quiz_id]
    );

    res.json({
      session: session,
      quiz: quizResult.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all active sessions (for MC view)
app.get('/api/sessions/active/all', async (_req, res) => {
  try {
    const oneHourAgo = new Date(Date.now() - 3600000);

    const result = await pool.query(
      `SELECT gs.*, q.quiz_name, q.quiz_date,
              (SELECT COUNT(*) FROM players WHERE session_id = gs.id) as player_count
       FROM game_sessions gs
       JOIN quizzes q ON gs.quiz_id = q.id
       WHERE gs.last_activity > $1
       ORDER BY gs.created_at DESC`,
      [oneHourAgo]
    );

    res.json({ sessions: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get MC's own sessions only
app.get('/api/sessions/my-sessions', async (req, res) => {
  const { owner_id } = req.query;

  if (!owner_id) {
    return res.status(400).json({ error: 'owner_id required' });
  }

  try {
    const oneHourAgo = new Date(Date.now() - 3600000);

    const result = await pool.query(
      `SELECT gs.*, q.quiz_name, q.quiz_date,
              (SELECT COUNT(*) FROM players WHERE session_id = gs.id) as player_count
       FROM game_sessions gs
       JOIN quizzes q ON gs.quiz_id = q.id
       WHERE gs.owner_id = $1 AND gs.last_activity > $2
       ORDER BY gs.created_at DESC`,
      [owner_id, oneHourAgo]
    );

    res.json({ sessions: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// End a game session manually
app.post('/api/sessions/:code/end', async (req, res) => {
  try {
    const sessionCode = req.params.code.toUpperCase();

    const result = await pool.query(
      'DELETE FROM game_sessions WHERE session_code = $1 RETURNING *',
      [sessionCode]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      success: true,
      message: 'Session ended successfully'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============= SERVE ANGULAR APP IN PRODUCTION =============

// Serve static files from the Angular app (in production)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist/qubPiz/browser')));

  // All non-API routes should redirect to the Angular app
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/qubPiz/browser/index.html'));
  });
}

// ============= START SERVER =============

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
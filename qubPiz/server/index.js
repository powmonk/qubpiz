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

// Track which quiz is currently active
let currentQuizId = null;

// Create tables sequentially
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_session (
        id SERIAL PRIMARY KEY,
        quiz_name VARCHAR(200) NOT NULL,
        quiz_date DATE NOT NULL,
        status VARCHAR(20) DEFAULT 'waiting',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        /* current_round_id is added below */
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rounds (
        id SERIAL PRIMARY KEY,
        game_session_id INTEGER REFERENCES game_session(id) ON DELETE CASCADE,
        name VARCHAR(200) NOT NULL,
        round_type VARCHAR(50) NOT NULL,
        round_order INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

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

    // Add this table creation after the existing tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS player_answers (
        id SERIAL PRIMARY KEY,
        player_name VARCHAR(100) NOT NULL,
        question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
        round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
        answer_text TEXT NOT NULL,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(player_name, question_id)
      )
    `);
    
    // START NEW SCHEMA CHANGES: Add current_round_id column
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='game_session' AND column_name='current_round_id') THEN
          ALTER TABLE game_session ADD COLUMN current_round_id INTEGER REFERENCES rounds(id) ON DELETE SET NULL;
        END IF;
      END
      $$;
    `);

    // Create marking_assignments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marking_assignments (
        id SERIAL PRIMARY KEY,
        game_session_id INTEGER REFERENCES game_session(id) ON DELETE CASCADE,
        marker_name VARCHAR(100) NOT NULL,
        markee_name VARCHAR(100) NOT NULL,
        round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(marker_name, round_id)
      )
    `);

    // Create peer_marks table
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

    // Add marking_mode column to game_session
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='game_session' AND column_name='marking_mode') THEN
          ALTER TABLE game_session ADD COLUMN marking_mode BOOLEAN DEFAULT FALSE;
        END IF;
      END
      $$;
    `);

    // Create triggered_rounds table to track which rounds have been sent for marking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS triggered_rounds (
        id SERIAL PRIMARY KEY,
        game_session_id INTEGER REFERENCES game_session(id) ON DELETE CASCADE,
        round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
        triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(game_session_id, round_id)
      )
    `);

    // END NEW SCHEMA CHANGES

    console.log('Database tables created successfully');

    await pool.query('UPDATE game_session SET current_round_id = NULL');
    await pool.query('DELETE FROM players');
    await pool.query("UPDATE game_session SET status = 'waiting'");
    
    console.log('Game state reset: cleared players, active rounds, and reset all games to waiting');
    
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
      "INSERT INTO game_session (quiz_name, quiz_date, status) VALUES ($1, $2, 'waiting') RETURNING *",
      [quiz_name, quiz_date]
    );
    currentQuizId = result.rows[0].id;
    res.json({ quiz: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all quizzes
app.get('/api/quizzes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM game_session ORDER BY quiz_date DESC, created_at DESC');
    res.json({ quizzes: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Select a quiz to work on (UPDATED to clear players and active round)
app.post('/api/quiz/select/:id', async (req, res) => {
  try {
    const quizId = parseInt(req.params.id);
    const result = await pool.query('SELECT * FROM game_session WHERE id = $1', [quizId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quiz not found' });
    }
    
    currentQuizId = quizId;
    
    // Clear players and active round when switching quizzes
    await pool.query('DELETE FROM players');
    await pool.query('UPDATE game_session SET current_round_id = NULL WHERE id = $1', [quizId]);

    // Re-fetch quiz data after update (to include cleared current_round_id)
    const updatedResult = await pool.query('SELECT * FROM game_session WHERE id = $1', [quizId]);
    res.json({ quiz: updatedResult.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get current active quiz (UPDATED to select new column)
app.get('/api/quiz/current', async (req, res) => {
  try {
    if (!currentQuizId) {
      return res.json({ quiz: null });
    }
    const result = await pool.query('SELECT * FROM game_session WHERE id = $1', [currentQuizId]);
    if (result.rows.length === 0) {
      currentQuizId = null;
      return res.json({ quiz: null });
    }
    res.json({ quiz: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check if game is active (lobby is active only when status is 'active')
app.get('/api/game/status', async (req, res) => {
  try {
    if (!currentQuizId) {
      return res.json({
        active: false,
        status: 'waiting',
        current_round_id: null,
        current_round_type: null,
        current_round_name: null
      });
    }
    
    // LEFT JOIN with rounds table to fetch round details when a round is active
    const result = await pool.query(
      `SELECT gs.status, gs.current_round_id, gs.marking_mode, r.round_type, r.name as round_name
       FROM game_session gs
       LEFT JOIN rounds r ON gs.current_round_id = r.id
       WHERE gs.id = $1`,
      [currentQuizId]
    );

    if (result.rows.length === 0) {
      return res.json({
        active: false,
        status: 'waiting',
        current_round_id: null,
        current_round_type: null,
        current_round_name: null,
        marking_mode: false
      });
    }

    const row = result.rows[0];
    const isActive = row.status === 'active';

    res.json({
      active: isActive,
      status: row.status,
      current_round_id: row.current_round_id,
      current_round_type: row.round_type,
      current_round_name: row.round_name,
      marking_mode: row.marking_mode || false
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle game status (UPDATED FOR 3 STATES)
app.post('/api/game/toggle-status', async (req, res) => {
  try {
    if (!currentQuizId) {
      return res.status(400).json({ error: 'No active quiz selected' });
    }
    
    const currentStatusResult = await pool.query(
      'SELECT status FROM game_session WHERE id = $1',
      [currentQuizId]
    );
    
    if (currentStatusResult.rows.length === 0) {
        return res.status(404).json({ error: 'Current quiz not found' });
    }

    const currentStatus = currentStatusResult.rows[0].status;
    let newStatus = '';
    let updateQuery = '';

    if (currentStatus === 'waiting') {
        newStatus = 'active';
        // When starting the game, ensure round is clear just in case
        updateQuery = 'UPDATE game_session SET status = $1, current_round_id = NULL WHERE id = $2 RETURNING *';
    } else if (currentStatus === 'active') {
        // Game is running, close the lobby
        newStatus = 'closed';
        updateQuery = 'UPDATE game_session SET status = $1 WHERE id = $2 RETURNING *';
    } else if (currentStatus === 'closed') {
        // Game is running, re-open the lobby
        newStatus = 'active';
        updateQuery = 'UPDATE game_session SET status = $1 WHERE id = $2 RETURNING *';
    } else {
        // Fallback to waiting and ensure active round is cleared
        newStatus = 'waiting'; 
        updateQuery = 'UPDATE game_session SET status = $1, current_round_id = NULL WHERE id = $2 RETURNING *';
    }
    
    // If we transition to 'waiting' (e.g. game over), clear active round AND flush players
    if (newStatus === 'waiting') {
        updateQuery = 'UPDATE game_session SET status = $1, current_round_id = NULL WHERE id = $2 RETURNING *';
        // Flush all players when game ends
        await pool.query('DELETE FROM players');
    }

    // Update the status in the database
    const updateResult = await pool.query(
      updateQuery,
      [newStatus, currentQuizId]
    );

    res.json({ quiz: updateResult.rows[0], message: `Game status set to ${newStatus}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a quiz
app.delete('/api/quiz/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM game_session WHERE id = $1', [req.params.id]);
    if (currentQuizId === parseInt(req.params.id)) {
      currentQuizId = null;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============= PLAYER ENDPOINTS =============

// Join game - add player
app.post('/api/join', async (req, res) => {
  const { name } = req.body;
  try {
    await pool.query(
      'INSERT INTO players (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
      [name]
    );
    const result = await pool.query('SELECT name FROM players ORDER BY joined_at');
    res.json({ players: result.rows.map(r => r.name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all players
app.get('/api/players', async (req, res) => {
  try {
    const result = await pool.query('SELECT name FROM players ORDER BY joined_at');
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
  try {
    const result = await pool.query('DELETE FROM players WHERE name = $1 RETURNING *', [name]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    // Return updated list of players
    const playersResult = await pool.query('SELECT name FROM players ORDER BY joined_at');
    res.json({ players: playersResult.rows.map(r => r.name), message: `${name} removed.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============= MC QUESTION DISPLAY ENDPOINTS =============

// NEW ENDPOINT: MC sets the round to be displayed
app.post('/api/game/set-round/:roundId', async (req, res) => {
  const roundId = parseInt(req.params.roundId);
  try {
    if (!currentQuizId) {
      return res.status(400).json({ error: 'No active quiz selected' });
    }
    
    // Check for "clear display" signal (roundId === 0)
    if (roundId === 0) {
      await pool.query('UPDATE game_session SET current_round_id = NULL WHERE id = $1', [currentQuizId]);
      return res.json({ success: true, message: 'Display cleared (current_round_id set to NULL)' });
    }

    // Validate that the round belongs to the current quiz
    const roundResult = await pool.query(
      'SELECT id FROM rounds WHERE id = $1 AND game_session_id = $2',
      [roundId, currentQuizId]
    );

    if (roundResult.rows.length === 0) {
      return res.status(404).json({ error: 'Round not found for current quiz.' });
    }
    
    // Set the current_round_id in the game session
    await pool.query(
      'UPDATE game_session SET current_round_id = $1 WHERE id = $2',
      [roundId, currentQuizId]
    );

    res.json({ success: true, roundId: roundId, message: `Round ${roundId} set for display.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NEW ENDPOINT: Players poll this to get the current round and questions
app.get('/api/game/display-data', async (req, res) => {
  try {
    if (!currentQuizId) {
      return res.json({ round: null, questions: [] });
    }
    
    // 1. Get the current displayed round ID from the game session
    const gameSessionResult = await pool.query(
      'SELECT current_round_id FROM game_session WHERE id = $1',
      [currentQuizId]
    );

    const currentRoundId = gameSessionResult.rows[0]?.current_round_id;
    
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
  const { name, round_type } = req.body;
  try {
    if (!currentQuizId) {
      return res.status(400).json({ error: 'No active quiz selected' });
    }
    
    // Get next order number
    const orderResult = await pool.query(
      'SELECT COALESCE(MAX(round_order), 0) + 1 as next_order FROM rounds WHERE game_session_id = $1',
      [currentQuizId]
    );
    const nextOrder = orderResult.rows[0].next_order;
    
    const result = await pool.query(
      'INSERT INTO rounds (game_session_id, name, round_type, round_order) VALUES ($1, $2, $3, $4) RETURNING *',
      [currentQuizId, name, round_type, nextOrder]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all rounds for current game
app.get('/api/rounds', async (req, res) => {
  try {
    if (!currentQuizId) {
      return res.json({ rounds: [] });
    }
    
    const result = await pool.query(
      'SELECT * FROM rounds WHERE game_session_id = $1 ORDER BY round_order',
      [currentQuizId]
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
    await pool.query('UPDATE game_session SET current_round_id = NULL WHERE current_round_id = $1', [roundId]);
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
  
  try {
    if (!player_name || !question_id || !round_id || !answer_text) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Use UPSERT to allow players to update their answers
    await pool.query(
      `INSERT INTO player_answers (player_name, question_id, round_id, answer_text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (player_name, question_id)
       DO UPDATE SET answer_text = $4, submitted_at = CURRENT_TIMESTAMP`,
      [player_name, question_id, round_id, answer_text]
    );

    res.json({ success: true, message: 'Answer submitted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get player's answers for a specific round
app.get('/api/answers/:playerName/:roundId', async (req, res) => {
  const { playerName, roundId } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT question_id, answer_text FROM player_answers 
       WHERE player_name = $1 AND round_id = $2`,
      [playerName, roundId]
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
  try {
    if (!currentQuizId) {
      return res.status(400).json({ error: 'No active quiz selected' });
    }

    // Get all rounds for this quiz
    const roundsResult = await pool.query(
      'SELECT id FROM rounds WHERE game_session_id = $1 ORDER BY round_order',
      [currentQuizId]
    );

    if (roundsResult.rows.length === 0) {
      return res.status(400).json({ error: 'No rounds found for this quiz' });
    }

    // Get all players who submitted any answers for this quiz
    const playersResult = await pool.query(
      `SELECT DISTINCT player_name FROM player_answers pa
       JOIN rounds r ON pa.round_id = r.id
       WHERE r.game_session_id = $1
       ORDER BY player_name`,
      [currentQuizId]
    );

    const allPlayers = playersResult.rows.map(row => row.player_name);

    if (allPlayers.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 players with answers to create marking assignments' });
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
        'SELECT id FROM triggered_rounds WHERE game_session_id = $1 AND round_id = $2',
        [currentQuizId, roundId]
      );

      if (existingTrigger.rows.length > 0) {
        continue; // Skip already triggered rounds
      }

      // Get players who answered THIS round
      const roundPlayersResult = await pool.query(
        'SELECT DISTINCT player_name FROM player_answers WHERE round_id = $1',
        [roundId]
      );

      const roundPlayers = new Set(roundPlayersResult.rows.map(row => row.player_name));

      // Create assignments only for players who participated in this round
      for (let i = 0; i < shuffled.length; i++) {
        const marker = shuffled[i];
        const markee = shuffled[(i + 1) % shuffled.length];

        // Only create assignment if both marker and markee participated
        if (roundPlayers.has(marker) && roundPlayers.has(markee)) {
          const result = await pool.query(
            `INSERT INTO marking_assignments (game_session_id, marker_name, markee_name, round_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (marker_name, round_id) DO NOTHING
             RETURNING *`,
            [currentQuizId, marker, markee, roundId]
          );

          if (result.rows.length > 0) {
            totalAssignments++;
          }
        }
      }

      // Mark this round as triggered
      await pool.query(
        'INSERT INTO triggered_rounds (game_session_id, round_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [currentQuizId, roundId]
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
  try {
    if (!currentQuizId) {
      return res.status(400).json({ error: 'No active quiz selected' });
    }

    const currentResult = await pool.query(
      'SELECT marking_mode FROM game_session WHERE id = $1',
      [currentQuizId]
    );

    const currentMode = currentResult.rows[0]?.marking_mode || false;
    const newMode = !currentMode;

    await pool.query(
      'UPDATE game_session SET marking_mode = $1 WHERE id = $2',
      [newMode, currentQuizId]
    );

    res.json({
      marking_mode: newMode,
      message: `Marking mode ${newMode ? 'enabled' : 'disabled'}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get marking assignments for a player (all triggered rounds)
app.get('/api/marking/assignments/:playerName', async (req, res) => {
  const { playerName } = req.params;

  try {
    if (!currentQuizId) {
      return res.json({ assignments: [] });
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
       LEFT JOIN player_answers pa ON pa.question_id = q.id AND pa.player_name = ma.markee_name
       LEFT JOIN peer_marks pm ON pm.assignment_id = ma.id AND pm.question_id = q.id
       WHERE ma.marker_name = $1 AND ma.game_session_id = $2
       ORDER BY r.round_order, q.question_order`,
      [playerName, currentQuizId]
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
  try {
    if (!currentQuizId) {
      return res.json({ results: [] });
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
       LEFT JOIN player_answers pa ON pa.player_name = ma.markee_name AND pa.question_id = q.id
       LEFT JOIN peer_marks pm ON pm.assignment_id = ma.id AND pm.question_id = q.id
       WHERE ma.game_session_id = $1
       ORDER BY ma.markee_name, r.round_order, q.question_order`,
      [currentQuizId]
    );

    res.json({ results: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear all marking data for current quiz
app.post('/api/marking/clear', async (req, res) => {
  try {
    if (!currentQuizId) {
      return res.status(400).json({ error: 'No active quiz selected' });
    }

    // Delete peer marks through cascade
    await pool.query(
      'DELETE FROM marking_assignments WHERE game_session_id = $1',
      [currentQuizId]
    );

    // Delete triggered rounds records
    await pool.query(
      'DELETE FROM triggered_rounds WHERE game_session_id = $1',
      [currentQuizId]
    );

    // Turn off marking mode
    await pool.query(
      'UPDATE game_session SET marking_mode = FALSE WHERE id = $1',
      [currentQuizId]
    );

    res.json({
      success: true,
      message: 'All marking data cleared for current quiz'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============= SERVE ANGULAR APP IN PRODUCTION =============

// Serve static files from the Angular app (in production)
// Commented out in development - Angular dev server handles this
// app.use(express.static(path.join(__dirname, '../dist/qubPiz/browser')));

// All other routes should redirect to the Angular app
// Commented out in development - Express 5 doesn't support '*' route
// app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, '../dist/qubPiz/browser/index.html'));
// });

// ============= START SERVER =============

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
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

// Database connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
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
      `SELECT gs.status, gs.current_round_id, r.round_type, r.name as round_name
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
        current_round_name: null
      });
    }
    
    const row = result.rows[0];
    const isActive = row.status === 'active';
    
    res.json({ 
      active: isActive, 
      status: row.status,
      current_round_id: row.current_round_id,
      current_round_type: row.round_type,
      current_round_name: row.round_name
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
    
    // If we transition to 'waiting' (e.g. game over), clear active round
    if (newStatus === 'waiting') {
        updateQuery = 'UPDATE game_session SET status = $1, current_round_id = NULL WHERE id = $2 RETURNING *';
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

// ============= START SERVER =============

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
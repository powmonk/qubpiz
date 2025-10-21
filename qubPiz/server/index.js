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

    console.log('Database tables created successfully');
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

// Select a quiz to work on
app.post('/api/quiz/select/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM game_session WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quiz not found' });
    }
    currentQuizId = parseInt(req.params.id);
    // Clear players when switching quizzes
    await pool.query('DELETE FROM players');
    res.json({ quiz: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get current active quiz
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

// Check if game is active
app.get('/api/game/status', async (req, res) => {
  try {
    if (!currentQuizId) {
      return res.json({ active: false });
    }
    const result = await pool.query('SELECT status FROM game_session WHERE id = $1', [currentQuizId]);
    if (result.rows.length === 0) {
      res.json({ active: false });
    } else {
      res.json({ active: true, status: result.rows[0].status });
    }
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

// Delete a round
app.delete('/api/rounds/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM rounds WHERE id = $1', [req.params.id]);
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
const express = require('express');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3000;

// Connect to (or create) the database file
const db = new Database('tracker.db');

// Create tables if they don't exist yet
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    age INTEGER NOT NULL,
    sex TEXT NOT NULL,
    preferred_unit TEXT NOT NULL DEFAULT 'lbs',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS body_weight_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    bodyweight REAL NOT NULL,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    equipment TEXT NOT NULL,
    exercise_type TEXT NOT NULL,
    weight_increment REAL NOT NULL DEFAULT 5,
    rep_range_min INTEGER NOT NULL,
    rep_range_max INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_id INTEGER NOT NULL,
    weight REAL NOT NULL,
    reps INTEGER NOT NULL,
    notes TEXT,
    performed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id)
  );
`);

app.use(express.json());
app.use(express.static('public'));

// ─── EXERCISES ───────────────────────────────────────────────

// API: get all exercises
app.get('/api/exercises', (req, res) => {
  const exercises = db.prepare('SELECT * FROM exercises ORDER BY created_at ASC').all();
  res.json(exercises);
});

// API: add a new exercise
app.post('/api/exercises', (req, res) => {
  const { name, equipment, exercise_type, rep_range_min, rep_range_max, weight_increment } = req.body;

  if (!name || !equipment || !exercise_type || !rep_range_min || !rep_range_max || !weight_increment) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const result = db.prepare(
    'INSERT INTO exercises (name, equipment, exercise_type, rep_range_min, rep_range_max, weight_increment) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, equipment, exercise_type, rep_range_min, rep_range_max, weight_increment);

  res.json({ id: result.lastInsertRowid, name, equipment, exercise_type, rep_range_min, rep_range_max, weight_increment });
});

// ─── SESSIONS ────────────────────────────────────────────────

// API: log a new session
app.post('/api/sessions', (req, res) => {
  const { exercise_id, weight, reps, notes } = req.body;

  if (!exercise_id || !weight || !reps) {
    return res.status(400).json({ error: 'Exercise, weight and reps are required' });
  }

  const result = db.prepare(
    'INSERT INTO sessions (exercise_id, weight, reps, notes) VALUES (?, ?, ?, ?)'
  ).run(exercise_id, weight, reps, notes || null);

  res.json({ id: result.lastInsertRowid, exercise_id, weight, reps, notes });
});

// API: get all sessions for a specific exercise
app.get('/api/sessions/:exercise_id', (req, res) => {
  const sessions = db.prepare(
    'SELECT * FROM sessions WHERE exercise_id = ? ORDER BY performed_at DESC'
  ).all(req.params.exercise_id);
  res.json(sessions);
});

// API: get last session + weight recommendation for an exercise
app.get('/api/recommendation/:exercise_id', (req, res) => {
  const exercise = db.prepare('SELECT * FROM exercises WHERE id = ?').get(req.params.exercise_id);
  if (!exercise) return res.status(404).json({ error: 'Exercise not found' });

  const lastSession = db.prepare(
    'SELECT * FROM sessions WHERE exercise_id = ? ORDER BY performed_at DESC LIMIT 1'
  ).get(req.params.exercise_id);

  if (!lastSession) {
    return res.json({ exercise, lastSession: null, recommendation: null });
  }

  let recommendedWeight = lastSession.weight;
  let message = '';

  if (lastSession.reps >= exercise.rep_range_max) {
    recommendedWeight = lastSession.weight + exercise.weight_increment;
    message = `You hit the top of your rep range last session — increase to ${recommendedWeight} lbs`;
  } else if (lastSession.reps >= exercise.rep_range_min) {
    message = `You're within your rep range — stick with ${recommendedWeight} lbs`;
  } else {
    message = `You fell below your rep range — stick with ${recommendedWeight} lbs and work up`;
  }

  res.json({ exercise, lastSession, recommendedWeight, message });
});

// ─── PROFILE ─────────────────────────────────────────────────

// API: get user profile
app.get('/api/profile', (req, res) => {
  const user = db.prepare('SELECT * FROM users LIMIT 1').get();
  if (!user) return res.json(null);

  const latestWeight = db.prepare(
    'SELECT * FROM body_weight_log WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1'
  ).get(user.id);

  res.json({ ...user, current_bodyweight: latestWeight ? latestWeight.bodyweight : null });
});

// API: create or update profile
app.post('/api/profile', (req, res) => {
  const { first_name, last_name, age, sex, preferred_unit, bodyweight } = req.body;

  if (!first_name || !last_name || !age || !sex || !preferred_unit || !bodyweight) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  let user = db.prepare('SELECT * FROM users LIMIT 1').get();

  if (!user) {
    const result = db.prepare(
      'INSERT INTO users (first_name, last_name, age, sex, preferred_unit) VALUES (?, ?, ?, ?, ?)'
    ).run(first_name, last_name, age, sex, preferred_unit);
    user = { id: result.lastInsertRowid };
  } else {
    db.prepare(
      'UPDATE users SET first_name = ?, last_name = ?, age = ?, sex = ?, preferred_unit = ? WHERE id = ?'
    ).run(first_name, last_name, age, sex, preferred_unit, user.id);
  }

  db.prepare(
    'INSERT INTO body_weight_log (user_id, bodyweight) VALUES (?, ?)'
  ).run(user.id, bodyweight);

  res.json({ success: true });
});

// API: get bodyweight history
app.get('/api/profile/bodyweight-history', (req, res) => {
  const user = db.prepare('SELECT * FROM users LIMIT 1').get();
  if (!user) return res.json([]);

  const history = db.prepare(
    'SELECT * FROM body_weight_log WHERE user_id = ? ORDER BY recorded_at DESC'
  ).all(user.id);

  res.json(history);
});

// API: dashboard summary stats
app.get('/api/stats/summary', (req, res) => {
  const total_sessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
  const total_volume = db.prepare('SELECT SUM(weight * reps) as volume FROM sessions').get().volume || 0;
  const last_session = db.prepare('SELECT performed_at FROM sessions ORDER BY performed_at DESC LIMIT 1').get();

  res.json({
    total_sessions,
    total_volume,
    last_session: last_session ? last_session.performed_at : null
  });
});

// ─── START SERVER ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Mentzer Tracker running at http://localhost:${PORT}`);
});
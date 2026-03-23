require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = 3000;

const db = new Database('tracker.db');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── CREATE TABLES ────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    age INTEGER NOT NULL,
    sex TEXT NOT NULL,
    preferred_unit TEXT NOT NULL DEFAULT 'lbs',
    theme TEXT NOT NULL DEFAULT 'light',
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

  CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    performed_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS workout_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id INTEGER NOT NULL,
    exercise_id INTEGER NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (workout_id) REFERENCES workouts(id),
    FOREIGN KEY (exercise_id) REFERENCES exercises(id)
  );

  CREATE TABLE IF NOT EXISTS sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_exercise_id INTEGER NOT NULL,
    set_number INTEGER NOT NULL,
    weight REAL NOT NULL,
    reps INTEGER NOT NULL,
    notes TEXT,
    FOREIGN KEY (workout_exercise_id) REFERENCES workout_exercises(id)
  );
`);

app.use(express.json());
app.use(express.static('public'));

// ─── EXERCISES ───────────────────────────────────────────────

app.get('/api/exercises', (req, res) => {
  const exercises = db.prepare(
    'SELECT * FROM exercises ORDER BY name ASC'
  ).all();
  res.json(exercises);
});

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

app.delete('/api/exercises/:id', (req, res) => {
  db.prepare('DELETE FROM exercises WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── WORKOUTS ────────────────────────────────────────────────

// Get all workouts (for history view)
app.get('/api/workouts', (req, res) => {
  const { year, month, date } = req.query;
  let query = 'SELECT * FROM workouts WHERE 1=1';
  const params = [];

  if (year) { query += ' AND strftime("%Y", performed_at) = ?'; params.push(year); }
  if (month) { query += ' AND strftime("%m", performed_at) = ?'; params.push(month.padStart(2, '0')); }
  if (date) { query += ' AND date(performed_at) = ?'; params.push(date); }

  query += ' ORDER BY performed_at DESC';
  const workouts = db.prepare(query).all(...params);
  res.json(workouts);
});

// Get a single workout with all exercises and sets
app.get('/api/workouts/:id', (req, res) => {
  const workout = db.prepare('SELECT * FROM workouts WHERE id = ?').get(req.params.id);
  if (!workout) return res.status(404).json({ error: 'Workout not found' });

  const workoutExercises = db.prepare(`
    SELECT we.id, we.order_index, e.id as exercise_id, e.name, e.equipment, e.exercise_type,
           e.rep_range_min, e.rep_range_max, e.weight_increment
    FROM workout_exercises we
    JOIN exercises e ON we.exercise_id = e.id
    WHERE we.workout_id = ?
    ORDER BY we.order_index ASC
  `).all(req.params.id);

  workoutExercises.forEach(ex => {
    ex.sets = db.prepare(
      'SELECT * FROM sets WHERE workout_exercise_id = ? ORDER BY set_number ASC'
    ).all(ex.id);
  });

  res.json({ ...workout, exercises: workoutExercises });
});

// Create a new workout
app.post('/api/workouts', (req, res) => {
  const { title, subtitle, performed_at } = req.body;
  const user = db.prepare('SELECT * FROM users LIMIT 1').get();
  if (!user) return res.status(400).json({ error: 'Please create a profile first' });
  if (!title || !performed_at) return res.status(400).json({ error: 'Title and date are required' });

  const result = db.prepare(
    'INSERT INTO workouts (user_id, title, subtitle, performed_at) VALUES (?, ?, ?, ?)'
  ).run(user.id, title, subtitle || null, performed_at);

  res.json({ id: result.lastInsertRowid, title, subtitle, performed_at });
});

// Update a workout
app.put('/api/workouts/:id', (req, res) => {
  const { title, subtitle, performed_at } = req.body;
  db.prepare(
    'UPDATE workouts SET title = ?, subtitle = ?, performed_at = ? WHERE id = ?'
  ).run(title, subtitle || null, performed_at, req.params.id);
  res.json({ success: true });
});

// Delete a workout
app.delete('/api/workouts/:id', (req, res) => {
  const workout = db.prepare('SELECT * FROM workouts WHERE id = ?').get(req.params.id);
  if (!workout) return res.status(404).json({ error: 'Workout not found' });

  const workoutExercises = db.prepare(
    'SELECT id FROM workout_exercises WHERE workout_id = ?'
  ).all(req.params.id);

  workoutExercises.forEach(we => {
    db.prepare('DELETE FROM sets WHERE workout_exercise_id = ?').run(we.id);
  });

  db.prepare('DELETE FROM workout_exercises WHERE workout_id = ?').run(req.params.id);
  db.prepare('DELETE FROM workouts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── WORKOUT EXERCISES ───────────────────────────────────────

// Add an exercise to a workout
app.post('/api/workouts/:workout_id/exercises', (req, res) => {
  const { exercise_id, order_index } = req.body;
  if (!exercise_id) return res.status(400).json({ error: 'Exercise ID is required' });

  const result = db.prepare(
    'INSERT INTO workout_exercises (workout_id, exercise_id, order_index) VALUES (?, ?, ?)'
  ).run(req.params.workout_id, exercise_id, order_index || 0);

  res.json({ id: result.lastInsertRowid, workout_id: req.params.workout_id, exercise_id, order_index });
});

// Remove an exercise from a workout
app.delete('/api/workout-exercises/:id', (req, res) => {
  db.prepare('DELETE FROM sets WHERE workout_exercise_id = ?').run(req.params.id);
  db.prepare('DELETE FROM workout_exercises WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── SETS ────────────────────────────────────────────────────

// Add a set
app.post('/api/sets', (req, res) => {
  const { workout_exercise_id, set_number, weight, reps, notes } = req.body;
  if (!workout_exercise_id || !set_number || !weight || !reps) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const result = db.prepare(
    'INSERT INTO sets (workout_exercise_id, set_number, weight, reps, notes) VALUES (?, ?, ?, ?, ?)'
  ).run(workout_exercise_id, set_number, weight, reps, notes || null);
  res.json({ id: result.lastInsertRowid, workout_exercise_id, set_number, weight, reps, notes });
});

// Update a set
app.put('/api/sets/:id', (req, res) => {
  const { weight, reps, notes } = req.body;
  db.prepare(
    'UPDATE sets SET weight = ?, reps = ?, notes = ? WHERE id = ?'
  ).run(weight, reps, notes || null, req.params.id);
  res.json({ success: true });
});

// Delete a set
app.delete('/api/sets/:id', (req, res) => {
  db.prepare('DELETE FROM sets WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── EXERCISE HISTORY ────────────────────────────────────────

app.get('/api/exercises/:id/history', (req, res) => {
  const history = db.prepare(`
    SELECT
      w.performed_at,
      w.title as workout_title,
      s.set_number,
      s.weight,
      s.reps,
      s.notes,
      (s.weight * s.reps) as volume
    FROM sets s
    JOIN workout_exercises we ON s.workout_exercise_id = we.id
    JOIN workouts w ON we.workout_id = w.id
    WHERE we.exercise_id = ?
    ORDER BY w.performed_at DESC
  `).all(req.params.id);
  res.json(history);
});

// ─── PROFILE ─────────────────────────────────────────────────

app.get('/api/profile', (req, res) => {
  const user = db.prepare('SELECT * FROM users LIMIT 1').get();
  if (!user) return res.json(null);
  const latestWeight = db.prepare(
    'SELECT * FROM body_weight_log WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1'
  ).get(user.id);
  res.json({ ...user, current_bodyweight: latestWeight ? latestWeight.bodyweight : null });
});

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

app.get('/api/profile/bodyweight-history', (req, res) => {
  const user = db.prepare('SELECT * FROM users LIMIT 1').get();
  if (!user) return res.json([]);
  const history = db.prepare(
    'SELECT * FROM body_weight_log WHERE user_id = ? ORDER BY recorded_at DESC'
  ).all(user.id);
  res.json(history);
});

// ─── SETTINGS ────────────────────────────────────────────────

app.put('/api/settings', (req, res) => {
  const { preferred_unit, theme } = req.body;
  const user = db.prepare('SELECT * FROM users LIMIT 1').get();
  if (!user) return res.status(400).json({ error: 'No user found' });
  db.prepare(
    'UPDATE users SET preferred_unit = ?, theme = ? WHERE id = ?'
  ).run(preferred_unit, theme, user.id);
  res.json({ success: true });
});

// ─── AI ──────────────────────────────────────────────────────

app.post('/api/ai/classify-exercise', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Exercise name is required' });

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are an expert strength training coach specializing in Mike Mentzer's Heavy Duty training methodology.

Given the exercise name "${name}", determine if it is ambiguous or clear.

An exercise is AMBIGUOUS if the variation significantly changes the classification. For example:
- "squat" could be barbell, bodyweight, or machine
- "curl" could be barbell bicep curl or leg curl
- "press" could be bench press, shoulder press, leg press

An exercise is CLEAR if the movement pattern is obvious even without full details. For example:
- "leg curl" is clearly an isolation machine exercise
- "lateral raise" is clearly an isolation dumbbell exercise
- "barbell bench press" is clearly a compound barbell exercise

If CLEAR, return ONLY this raw JSON with no markdown or backticks:
{
  "status": "clear",
  "name": "full proper exercise name",
  "exercise_type": "Compound" or "Isolation",
  "equipment": "Barbell" or "Dumbbell" or "Machine" or "Cable" or "Bodyweight" or "Other",
  "rep_range_min": a number,
  "rep_range_max": a number,
  "weight_increment": a number (10 for compound, 5 for isolation),
  "reasoning": "one sentence explanation"
}

If AMBIGUOUS, return ONLY this raw JSON with no markdown or backticks:
{
  "status": "ambiguous",
  "variations": [
    {
      "name": "full proper exercise name",
      "exercise_type": "Compound" or "Isolation",
      "equipment": "Barbell" or "Dumbbell" or "Machine" or "Cable" or "Bodyweight" or "Other",
      "rep_range_min": a number,
      "rep_range_max": a number,
      "weight_increment": a number,
      "reasoning": "one sentence explanation"
    }
  ]
}

For ambiguous exercises provide 3 to 5 meaningful variations. Use Mentzer's Heavy Duty rep ranges.`
      }]
    });

    const raw = message.content[0].text;
    const parsed = JSON.parse(raw);
    res.json(parsed);
  } catch (err) {
    console.error('AI classification error:', err);
    res.status(500).json({ error: 'AI classification failed' });
  }
});

app.post('/api/ai/recommendation', async (req, res) => {
  const { exercise_id, workout_exercise_id } = req.body;

  const exercise = db.prepare('SELECT * FROM exercises WHERE id = ?').get(exercise_id);
  if (!exercise) return res.status(404).json({ error: 'Exercise not found' });

  const lastSession = db.prepare(`
    SELECT s.weight, s.reps, w.performed_at
    FROM sets s
    JOIN workout_exercises we ON s.workout_exercise_id = we.id
    JOIN workouts w ON we.workout_id = w.id
    WHERE we.exercise_id = ?
    ORDER BY w.performed_at DESC, s.set_number DESC
    LIMIT 1
  `).get(exercise_id);

  if (!lastSession) {
    return res.json({ message: 'No previous data found. Start with a weight you can comfortably handle for the target rep range.' });
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `You are Mike Mentzer's Heavy Duty training coach. Give a brief, direct recommendation.

Exercise: ${exercise.name}
Equipment: ${exercise.equipment}
Type: ${exercise.exercise_type}
Target rep range: ${exercise.rep_range_min}-${exercise.rep_range_max}
Weight increment: ${exercise.weight_increment} lbs
Last session: ${lastSession.weight} lbs x ${lastSession.reps} reps

Based on Heavy Duty principles, should the athlete increase weight, stay the same, or reduce weight next session? Give a 2-3 sentence recommendation including the specific weight to use next session.`
      }]
    });

    res.json({ message: message.content[0].text });
  } catch (err) {
    console.error('AI recommendation error:', err);
    res.status(500).json({ error: 'AI recommendation failed' });
  }
});

// ─── DASHBOARD STATS ─────────────────────────────────────────

app.get('/api/stats/summary', (req, res) => {
  const total_workouts = db.prepare('SELECT COUNT(*) as count FROM workouts').get().count;
  const total_volume = db.prepare('SELECT SUM(weight * reps) as volume FROM sets').get().volume || 0;
  const last_workout = db.prepare('SELECT performed_at FROM workouts ORDER BY performed_at DESC LIMIT 1').get();
  res.json({ total_workouts, total_volume, last_workout: last_workout ? last_workout.performed_at : null });
});

// ─── START SERVER ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Dad Wave running at http://localhost:${PORT}`);
});
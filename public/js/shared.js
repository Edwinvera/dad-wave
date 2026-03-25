// Fetch the user's profile and return it
async function getProfile() {
  const res = await fetch('/api/profile');
  return res.json();
}

// Fetch all exercises and return them
async function getExercises() {
  const res = await fetch('/api/exercises');
  return res.json();
}

// Format a date string nicely
function formatDate(dateStr) {
  const [year, month, day] = dateStr.slice(0, 10).split('-');
  return new Date(year, month - 1, day).toLocaleDateString();
}

// Capitalize first letter of a string
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── THEME ────────────────────────────────────────────────────

function applyTheme(theme) {
  if (theme === 'dark') {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
  localStorage.setItem('theme', theme);
}

async function loadTheme() {
  // Check localStorage first for instant application (no flash)
  const cached = localStorage.getItem('theme');
  if (cached) applyTheme(cached);

  // Then verify against server
  try {
    const profile = await getProfile();
    if (profile && profile.theme) applyTheme(profile.theme);
  } catch (e) {
    // fail silently
  }
}

// Load theme on every page automatically
loadTheme();
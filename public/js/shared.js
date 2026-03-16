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
  return new Date(dateStr).toLocaleDateString();
}

// Capitalize first letter of a string
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
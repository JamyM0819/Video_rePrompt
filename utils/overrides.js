// Runtime configuration overrides — set by frontend via POST /api/config
// Persisted to disk so they survive server restarts (outputs/ is gitignored)

const fs = require('fs');
const path = require('path');

const OVERRIDES_FILE = path.join(__dirname, '..', 'outputs', '.overrides.json');
let overrides = {};

// Load from disk on startup
try {
  if (fs.existsSync(OVERRIDES_FILE)) {
    overrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf-8'));
    console.log('[overrides] Loaded from disk:', Object.keys(overrides).join(', ') || '(empty)');
  }
} catch (e) {
  console.error('[overrides] Failed to load:', e.message);
}

function save() {
  try {
    const dir = path.dirname(OVERRIDES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2) + '\n', 'utf-8');
  } catch (e) {
    console.error('[overrides] Failed to save:', e.message);
  }
}

module.exports = {
  get(key) {
    return overrides[key];
  },
  set(key, value) {
    overrides[key] = value;
    save();
  },
  getAll() {
    return { ...overrides };
  },
  apply(obj) {
    let changed = false;
    Object.keys(obj).forEach(k => {
      if (obj[k] === null || obj[k] === undefined) {
        if (k in overrides) { delete overrides[k]; changed = true; }
      } else {
        if (overrides[k] !== obj[k]) { overrides[k] = obj[k]; changed = true; }
      }
    });
    if (changed) save();
  },
  clear() {
    if (Object.keys(overrides).length === 0) return;
    overrides = {};
    save();
  },
};

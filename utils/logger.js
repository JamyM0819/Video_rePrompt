const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
let logStream = null;
let currentDate = '';

function ensureStream() {
  const today = new Date().toISOString().slice(0, 10);
  if (logStream && currentDate === today) return;
  if (logStream) { try { logStream.end(); } catch {} }
  fs.mkdirSync(LOG_DIR, { recursive: true });
  logStream = fs.createWriteStream(path.join(LOG_DIR, `${today}.log`), { flags: 'a' });
  currentDate = today;
}

function formatTime() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0') + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0') + ':' +
    String(d.getSeconds()).padStart(2, '0') + '.' +
    String(d.getMilliseconds()).padStart(3, '0');
}

function write(level, args) {
  ensureStream();
  const message = args.map(a => {
    if (a instanceof Error) return a.message || String(a);
    if (typeof a === 'string') return a;
    return JSON.stringify(a);
  }).join(' ');
  const line = `[${formatTime()}] [${level}] ${message}`;
  logStream.write(line + '\n');
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
}

const logger = {
  info(...args) { write('INFO', args); },
  warn(...args) { write('WARN', args); },
  error(...args) {
    // If last arg looks like an Error with a .message, log its stack too
    const last = args[args.length - 1];
    if (last instanceof Error && last.stack) {
      write('ERROR', args);
      // Also write the stack trace to the log
      ensureStream();
      logStream.write(last.stack.replace(/^/gm, '  ') + '\n');
    } else {
      write('ERROR', args);
    }
  },

  /** Return recent log lines (tail) */
  tail(lines = 100) {
    ensureStream();
    try {
      const data = fs.readFileSync(path.join(LOG_DIR, `${currentDate}.log`), 'utf-8');
      const all = data.trim().split('\n');
      return all.slice(-lines);
    } catch {
      return [];
    }
  },

  /** List available log files */
  listFiles() {
    try {
      return fs.readdirSync(LOG_DIR)
        .filter(f => f.endsWith('.log'))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  },

  /** Read a specific log file */
  readFile(filename, lines = 200) {
    const file = path.join(LOG_DIR, path.basename(filename));
    if (!fs.existsSync(file)) return [];
    try {
      const data = fs.readFileSync(file, 'utf-8');
      const all = data.trim().split('\n');
      return all.slice(-lines);
    } catch {
      return [];
    }
  },

  /** Clear today's log (truncate to empty) */
  clear() {
    if (logStream) {
      try { logStream.end(); } catch {}
      logStream = null;
    }
    try {
      const today = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(path.join(LOG_DIR, `${today}.log`), '', 'utf-8');
      // Reopen stream
      logStream = fs.createWriteStream(path.join(LOG_DIR, `${today}.log`), { flags: 'a' });
      currentDate = today;
      return true;
    } catch {
      return false;
    }
  },

  /** Delete a specific log file */
  deleteFile(filename) {
    const file = path.join(LOG_DIR, path.basename(filename));
    if (!fs.existsSync(file)) return false;
    try {
      fs.unlinkSync(file);
      if (logStream && currentDate === path.basename(filename, '.log')) {
        try { logStream.end(); } catch {}
        logStream = null;
        currentDate = '';
      }
      return true;
    } catch {
      return false;
    }
  },
};

// Catch unhandled rejections
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', reason);
});

// Catch uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
  console.error(err);
  process.exit(1);
});

module.exports = logger;

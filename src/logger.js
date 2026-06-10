const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

let verbose = false;

// Ring buffer + subscribers so the web dashboard can show recent activity.
const buffer = [];
const listeners = new Set();

const ts = () => new Date().toTimeString().slice(0, 8);

function record(level, args) {
  const line = {
    t: Date.now(),
    level,
    msg: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
  };
  buffer.push(line);
  if (buffer.length > 300) buffer.shift();
  for (const fn of listeners) {
    try {
      fn(line);
    } catch {}
  }
}

export const logger = {
  setVerbose(v) {
    verbose = v;
  },
  recent() {
    return [...buffer];
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  info(...a) {
    record('info', a);
    console.log(`${C.dim}${ts()}${C.reset} ${C.cyan}INFO ${C.reset}`, ...a);
  },
  ok(...a) {
    record('ok', a);
    console.log(`${C.dim}${ts()}${C.reset} ${C.green}OK   ${C.reset}`, ...a);
  },
  warn(...a) {
    record('warn', a);
    console.warn(`${C.dim}${ts()}${C.reset} ${C.yellow}WARN ${C.reset}`, ...a);
  },
  error(...a) {
    record('error', a);
    console.error(`${C.dim}${ts()}${C.reset} ${C.red}ERROR${C.reset}`, ...a);
  },
  debug(...a) {
    if (!verbose) return;
    record('debug', a);
    console.log(`${C.dim}${ts()} DEBUG`, ...a, C.reset);
  },
};

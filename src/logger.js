const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

let verbose = false;

const ts = () => new Date().toTimeString().slice(0, 8);

export const logger = {
  setVerbose(v) {
    verbose = v;
  },
  info(...a) {
    console.log(`${C.dim}${ts()}${C.reset} ${C.cyan}INFO ${C.reset}`, ...a);
  },
  ok(...a) {
    console.log(`${C.dim}${ts()}${C.reset} ${C.green}OK   ${C.reset}`, ...a);
  },
  warn(...a) {
    console.warn(`${C.dim}${ts()}${C.reset} ${C.yellow}WARN ${C.reset}`, ...a);
  },
  error(...a) {
    console.error(`${C.dim}${ts()}${C.reset} ${C.red}ERROR${C.reset}`, ...a);
  },
  debug(...a) {
    if (verbose) console.log(`${C.dim}${ts()} DEBUG`, ...a, C.reset);
  },
};

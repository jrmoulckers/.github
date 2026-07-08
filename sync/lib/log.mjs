// Tiny leveled logger. No dependencies; writes to stderr so stdout stays clean
// for machine-readable plan output when needed.

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
};

const useColor = process.stderr.isTTY && !process.env.NO_COLOR;
const paint = (color, text) => (useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text);

export const log = {
  info(msg) {
    process.stderr.write(`${msg}\n`);
  },
  step(msg) {
    process.stderr.write(`${paint('cyan', '▶')} ${msg}\n`);
  },
  ok(msg) {
    process.stderr.write(`${paint('green', '✓')} ${msg}\n`);
  },
  warn(msg) {
    process.stderr.write(`${paint('yellow', 'WARNING:')} ${msg}\n`);
  },
  error(msg) {
    process.stderr.write(`${paint('red', 'ERROR:')} ${msg}\n`);
  },
  dim(msg) {
    process.stderr.write(`${paint('dim', msg)}\n`);
  },
};

export { paint };

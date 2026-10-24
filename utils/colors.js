'use strict';

/**
 * ANSI colors. Node enables virtual terminal processing on Windows, so these
 * render in cmd, PowerShell and Windows Terminal. NO_COLOR turns them off.
 */
const ENABLED = !process.env.NO_COLOR;

function wrap(open, close) {
  return (value) => (ENABLED ? `\x1b[${open}m${String(value)}\x1b[${close}m` : String(value));
}

const colors = {
  enabled: ENABLED,
  reset: (v) => String(v),
  bold: wrap('1', '22'),
  dim: wrap('2', '22'),
  italic: wrap('3', '23'),
  underline: wrap('4', '24'),
  red: wrap('31', '39'),
  green: wrap('32', '39'),
  yellow: wrap('33', '39'),
  blue: wrap('34', '39'),
  magenta: wrap('35', '39'),
  cyan: wrap('36', '39'),
  white: wrap('37', '39'),
  gray: wrap('90', '39'),
  bgGreen: wrap('42', '49'),
  bgRed: wrap('41', '49'),
  bgBlue: wrap('44', '49'),
};

/** Green block for an available name. */
function available(text) {
  return colors.bgGreen(colors.bold(` ${text} `));
}

/** Red block for a taken name. */
function taken(text) {
  return colors.bgRed(colors.bold(` ${text} `));
}

/** Yellow block for an inconclusive result. */
function unknown(text) {
  return colors.bgBlue(colors.bold(` ${text} `));
}

module.exports = { colors, available, taken, unknown };

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Append-only result log on disk.
 * Writes available names the moment they are found so nothing is lost
 * if the terminal scrolls or the run is cut short.
 */
class ResultLog {
  constructor(filePath) {
    this.filePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    this.ready = false;
  }

  ensure() {
    if (this.ready) return;
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(
        this.filePath,
        '# username scan results\n# <timestamp> <status> <name>\n\n',
        'utf8',
      );
    }
    this.ready = true;
  }

  write(status, name, detail) {
    try {
      this.ensure();
      const stamp = new Date().toISOString();
      const tail = detail ? `  ${detail}` : '';
      fs.appendFileSync(this.filePath, `${stamp} ${status.padEnd(9)} ${name}${tail}\n`, 'utf8');
    } catch (err) {
      // Never let a disk problem stop a run.
    }
  }

  available(name) {
    this.write('AVAILABLE', name);
  }

  taken(name) {
    this.write('taken', name);
  }

  note(name, detail) {
    this.write('note', name, detail);
  }
}

module.exports = { ResultLog };

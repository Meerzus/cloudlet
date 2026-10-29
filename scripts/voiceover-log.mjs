// Records what VoiceOver speaks during manual assistive-technology checks, so the
// results file can quote actual speech instead of a summary. macOS only, no dependencies.
//
//   node scripts/voiceover-log.mjs --self-test     # VoiceOver speaks a marker; the log must catch it
//   node scripts/voiceover-log.mjs [--out file]    # append every new phrase as JSON lines until Ctrl+C
//
// Needs VoiceOver turned on (Cmd+F5), "Allow VoiceOver to be controlled with AppleScript" in
// VoiceOver Utility > General, and the terminal allowed to control VoiceOver (Automation).
// A phrase spoken twice in a row is logged once: the poll only sees the last phrase change.
import { execFile } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';

const run = promisify(execFile);
const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    interval: { type: 'string', default: '200' },
    'self-test': { type: 'boolean', default: false },
  },
});
const interval = Number(values.interval);
if (!Number.isFinite(interval) || interval < 50) {
  console.error('--interval must be a number of milliseconds, at least 50');
  process.exit(1);
}
const out = resolve(values.out ?? `artifacts/release/manual/voiceover-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

async function voiceOverRunning() {
  try {
    await run('pgrep', ['-x', 'VoiceOver']);
    return true;
  } catch {
    return false;
  }
}

/** One AppleScript command to VoiceOver; never sent while VoiceOver is off, since the event would launch it. */
async function voiceOver(command) {
  if (!await voiceOverRunning()) throw new Error('VoiceOver is off: turn it on with Cmd+F5, then run again.');
  try {
    const { stdout } = await run('osascript', ['-e', `with timeout of 2 seconds\ntell application "VoiceOver" to ${command}\nend timeout`], { timeout: 5000 });
    return stdout.replace(/\n$/u, '');
  } catch (error) {
    const text = String(error.stderr || error.message);
    if (text.includes('-1743')) throw new Error('macOS does not allow this terminal to control VoiceOver: allow it in System Settings > Privacy & Security > Automation.');
    // The VoiceOver process can linger as a background service while the screen reader is off.
    if (text.includes('-1712') || error.killed) throw new Error('VoiceOver does not answer AppleScript: turn VoiceOver on (Cmd+F5) and enable "Allow VoiceOver to be controlled with AppleScript" in VoiceOver Utility > General.');
    throw new Error(`osascript failed: ${text.trim()}`);
  }
}

const lastPhrase = () => voiceOver('return content of last phrase');
const quote = (text) => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

async function main() {
  if (values['self-test']) {
    const marker = `Cloudlet logger check ${Date.now() % 10000}`;
    await voiceOver(`output ${quote(marker)}`);
    const deadline = Date.now() + 3000;
    let heard = '';
    while (Date.now() < deadline) {
      heard = await lastPhrase();
      if (heard.includes(marker)) break;
      await new Promise((settle) => setTimeout(settle, interval));
    }
    if (!heard.includes(marker)) throw new Error(`Self-test failed: VoiceOver last phrase is ${JSON.stringify(heard)}, expected the marker ${JSON.stringify(marker)}`);
    console.log(`Self-test passed: VoiceOver spoke and the logger read back ${JSON.stringify(marker)}.`);
  } else {
    await mkdir(dirname(out), { recursive: true });
    let previous = await lastPhrase();
    console.log(`Logging VoiceOver speech to ${out} every ${interval} ms; Ctrl+C stops.`);
    let count = 0;
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => {
        console.log(`\nStopped: ${count} phrases in ${out}`);
        process.exit(0);
      });
    }
    for (;;) {
      await new Promise((settle) => setTimeout(settle, interval));
      let phrase;
      try {
        phrase = await lastPhrase();
      } catch (error) {
        console.error(error.message);
        continue;
      }
      if (!phrase || phrase === previous) continue;
      previous = phrase;
      count += 1;
      const at = new Date().toISOString();
      await appendFile(out, `${JSON.stringify({ at, phrase })}\n`);
      console.log(`${at.slice(11, 23)}  ${phrase}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

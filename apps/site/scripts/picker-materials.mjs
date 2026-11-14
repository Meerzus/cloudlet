// Exports the generated landing materials of /color-picker (material-<frame>.png)
// to AVIF + WebP at two widths. sharp-cli runs through npx, outside the
// workspace, so it never enters package.json or the lock file. A source
// narrower than a target width is exported at its own width, never enlarged.
// Frame names after the directory export only those frames.
//   node apps/site/scripts/picker-materials.mjs <materials-dir> [frame ...]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHARP = 'sharp-cli@6.1.0';
const QUALITY = { avif: 55, webp: 80 };
const FRAMES = {
  hero: [1280, 2560],
  'hero-tall': [720, 1440],
  palette: [1280, 2560],
  // Behind the fluted glass the frame is blurred and the shader draws the ribs: one width is enough.
  opacity: [1280],
  tools: [1280],
  // The long frame under the whole page (1280×3840): phones take the narrow one.
  page: [640, 1280],
};

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.argv[2] ?? '');
const only = process.argv.slice(3);
for (const frame of only) if (!(frame in FRAMES)) throw new Error(`Unknown frame ${frame}`);
const target = join(site, 'public/picker');
mkdirSync(target, { recursive: true });

const pngWidth = (file) => readFileSync(file).readUInt32BE(16);

for (const [frame, widths] of Object.entries(FRAMES)) {
  if (only.length && !only.includes(frame)) continue;
  const input = join(source, `material-${frame}.png`);
  if (!existsSync(input)) throw new Error(`Missing ${input}`);
  const width = pngWidth(input);
  for (const size of widths) {
    for (const format of ['avif', 'webp']) {
      const output = join(target, `material-${frame}-${size}.${format}`);
      execFileSync('npx', ['-y', SHARP, '-i', input, '-o', output, '-f', format, '-q', String(QUALITY[format]), 'resize', String(Math.min(size, width))], { cwd: tmpdir(), stdio: 'inherit' });
      console.log(`${output.slice(site.length + 1)}  ${(statSync(output).size / 1024).toFixed(1)} KB`);
    }
  }
}

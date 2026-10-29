#!/usr/bin/env node
/**
 * Lays frames of a recording out as a contact sheet (headless Chromium decodes the
 * Playwright .webm itself; the bundled ffmpeg cannot).
 *
 *   node apps/site/scripts/filmstrip.mjs <video.webm> <out.png> [--from s] [--to s] [--count n] [--columns n] [--width px]
 */
import { writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? Number(args.splice(index, 2)[1]) : fallback;
};
const from = option('--from', 0);
const to = option('--to', Infinity);
const count = option('--count', 24);
const columns = option('--columns', 6);
const width = option('--width', 320);
const [video, output] = args.map((path) => resolve(path));
if (!video || !output) throw new Error('usage: filmstrip.mjs <video.webm> <out.png> [options]');

const page = join(dirname(video), `.filmstrip-${basename(video)}.html`);
writeFileSync(page, `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111">
<video src="${basename(video)}" muted preload="auto" style="display:none"></video><canvas></canvas>`);

const browser = await chromium.launch();
const tab = await browser.newPage();
await tab.goto(pathToFileURL(page).href);
const size = await tab.evaluate(
  async ({ from, to, count, columns, width }) => {
    const video = document.querySelector('video');
    await new Promise((done) => (video.readyState >= 1 ? done() : video.addEventListener('loadedmetadata', done, { once: true })));
    // MediaRecorder webm has no duration until the end is seeked once.
    if (!Number.isFinite(video.duration)) {
      video.currentTime = 1e9;
      await new Promise((done) => video.addEventListener('seeked', done, { once: true }));
    }
    const end = Math.min(to, video.duration - 0.05);
    const height = Math.round((width * video.videoHeight) / video.videoWidth);
    const rows = Math.ceil(count / columns);
    const canvas = document.querySelector('canvas');
    canvas.width = columns * width;
    canvas.height = rows * (height + 18);
    const g = canvas.getContext('2d');
    g.font = '12px system-ui';
    for (let index = 0; index < count; index += 1) {
      const time = from + ((end - from) * index) / Math.max(1, count - 1);
      video.currentTime = time;
      await new Promise((done) => video.addEventListener('seeked', done, { once: true }));
      const x = (index % columns) * width;
      const y = Math.floor(index / columns) * (height + 18);
      g.drawImage(video, x, y, width, height);
      g.fillStyle = '#ddd';
      g.fillText(`${time.toFixed(2)} s`, x + 6, y + height + 13);
    }
    return { width: canvas.width, height: canvas.height };
  },
  { from, to, count, columns, width },
);
await tab.setViewportSize(size);
await tab.locator('canvas').screenshot({ path: output });
await browser.close();

// Bundles src/ into a single self-contained index.html (works from file:// and any static host)
import * as esbuild from 'esbuild';
import fs from 'fs';
const r = await esbuild.build({ entryPoints: ['src/main.js'], bundle: true, minify: !process.argv.includes('--dev'), format: 'iife', target: ['es2020'], write: false, legalComments: 'none' });
const js = r.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const html = fs.readFileSync('web/index.src.html', 'utf8').replace('/*__BUNDLE__*/', () => js);
fs.writeFileSync('index.html', html);
console.log('index.html', (html.length / 1024).toFixed(0) + ' KB');

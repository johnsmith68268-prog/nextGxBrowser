import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const docsDir = path.resolve('..', 'docs');

fs.rmSync(docsDir, { recursive: true, force: true });
fs.cpSync(distDir, docsDir, { recursive: true });
console.log('Synced landing-page/dist -> docs/');

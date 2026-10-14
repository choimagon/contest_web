import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { validateConfig } from '../public/store.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist');
const url = process.env.SUPABASE_URL?.trim();
const key = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)?.trim();
if (Boolean(url) !== Boolean(key)) throw new Error('SUPABASE_URL and a public Supabase key must be set together.');
let projectConfig = {};
try { projectConfig = JSON.parse(await readFile(resolve(root, 'supabase/public-config.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const config = url && key ? validateConfig({ url, key }) : projectConfig.url ? validateConfig(projectConfig) : {};
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, 'public'), output, { recursive: true });
await writeFile(resolve(output, 'config.js'), `window.PYROOM_CONFIG = ${JSON.stringify(config).replaceAll('<', '\\u003c')};\n`);
await readFile(resolve(output, 'index.html'));
console.log('Pyroom built → dist/ (' + (config.url ? 'Supabase configured' : 'Supabase configuration required') + ')');

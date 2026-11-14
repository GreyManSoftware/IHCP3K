#!/usr/bin/env node
// Only invoke as a harness headers helper: stdout intentionally carries a secret.
import {readFileSync} from 'node:fs';
try {
  if(process.argv.length!==3)throw Error();
  const token=readFileSync(process.argv[2],'utf8').trim();
  if(!/^[A-Za-z0-9_-]{24,256}$/.test(token))throw Error();
  process.stdout.write(JSON.stringify({Authorization:`Bearer ${token}`}));
} catch {process.stderr.write('Cannot read IHCP3K credential\n');process.exitCode=1;}

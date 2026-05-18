import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';
import { resolveProvider } from './settings.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Optional .env support without a dependency. Values already in the
// environment are left alone by Node's loader.
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.warn(`[env] Could not load .env: ${error.message}`);
  }
}

const port = Number(process.env.PORT) || 4400;
const host = process.env.HOST || '127.0.0.1';
const dataDir = process.env.HARNESS_DATA_DIR
  ? path.resolve(root, process.env.HARNESS_DATA_DIR)
  : path.join(root, 'data');
const app = createApp({ workspaceRoot: root, dataDir });

const provider = resolveProvider(app.config);
const server = app.server;

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\nPort ${port} is already in use. Start with PORT=4401 npm start\n`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  const actualPort = server.address().port;
  console.log('');
  console.log('  Agent Harness');
  console.log(`  Local:   http://${host}:${actualPort}`);
  console.log(`  Data:    ${app.dataDir}`);
  console.log(`  Model:   ${provider.name}${provider.name === 'demo' ? '' : ` / ${provider.model}`}`);
  if (provider.warning) console.log(`  Note:    ${provider.warning}`);
  console.log('');
  console.log('  Press Ctrl+C to stop. Scheduled tasks only run while this process is running.');
  console.log('');
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nStopping...');
  server.close(() => {
    app.close();
    process.exit(0);
  });
  setTimeout(() => {
    app.close();
    process.exit(0);
  }, 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

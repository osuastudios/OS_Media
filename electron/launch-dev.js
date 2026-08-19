// Lanzador de desarrollo: arranca Electron apuntando a esta carpeta.
//
// Es necesario porque algunos entornos (p. ej. la terminal integrada de
// VS Code, que es en sí misma una app Electron) heredan la variable
// ELECTRON_RUN_AS_NODE, y con ella puesta Electron arranca en modo "Node
// puro" en lugar de como app de escritorio. cross-env solo puede dejarla
// vacía, no borrarla del todo, así que lo hacemos aquí con `delete`.
const { spawn } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env, NODE_ENV: 'development' };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));

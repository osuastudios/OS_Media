import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' es necesario para que el build de producción cargue los assets
// con rutas relativas cuando Electron abre el index.html con file://
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});

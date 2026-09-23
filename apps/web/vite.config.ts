import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Mesma origem no navegador: o cookie de sessão funciona sem CORS.
    proxy: { '/api': 'http://localhost:3333' },
  },
});

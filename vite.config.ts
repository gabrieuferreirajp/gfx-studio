import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Instaladores e ferramentas embutidas não são vigiados: gerar o instalador não derruba o servidor.
export default defineConfig({ plugins: [react()], base: './', server: { watch: { ignored: ['**/release/**', '**/vendor/**', '**/dist/**', '**/build/**'] } } });

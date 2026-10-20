import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API_PORT = process.env.WEBFORGE_PORT ?? "8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // `changeOrigin: false` deja el Host de Vite intacto, así que el servidor
      // puede comparar Origin contra Host sin conocer el proxy.
      "/api": { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "shared/**/*.test.ts", "server/**/*.test.ts"],
    clearMocks: true,
    // Cada fichero se monta su propio entorno jsdom: con todos los núcleos como obreros a la
    // vez, la máquina se queda sin margen y un render que aislado dura 1 s pasa del presupuesto
    // y salta como fallo. El tope de obreros baja la agitación sin alargar el reloj (47 s) y las
    // 729 pruebas siguen comprobando lo mismo.
    testTimeout: 20000,
    maxWorkers: 5
  }
});

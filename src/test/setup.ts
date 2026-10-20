import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// Los flujos que pasan por un iframe y un autoguarda con retardo no caben en el segundo
// que trae testing-library por defecto cuando el portátil corre los 37 archivos a la vez.
configure({ asyncUtilTimeout: 3000 });

// jsdom no implementa matchMedia. Sin este stub, el editor y ThemeProvider fallan
// al consultar el medio. El entorno de test siempre simula escritorio claro.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

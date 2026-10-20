import { useEffect, useState } from "react";

/**
 * Plazo del enlace de verificación: el mismo que fija el servidor en `auth/email-tokens.ts`
 * (`VERIFY_TTL_MS`). Aquí solo hace falta para enseñar la cuenta atrás.
 */
export const VERIFICATION_SECONDS = 180;

/** Cuenta atrás legible; con horas cuando toca esperar tantas (el bloqueo de un día). */
export function restoFormateado(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const resto = String(total % 60).padStart(2, "0");
  return horas > 0 ? `${horas}:${String(minutos).padStart(2, "0")}:${resto}` : `${minutos}:${resto}`;
}

/**
 * Cuenta atrás que arranca en `total` y vuelve a arrancar al cambiar `reinicio`. Con `null`
 * no hay espera que enseñar: la pantalla no debe inventarse un plazo que el servidor no dijo.
 */
export function useCountdown(total: number | null, reinicio: number): number | null {
  const [resto, setResto] = useState<number | null>(total);
  useEffect(() => {
    if (total === null) {
      setResto(null);
      return;
    }
    setResto(total);
    const id = setInterval(() => setResto((actual) => (actual === null || actual <= 1 ? 0 : actual - 1)), 1000);
    return () => clearInterval(id);
  }, [total, reinicio]);
  return resto;
}

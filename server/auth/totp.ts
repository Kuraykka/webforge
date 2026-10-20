import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) con SHA-1, 6 dígitos y pasos de 30 s: lo que aceptan Google Authenticator,
 * Authy y similares. La ventana acepta el paso anterior y el siguiente para tolerar desfases.
 */
const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PASO_MS = 30_000;
const DIGITOS = 6;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = "";
  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
  return salida;
}

export function base32Decode(texto: string): Buffer {
  const limpio = texto.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const letra of limpio) {
    const indice = ALFABETO.indexOf(letra);
    if (indice === -1) continue;
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, time = Date.now()): string {
  const contador = Math.floor(time / PASO_MS);
  const mensaje = Buffer.alloc(8);
  mensaje.writeUInt32BE(Math.floor(contador / 2 ** 32), 0);
  mensaje.writeUInt32BE(contador % 2 ** 32, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(mensaje).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const codigo =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    ((hmac[offset + 1] ?? 0) << 16) |
    ((hmac[offset + 2] ?? 0) << 8) |
    (hmac[offset + 3] ?? 0);
  return String(codigo % 10 ** DIGITOS).padStart(DIGITOS, "0");
}

/** Comparación en tiempo constante: un código no se adivina midiendo lo que tarda en fallar. */
export function verifyTotp(secret: string, code: string, time = Date.now()): boolean {
  const limpio = code.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${DIGITOS}}$`).test(limpio)) return false;
  for (const desfase of [-1, 0, 1]) {
    const esperado = Buffer.from(totpCode(secret, time + desfase * PASO_MS));
    if (timingSafeEqual(esperado, Buffer.from(limpio))) return true;
  }
  return false;
}

/** URI que se pega en la aplicación de autenticación (o se convierte en QR). */
export function otpauthUri(secret: string, cuenta: string, emisor = "WebForge"): string {
  const etiqueta = `${encodeURIComponent(emisor)}:${encodeURIComponent(cuenta)}`;
  const parametros = new URLSearchParams({
    secret,
    issuer: emisor,
    algorithm: "SHA1",
    digits: String(DIGITOS),
    period: "30"
  });
  return `otpauth://totp/${etiqueta}?${parametros.toString()}`;
}

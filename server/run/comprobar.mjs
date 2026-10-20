// Comprobador de proyectos de WebForge. El servidor copia este archivo dentro de la jaula y lo
// lanza con `node .webforge/comprobar.mjs`, así que solo puede usar lo que trae Node: nada de
// dependencias del proyecto, nada de red. Lee los archivos que hay al lado y escribe lo que ve.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";

/** Lo que no es del proyecto: el propio comprobador y lo que instale el usuario. */
const OMITE = new Set([".webforge", "node_modules", ".git"]);
const MAX_ARCHIVOS = 300;
const MAX_BYTES = 256 * 1024;
const LENGUAJE = { htm: "html", html: "html", css: "css", js: "js", mjs: "js", cjs: "js", json: "json" };

const errores = [];
const avisos = [];
const falla = (archivo, mensaje) => errores.push(`${archivo}: ${mensaje}`);
const avisa = (archivo, mensaje) => avisos.push(`${archivo}: ${mensaje}`);

function caminar(dir) {
  const salida = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (entrada.isDirectory()) {
      if (!OMITE.has(entrada.name)) salida.push(...caminar(join(dir, entrada.name)));
    } else if (entrada.isFile()) {
      salida.push(join(dir, entrada.name));
    }
  }
  return salida;
}

const rutas = caminar(".").sort();
const existentes = new Set(rutas);

let lista = rutas;
if (rutas.length > MAX_ARCHIVOS) {
  avisos.push(`el proyecto trae ${rutas.length} archivos: solo se comprueban los ${MAX_ARCHIVOS} primeros`);
  lista = rutas.slice(0, MAX_ARCHIVOS);
}

function leer(ruta) {
  const stat = statSync(ruta);
  if (stat.size > MAX_BYTES) {
    avisa(ruta, `demasiado grande para abrirlo (${stat.size} bytes)`);
    return undefined;
  }
  return readFileSync(ruta, "utf8");
}

function atributo(etiqueta, nombre) {
  const m = new RegExp(`\\b${nombre}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s">]+))`, "i").exec(etiqueta);
  if (!m) return undefined;
  return m[2] ?? m[3] ?? m[4] ?? "";
}

function comprobarHtml(ruta, texto) {
  if (!/<!doctype\s+html/i.test(texto)) avisa(ruta, 'falta «<!doctype html>»');
  const raiz = /<html\b[^>]*>/i.exec(texto)?.[0];
  if (!raiz) falla(ruta, "no tiene un elemento <html>");
  else if (atributo(raiz, "lang") === undefined) avisa(ruta, "<html> no indica el idioma (lang)");
  if (!/<title\b[^>]*>\s*\S/i.test(texto)) avisa(ruta, "falta un <title> con texto");

  for (const imagen of texto.matchAll(/<img\b[^>]*>/gi)) {
    const etiqueta = imagen[0];
    if (atributo(etiqueta, "alt") === undefined) falla(ruta, "hay una <img> sin texto alternativo (alt)");
  }

  const veces = new Map();
  for (const m of texto.matchAll(/\bid\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const valor = (m[2] ?? m[3] ?? "").trim();
    if (valor) veces.set(valor, (veces.get(valor) ?? 0) + 1);
  }
  for (const [valor, n] of veces) if (n > 1) falla(ruta, `el id «${valor}» se repite ${n} veces`);

  for (const m of texto.matchAll(/(?:src|href)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const valor = (m[2] ?? m[3] ?? "").trim();
    if (valor === "" || /^(https?:|data:|mailto:|tel:|javascript:|blob:|\/\/|#)/i.test(valor)) continue;
    const limpio = valor.split(/[?#]/)[0] ?? "";
    if (limpio === "") continue;
    const destino = limpio.startsWith("/") ? limpio.slice(1) : normalize(join(dirname(ruta), limpio));
    if (destino.startsWith("..")) falla(ruta, `«${valor}» sale del proyecto`);
    else if (!existentes.has(destino)) falla(ruta, `«${valor}» apunta a un archivo que no está en el proyecto`);
  }
}

function comprobarCss(ruta, texto) {
  const sin = texto.replace(/\/\*[\s\S]*?\*\//g, "");
  let nivel = 0;
  for (const caracter of sin) {
    if (caracter === "{") nivel += 1;
    else if (caracter === "}") nivel -= 1;
    if (nivel < 0) break;
  }
  if (nivel > 0) falla(ruta, `quedan ${nivel} llaves «{» sin cerrar`);
  else if (nivel < 0) falla(ruta, "hay llaves «}» de más");
}

function comprobarJson(ruta, texto) {
  try {
    JSON.parse(texto);
  } catch (cause) {
    falla(ruta, `JSON inválido (${cause instanceof Error ? cause.message : String(cause)})`);
  }
}

let contador = 0;

/**
 * La sintaxis la juzga el propio Node (`--check`), no un invento nuestro: por eso la copia se
 * escribe con extensión `.mjs`, para que un archivo con `import` no salga como error falso.
 */
function comprobarJs(ruta, texto) {
  mkdirSync(".webforge", { recursive: true });
  const temporal = join(".webforge", `chequeo-${process.pid}-${(contador += 1)}.mjs`);
  try {
    writeFileSync(temporal, texto, "utf8");
    execFileSync(process.execPath, ["--check", temporal], { stdio: ["ignore", "pipe", "pipe"], timeout: 8000 });
  } catch (cause) {
    const salida = String((cause && cause.stderr) || "");
    const linea =
      salida.split("\n").map((l) => l.trim()).find((l) => /error/i.test(l)) ??
      salida.trim().split("\n")[0] ??
      "";
    falla(ruta, `sintaxis no válida${linea === "" ? "" : ` (${linea})`}`);
  } finally {
    rmSync(temporal, { force: true });
  }
}

for (const ruta of lista) {
  const lenguaje = LENGUAJE[extname(ruta).slice(1).toLowerCase()];
  if (!lenguaje) continue;
  let texto;
  try {
    texto = leer(ruta);
  } catch (cause) {
    falla(ruta, `no se pudo abrir (${cause instanceof Error ? cause.message : String(cause)})`);
    continue;
  }
  if (texto === undefined) continue;
  if (lenguaje === "html") comprobarHtml(ruta, texto);
  else if (lenguaje === "css") comprobarCss(ruta, texto);
  else if (lenguaje === "json") comprobarJson(ruta, texto);
  else comprobarJs(ruta, texto);
}

for (const mensaje of errores) console.error(`error  ${mensaje}`);
for (const mensaje of avisos) console.log(`aviso  ${mensaje}`);
console.log(`${errores.length} errores, ${avisos.length} avisos`);
process.exitCode = errores.length > 0 ? 1 : 0;

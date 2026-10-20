import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Un solo `npm run dev` levanta la API y el front. Vite hace de proxy /api, así que
// el navegador ve un único origen y la cookie de sesión SameSite=Strict sigue funcionando.
const viteBin = resolve(process.cwd(), "node_modules/.bin/vite");

if (!existsSync(viteBin)) {
  console.error(`Falta ${viteBin}: ejecuta npm install antes de npm run dev.`);
  process.exit(1);
}

const targets = [
  {
    name: "api",
    color: "\x1b[36m",
    cmd: process.execPath,
    args: ["--no-warnings=ExperimentalWarning", "--import", "tsx", "server/index.ts"]
  },
  { name: "web", color: "\x1b[35m", cmd: viteBin, args: [] }
];

const label = (name, color) => `${color}${name}\x1b[0m`;
const children = [];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}

for (const target of targets) {
  const child = spawn(target.cmd, target.args, { stdio: ["inherit", "pipe", "pipe"], env: process.env });
  const pipe = (stream, prefix) => {
    stream.setEncoding("utf8");
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) process.stdout.write(`${label(target.name, target.color)}${prefix} ${line}\n`);
    });
    stream.on("end", () => {
      if (buffer) process.stdout.write(`${label(target.name, target.color)}${prefix} ${buffer}\n`);
    });
  };
  pipe(child.stdout, " ");
  pipe(child.stderr, "!");
  child.on("exit", (code) => {
    if (!stopping) console.error(`${label(target.name, target.color)} salió con código ${code}`);
    stop(code ?? 0);
  });
  children.push(child);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

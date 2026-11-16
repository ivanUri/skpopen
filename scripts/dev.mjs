import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));

await rm(new URL("../.next", import.meta.url), { recursive: true, force: true });
console.log("Cleared .next cache before starting Next dev");

const child = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
});

const forwardSignal = (signal) => {
  if (!child.killed) child.kill(signal);
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

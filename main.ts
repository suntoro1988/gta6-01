import { access, cp, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-game.ts";

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? "/output");

async function has(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

await mkdir(out, { recursive: true });
await cp(join(root, "game"), join(out, "game"), { recursive: true });
if (await has(join(root, "screenshots"))) {
  await cp(join(root, "screenshots"), join(out, "screenshots"), {
    recursive: true,
  });
}
const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
await writeFile(join(out, "dossier.json"), dossier);
console.log("dossier.json written:", join(out, "dossier.json"));

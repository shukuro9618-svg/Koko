import { access, copyFile, mkdir, writeFile } from "node:fs/promises";

const root = new URL("./", import.meta.url);
const dist = new URL("./dist/", import.meta.url);
const config = {
  supabaseUrl: process.env.VITE_SUPABASE_URL || "",
  supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY || "",
  supabaseBucket: process.env.VITE_SUPABASE_BUCKET || "farewell-videos",
};
const files = [
  "index.html",
  "concept.html",
  "styles.css",
  "app.js",
  "manifest.json",
  "sw.js",
  "icon.svg",
];

console.log("Koko build started");
console.log("Supabase URL:", config.supabaseUrl ? "configured" : "not configured");

await mkdir(dist, { recursive: true });

for (const file of files) {
  try {
    await access(new URL(file, root));
  } catch {
    throw new Error(`Missing required file: ${file}`);
  }

  await copyFile(new URL(file, root), new URL(file, dist));
  console.log(`Copied ${file}`);
}

await writeFile(
  new URL("config.js", dist),
  `window.KOKO_CONFIG = ${JSON.stringify(config, null, 2)};\n`,
);
console.log("Generated config.js");
console.log("Koko build completed");

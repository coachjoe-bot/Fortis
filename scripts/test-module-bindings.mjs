// ─── Regression net for the "Can't find variable" class (08-17 prod outage) ──
// `export { x } from "./mod.js"` forwards a name WITHOUT creating a local
// binding; if the same file also USES x, every use is a runtime ReferenceError
// that neither the bundler (treats it as a global) nor the node suites (never
// import JSX) can see. This scans src/ + api/ for exactly that shape.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p);
  if (st.isDirectory()) { if (!/node_modules|assets/.test(p)) walk(p); } else if (/\.(js|jsx)$/.test(f)) files.push(p); } };
walk("src"); walk("api");

const bad = [];
for (const p of files) {
  const t = readFileSync(p, "utf8");
  for (const m of t.matchAll(/export\s*\{([^}]+)\}\s*from\s*["']/g)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0];
      if (!name) continue;
      const uses = (t.match(new RegExp(`\\b${name}\\b`, "g")) || []).length;
      const hasImport = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(t);
      if (uses > 1 && !hasImport) bad.push(`${p}: "${name}" re-exported without a local binding but referenced ${uses}x`);
    }
  }
}
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
console.log("module bindings clean");

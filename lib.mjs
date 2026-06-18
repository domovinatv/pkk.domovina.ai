// =============================================================================
// Zajednička logika za PKK dohvat i analizu (ePorezna / Porezna uprava)
// =============================================================================
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(ROOT, "data");

// Neopozivi fiksni tečaj konverzije (Uredba Vijeća EU 2022/1208).
// Hrvatska uvodi euro 1.1.2023.
export const HRK_PER_EUR = 7.53450;
export const EURO_YEAR = 2023; // prva godina u kojoj su iznosi u EUR

export const API_BASE = "https://upo.porezna-uprava.hr/api/v1/knjigovodstvo";

// ---- .env loader (bez vanjskih ovisnosti) -----------------------------------
function loadDotEnv() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

export function loadConfig() {
  loadDotEnv();
  const session = process.env.PKK_SESSION?.trim();
  const redirectState = process.env.PKK_REDIRECT_STATE?.trim();
  if (!session || !redirectState) {
    throw new Error(
      "Nedostaje PKK_SESSION ili PKK_REDIRECT_STATE.\n" +
        "Kopiraj .env.example u .env i popuni iz svježeg zahtjeva u browseru."
    );
  }
  const now = new Date();
  const startYear = parseInt(process.env.PKK_START_YEAR || "2016", 10);
  const endYear = parseInt(
    process.env.PKK_END_YEAR || String(now.getFullYear()),
    10
  );
  return {
    session,
    redirectState,
    startYear,
    endYear,
    dokumentOznaka: process.env.PKK_DOKUMENT_OZNAKA || "UVIDI_PKK_PROFIL",
  };
}

// ---- HTTP -------------------------------------------------------------------
export async function apiPost(endpoint, body, cfg) {
  const url = `${API_BASE}/${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: "https://upo.porezna-uprava.hr",
      Referer:
        "https://upo.porezna-uprava.hr/profil/uvid-u-pkk/ispostava-po-vrsti-prihoda",
      "X-Requested-With": "JavaScript",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      Cookie: `token-handler.session=${cfg.session}`,
      "x-redirect-state": cfg.redirectState,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? " — sesija je vjerojatno istekla, osvježi PKK_SESSION i PKK_REDIRECT_STATE u .env"
        : "";
    throw new Error(`HTTP ${res.status} na ${endpoint}${hint}\n${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Odgovor nije JSON na ${endpoint} (možda login redirect). Prvih 300 znakova:\n${text.slice(0, 300)}`
    );
  }
}

// ---- IO ----------------------------------------------------------------------
export function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function saveJson(name, obj) {
  ensureDataDir();
  writeFileSync(join(DATA_DIR, name), JSON.stringify(obj, null, 2));
}

export function loadJson(name) {
  return JSON.parse(readFileSync(join(DATA_DIR, name), "utf8"));
}

// ---- Tečaj -------------------------------------------------------------------
// Iznos iz PKK-a za danu godinu pretvori u EUR.
// Pretpostavka: godine < 2023 su u HRK, >= 2023 u EUR.
export function toEur(amount, year) {
  if (year < EURO_YEAR) return amount / HRK_PER_EUR;
  return amount;
}

export function fmtEur(n) {
  return new Intl.NumberFormat("hr-HR", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

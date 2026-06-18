#!/usr/bin/env node
// =============================================================================
// pkk-fetch.mjs — dohvaća sirove PKK podatke iz ePorezne i sprema u data/
// =============================================================================
// Pokretanje:  node pkk-fetch.mjs
//
// Sprema:
//   data/sifarnici-<godina>.json     (vrste prihoda i sl.)
//   data/sifarnik-placanja.json
//   data/stanje-<godina>.json        (stanje PKK po godini)
//
// Sirovi JSON namjerno se ne dira da analiza (pkk-analyze.mjs) može raditi
// offline, bez ponovnog dohvata.
// =============================================================================
import { loadConfig, apiPost, saveJson, fmtEur } from "./lib.mjs";

function pad2(n) {
  return String(n).padStart(2, "0");
}

// datumObracuna: za prošle godine 31.12., za tekuću današnji datum
function datumObracunaZa(year) {
  const now = new Date();
  if (year < now.getFullYear()) return `${year}-12-31`;
  return `${year}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

async function main() {
  const cfg = loadConfig();
  const years = [];
  for (let y = cfg.startYear; y <= cfg.endYear; y++) years.push(y);

  console.log(
    `Dohvaćam PKK za godine ${cfg.startYear}–${cfg.endYear} (dokument: ${cfg.dokumentOznaka})\n`
  );

  // 1) Šifarnik plaćanja (jednom)
  try {
    const sp = await apiPost(
      "pkk-dohvati-sifarnik-placanja",
      { dokumentOznaka: cfg.dokumentOznaka },
      cfg
    );
    saveJson("sifarnik-placanja.json", sp);
    console.log("✓ sifarnik-placanja.json");
  } catch (e) {
    console.warn("⚠ šifarnik plaćanja:", e.message.split("\n")[0]);
  }

  // 2) Šifarnici + stanje po godini
  let okYears = 0;
  for (const year of years) {
    try {
      const sif = await apiPost(
        "pkk-dohvati-sifarnike",
        { godina: year, dokumentOznaka: cfg.dokumentOznaka },
        cfg
      );
      saveJson(`sifarnici-${year}.json`, sif);
    } catch (e) {
      console.warn(`⚠ šifarnici ${year}:`, e.message.split("\n")[0]);
    }

    try {
      const stanje = await apiPost(
        "pkk-dohvati-stanje",
        {
          dokumentOznaka: cfg.dokumentOznaka,
          godina: String(year),
          datumObracuna: datumObracunaZa(year),
          vrstaPrihoda: [],
        },
        cfg
      );
      saveJson(`stanje-${year}.json`, stanje);
      const n = Array.isArray(stanje)
        ? stanje.length
        : Array.isArray(stanje?.stavke)
          ? stanje.stavke.length
          : "?";
      console.log(`✓ stanje-${year}.json  (${n} stavki)`);
      okYears++;
    } catch (e) {
      console.error(`✗ stanje ${year}:`, e.message.split("\n")[0]);
    }
  }

  console.log(
    `\nGotovo. Uspješno dohvaćeno ${okYears}/${years.length} godina u ./data/`
  );
  console.log("Sljedeći korak:  node pkk-analyze.mjs");
}

main().catch((e) => {
  console.error("\nGREŠKA:", e.message);
  process.exit(1);
});

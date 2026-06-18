#!/usr/bin/env node
// =============================================================================
// pkk-analyze.mjs — čita data/stanje-*.json, akumulira uplaćena javna davanja
//                   u EUR (uz konverziju HRK->EUR za godine < 2023)
// =============================================================================
// Pokretanje:
//   node pkk-analyze.mjs                 normalna analiza + CSV
//   node pkk-analyze.mjs --schema        ispiši strukturu (za provjeru polja)
//   node pkk-analyze.mjs --field <put>   generička analiza s ručno odabranim
//                                         poljem (npr. --field duguje)
//
// Poznata struktura ePorezne (pkk-dohvati-stanje):
//   podaci.saldaParticija[].saldoUkupno.{duguje, potrazuje, ukupniSaldo, ...}
//     duguje      = zaduženo (obračunate obveze)
//     potrazuje   = UPLAĆENO / odobreno  <-- "koliko je uplaćeno"
//     ukupniSaldo = duguje - potrazuje (negativno = preplata)
//   Ako se struktura promijeni, skripta pada na generičku heuristiku.
// =============================================================================
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, loadJson, toEur, fmtEur, HRK_PER_EUR, EURO_YEAR, saveJson } from "./lib.mjs";

const args = process.argv.slice(2);
const SCHEMA = args.includes("--schema");
const fieldIdx = args.indexOf("--field");
const FORCED_FIELD = fieldIdx !== -1 ? args[fieldIdx + 1] : null;

// ---- parsiranje iznosa ------------------------------------------------------
// "1.234,56" / "1234,56" / "1234.56" / 1234.56 -> 1234.56
function parseAmount(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^-?[\d.,\s]+$/.test(s) || !/\d/.test(s)) return null;
  let t = s.replace(/\s/g, "");
  const hasDot = t.includes("."), hasComma = t.includes(",");
  if (hasDot && hasComma) {
    t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (hasComma) {
    t = t.replace(",", ".");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const num = (v) => parseAmount(v) ?? 0;

// ---- poznata struktura: zbroj po particijama --------------------------------
function extractKnown(stanje) {
  const part = stanje?.podaci?.saldaParticija;
  if (!Array.isArray(part) || !part.length) return null;
  let duguje = 0, potrazuje = 0, saldo = 0, count = 0, has = false;
  for (const p of part) {
    const s = p?.saldoUkupno;
    if (s && typeof s === "object") {
      duguje += num(s.duguje);
      potrazuje += num(s.potrazuje);
      saldo += num(s.ukupniSaldo);
      has = true;
    }
    if (Array.isArray(p?.saldaIspostavaIVrstaPrihoda)) count += p.saldaIspostavaIVrstaPrihoda.length;
  }
  return has ? { duguje, potrazuje, saldo, count } : null;
}

// ---- generički fallback -----------------------------------------------------
function findRecords(obj) {
  let best = [];
  (function walk(o) {
    if (Array.isArray(o)) {
      if (o.length && o.every((x) => x && typeof x === "object" && !Array.isArray(x)) && o.length > best.length) best = o;
      o.forEach(walk);
    } else if (o && typeof o === "object") Object.values(o).forEach(walk);
  })(obj);
  return best;
}
function collectNumbers(obj, prefix = "", out = new Map()) {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") collectNumbers(v, path, out);
      else { const n = parseAmount(v); if (n != null) out.set(path, n); }
    }
  }
  return out;
}
function pickPaidField(paths) {
  if (FORCED_FIELD) return paths.find((p) => p === FORCED_FIELD || p.endsWith("." + FORCED_FIELD)) || FORCED_FIELD;
  // egzaktni nazivi imaju prednost (potraz prije "naplacen" da ne upadne nenaplaceneKamate)
  for (const name of ["potrazuje", "uplaceno", "uplata", "placeno"]) {
    const hit = paths.find((p) => p === name || p.endsWith("." + name));
    if (hit) return hit;
  }
  for (const re of [/uplac/i, /uplat/i, /potraz/i]) {
    const hit = paths.find((p) => re.test(p));
    if (hit) return hit;
  }
  return null;
}

// ---- godine -----------------------------------------------------------------
function listYears() {
  let files;
  try { files = readdirSync(DATA_DIR); }
  catch { console.error("Nema ./data. Prvo: node pkk-fetch.mjs"); process.exit(1); }
  return files.map((f) => /^stanje-(\d{4})\.json$/.exec(f)).filter(Boolean)
    .map((m) => +m[1]).sort((a, b) => a - b);
}

// =============================================================================
function main() {
  const years = listYears();
  if (!years.length) { console.error("Nema stanje-*.json. Prvo: node pkk-fetch.mjs"); process.exit(1); }

  if (SCHEMA) {
    for (const y of years) {
      const recs = findRecords(loadJson(`stanje-${y}.json`));
      if (recs.length) {
        console.log(`\nstanje-${y}.json — ${recs.length} stavki. Primjer:`);
        console.log(JSON.stringify(recs[0], null, 2));
        return;
      }
    }
    return;
  }

  const useGeneric = !!FORCED_FIELD;
  const data = years.map((y) => ({ year: y, stanje: loadJson(`stanje-${y}.json`) }));
  const known = useGeneric ? null : data.map((d) => extractKnown(d.stanje));
  const allKnown = known && known.every(Boolean);

  console.log("=".repeat(82));
  console.log(`PKK — akumulirana uplaćena javna davanja (${process.env.PKK_FIRMA || "firma"})`);
  console.log("=".repeat(82));
  console.log(`Godine:  ${years[0]}–${years[years.length - 1]}    Tečaj: 1 EUR = ${HRK_PER_EUR} HRK (< ${EURO_YEAR} = HRK)`);

  let rows;
  if (allKnown) {
    // ---- bogati prikaz iz poznate strukture: zaduženo + potražuje + saldo ----
    console.log(`Iz saldoUkupno: duguje=zaduženo, potrazuje=uplate+odobrenja, ukupniSaldo=duguje−potrazuje\n`);
    const W = [6, 7, 5, 15, 15, 15];
    const head = ["God.", "Stavki", "Val", "Zaduženo €", "Potražuje €", "Saldo €"];
    console.log(head.map((h, i) => i < 3 ? h.padEnd(W[i]) : h.padStart(W[i])).join(" "));
    console.log("-".repeat(W.reduce((a, b) => a + b, 0) + W.length - 1));
    let tDug = 0, tPot = 0, tSal = 0;
    rows = years.map((y, i) => {
      const k = known[i];
      const dugE = toEur(k.duguje, y), potE = toEur(k.potrazuje, y), salE = toEur(k.saldo, y);
      tDug += dugE; tPot += potE; tSal += salE;
      console.log([
        String(y).padEnd(W[0]),
        String(k.count).padEnd(W[1]),
        (y < EURO_YEAR ? "HRK" : "EUR").padEnd(W[2]),
        fmtEur(dugE).padStart(W[3]),
        fmtEur(potE).padStart(W[4]),
        fmtEur(salE).padStart(W[5]),
      ].join(" "));
      return { year: y, count: k.count, currency: y < EURO_YEAR ? "HRK" : "EUR",
        duguje_izvorno: k.duguje, potrazuje_izvorno: k.potrazuje, saldo_izvorno: k.saldo,
        duguje_eur: dugE, uplaceno_eur: potE, saldo_eur: salE };
    });
    console.log("-".repeat(W.reduce((a, b) => a + b, 0) + W.length - 1));
    console.log(["UKUPNO".padEnd(W[0] + W[1] + W[2] + 2), fmtEur(tDug).padStart(W[3]),
      fmtEur(tPot).padStart(W[4]), fmtEur(tSal).padStart(W[5])].join(" "));
    const saldoDanas = rows[rows.length - 1].saldo_eur;
    const truePaid = tDug - saldoDanas;
    console.log(`\n>>> UKUPNO ZADUŽENO (javna davanja) ${years[0]}–${years[years.length - 1]}: ${fmtEur(tDug)}`);
    console.log(`>>> STVARNO UPLAĆENO = zaduženo − saldo: ${fmtEur(truePaid)}`);
    console.log(`>>> Saldo danas (tekuća god. ${years[years.length - 1]}, − = preplata): ${fmtEur(saldoDanas)}`);
    console.log(`    NAPOMENA: Σ potražuje = ${fmtEur(tPot)} se NE koristi kao "uplaćeno" — uključuje`);
    console.log(`    prenesene pretplate koje se ponavljaju iz godine u godinu (dvostruko brojanje).`);

    const csv = ["godina,valuta,zaduzeno_izvorno,uplaceno_izvorno,saldo_izvorno,zaduzeno_eur,uplaceno_eur,saldo_eur",
      ...rows.map((r) => `${r.year},${r.currency},${r.duguje_izvorno.toFixed(2)},${r.potrazuje_izvorno.toFixed(2)},${r.saldo_izvorno.toFixed(2)},${r.duguje_eur.toFixed(2)},${r.uplaceno_eur.toFixed(2)},${r.saldo_eur.toFixed(2)}`),
      `UKUPNO,EUR,,,,${tDug.toFixed(2)},${tPot.toFixed(2)},${tSal.toFixed(2)}`].join("\n");
    writeFileSync(join(DATA_DIR, "uplaceno-po-godinama.csv"), csv);
    saveJson("rezultat.json", { stvarnoUplacenoEur: truePaid, ukupnoZaduzenoEur: tDug, saldoDanasEur: saldoDanas, sumaPotrazujeEur: tPot, rows });
    console.log("\nSpremljeno: data/uplaceno-po-godinama.csv  i  data/rezultat.json");
    return;
  }

  // ---- generički fallback (nepoznata struktura ili --field) ----------------
  const byYear = new Map(); const allPaths = new Set();
  for (const { year, stanje } of data) {
    const recs = findRecords(stanje); const sums = new Map();
    for (const r of recs) for (const [path, n] of collectNumbers(r)) { sums.set(path, (sums.get(path) || 0) + n); allPaths.add(path); }
    byYear.set(year, { count: recs.length, sums });
  }
  const paidField = pickPaidField([...allPaths]);
  console.log(`Polje "uplaćeno": ${paidField ?? "(nije pronađeno)"}\n`);
  if (!paidField) {
    console.log("Numerička polja:"); [...allPaths].sort().forEach((p) => console.log("  " + p));
    return;
  }
  let total = 0; const rows2 = [];
  for (const y of years) {
    const { count, sums } = byYear.get(y);
    const raw = sums.get(paidField) || 0, eur = toEur(raw, y); total += eur;
    rows2.push({ year: y, count, currency: y < EURO_YEAR ? "HRK" : "EUR", raw, eur });
    console.log(`${y}  ${(y < EURO_YEAR ? "HRK" : "EUR")}  izvorno=${raw.toFixed(2)}  EUR=${fmtEur(eur)}`);
  }
  console.log(`\n>>> Ukupno (${paidField}) ${years[0]}–${years[years.length - 1]}: ${fmtEur(total)}`);
}

main();

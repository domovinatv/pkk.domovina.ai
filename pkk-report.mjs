#!/usr/bin/env node
// =============================================================================
// pkk-report.mjs — agregira PKK po vrstama prihoda i generira HTML one-pager
//                  (report.html). PDF se renderira posebno (vidi make-pdf.sh).
// =============================================================================
import { readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, ROOT, loadJson, toEur, fmtEur, HRK_PER_EUR, EURO_YEAR } from "./lib.mjs";

const FIRMA = process.env.PKK_FIRMA || "Moja firma d.o.o.";

// ---- šifarnik: sifra -> puniNaziv -------------------------------------------
function loadCodebook() {
  const map = new Map();
  for (const file of ["pkk-dohvati-sifarnik-placanja.json", "pkk-dohvati-sifarnike.json"]) {
    if (!existsSync(join(DATA_DIR, file))) continue;
    const vp = loadJson(file)?.podaci?.vrstaPrihoda || [];
    for (const v of vp) {
      const sifra = String(v.sifra || "").trim();
      if (sifra && !map.has(sifra)) map.set(sifra, v.puniNaziv || v.naziv || sifra);
    }
  }
  return map;
}

function listYears() {
  return readdirSync(DATA_DIR)
    .map((f) => /^stanje-(\d{4})\.json$/.exec(f)).filter(Boolean)
    .map((m) => +m[1]).sort((a, b) => a - b);
}

const num = (v) => (Number.isFinite(+v) ? +v : 0);

// =============================================================================
const years = listYears();
if (!years.length) { console.error("Nema stanje-*.json. Prvo: node pkk-fetch.mjs"); process.exit(1); }
const codebook = loadCodebook();

const perYear = [];          // {year, currency, duguje, potrazuje, saldo} u EUR
const perCode = new Map();   // sifra -> {uplaceno, zaduzeno} u EUR
let tDug = 0, tPot = 0;

for (const y of years) {
  const j = loadJson(`stanje-${y}.json`);
  let dug = 0, pot = 0, sal = 0;
  for (const p of j?.podaci?.saldaParticija || []) {
    const s = p?.saldoUkupno;
    if (s) { dug += num(s.duguje); pot += num(s.potrazuje); sal += num(s.ukupniSaldo); }
    for (const r of p?.saldaIspostavaIVrstaPrihoda || []) {
      const code = String(r.vrstaPrihoda || "").trim();
      const e = perCode.get(code) || { uplaceno: 0, zaduzeno: 0 };
      e.uplaceno += toEur(num(r.potrazuje), y);
      e.zaduzeno += toEur(num(r.duguje), y);
      perCode.set(code, e);
    }
  }
  const dugE = toEur(dug, y), potE = toEur(pot, y), salE = toEur(sal, y);
  tDug += dugE; tPot += potE;
  perYear.push({ year: y, currency: y < EURO_YEAR ? "HRK" : "EUR", duguje: dugE, potrazuje: potE, saldo: salE });
}

// Razrada po vrsti temelji se na ZADUŽENJU (obračunate obveze) — to su stvarna
// javna davanja po vrsti. Strana "potrazuje" se NE koristi za zbrajanje jer
// uključuje prenesene pretplate iz ranijih godina (ista lova više puta).
const codes = [...perCode.entries()]
  .map(([sifra, v]) => ({ sifra, naziv: codebook.get(sifra) || "(nepoznato)", ...v }))
  .sort((a, b) => b.zaduzeno - a.zaduzeno);

const saldoDanas = perYear[perYear.length - 1].saldo; // tekuća knjig. godina
const truePaid = tDug - saldoDanas;                   // stvarno uplaćeno = zaduženo − saldo
const maxYear = Math.max(...perYear.map((r) => r.duguje));
const g = (n) => new Intl.NumberFormat("hr-HR", { maximumFractionDigits: 0 }).format(n);
const od = years[0], doG = years[years.length - 1];

// ---- HTML one-pager ---------------------------------------------------------
const html = `<!doctype html><html lang="hr"><head><meta charset="utf-8">
<title>Uplaćena javna davanja — ${FIRMA}</title>
<style>
  @page { size: A4; margin: 14mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1a2233; margin: 0; font-size: 11px; }
  .wrap { max-width: 182mm; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 3px solid #0b5; padding-bottom: 8px; }
  h1 { font-size: 19px; margin: 0; }
  .sub { color: #667; font-size: 11px; margin-top: 2px; }
  .firma { font-size: 13px; font-weight: 700; color: #0b5; }
  .kpis { display: flex; gap: 10px; margin: 14px 0; }
  .kpi { flex: 1; border: 1px solid #dde; border-radius: 8px; padding: 10px 12px; }
  .kpi.main { background: #0b5; color: #fff; border-color: #0b5; }
  .kpi .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .4px; opacity: .8; }
  .kpi .val { font-size: 21px; font-weight: 800; margin-top: 3px; }
  .kpi.main .val { font-size: 25px; }
  .kpi .note { font-size: 9.5px; opacity: .75; margin-top: 2px; }
  h2 { font-size: 12px; margin: 16px 0 6px; color: #334; border-bottom: 1px solid #e5e8ef; padding-bottom: 3px; }
  .cols { display: flex; gap: 16px; }
  .col { flex: 1; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 3px 4px; text-align: right; vertical-align: top; }
  th { font-size: 9px; text-transform: uppercase; color: #889; border-bottom: 1px solid #dde; }
  td.l, th.l { text-align: left; }
  td { border-bottom: 1px solid #f0f2f6; }
  .bar { height: 7px; background: #0b5; border-radius: 3px; }
  .bar.alt { background: #69c; }
  .barcell { width: 90px; }
  tfoot td { border-top: 2px solid #334; font-weight: 800; }
  footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #e5e8ef; color: #889; font-size: 9px; line-height: 1.5; }
  .naziv { white-space: normal; line-height: 1.3; padding-right: 8px; }
</style></head><body><div class="wrap">

<header>
  <div>
    <h1>Uplaćena javna davanja</h1>
    <div class="sub">Porezno-knjigovodstvena kartica (ePorezna) · razdoblje ${od}–${doG}</div>
  </div>
  <div class="firma">${FIRMA}</div>
</header>

<div class="kpis">
  <div class="kpi main"><div class="lbl">Plaćeno javnih davanja ${od}–${doG}</div><div class="val">${fmtEur(truePaid)}</div><div class="note">stvarno uplaćeno = zaduženo − saldo (fiskalna i parafiskalna)</div></div>
  <div class="kpi"><div class="lbl">Obračunato (zaduženo)</div><div class="val">${fmtEur(tDug)}</div><div class="note">sve obveze obračunate na PKK (strana „duguje")</div></div>
  <div class="kpi"><div class="lbl">Saldo na ${new Date().toLocaleDateString("hr-HR")}</div><div class="val">${fmtEur(saldoDanas)}</div><div class="note">knjig. godina ${doG}; − = preplata, + = dug</div></div>
</div>

<div class="cols">
  <div class="col">
    <h2>Obračunato (zaduženo) po godini — EUR</h2>
    <table>
      <thead><tr><th class="l">God.</th><th>Val.</th><th>Zaduženo</th><th class="l barcell"></th></tr></thead>
      <tbody>
      ${perYear.map((r) => `<tr>
        <td class="l">${r.year}</td><td>${r.currency}</td><td>${g(r.duguje)} €</td>
        <td class="l"><div class="bar" style="width:${Math.max(2, (r.duguje / maxYear) * 100)}%"></div></td></tr>`).join("")}
      </tbody>
      <tfoot><tr><td class="l">Ukupno</td><td></td><td>${g(tDug)} €</td><td></td></tr></tfoot>
    </table>
  </div>
  <div class="col">
    <h2>Obračunato (zaduženo) po vrsti prihoda — EUR, cijelo razdoblje</h2>
    <table>
      <thead><tr><th class="l">Vrsta prihoda</th><th>Šifra</th><th>Zaduženo</th><th>%</th></tr></thead>
      <tbody>
      ${codes.filter((c) => c.zaduzeno > 0).map((c) => `<tr>
        <td class="l naziv">${c.naziv}</td>
        <td>${c.sifra}</td><td>${g(c.zaduzeno)} €</td>
        <td>${((c.zaduzeno / tDug) * 100).toFixed(1)}%</td></tr>`).join("")}
      </tbody>
      <tfoot><tr><td class="l">Ukupno</td><td></td><td>${g(tDug)} €</td><td>100%</td></tr></tfoot>
    </table>
  </div>
</div>

<footer>
  Izvor: ePorezna · Uvid u PKK (pkk-dohvati-stanje), dokument UVIDI_PKK_PROFIL. Iznosi za godine prije ${EURO_YEAR}. preračunati iz HRK u EUR po fiksnom tečaju 1 EUR = ${HRK_PER_EUR} HRK.
  „Zaduženo" = obračunate obveze (strana „duguje") = stvarna javna davanja. „Plaćeno" = zaduženo − trenutni saldo (${fmtEur(tDug)} − (${fmtEur(saldoDanas)})). Budući da je račun praktički podmiren (saldo ${fmtEur(saldoDanas)}), plaćeno ≈ zaduženo. Napomena: kreditna strana „potražuje" (${fmtEur(tPot)}) NIJE korištena jer uključuje prenesene pretplate koje se ponavljaju iz godine u godinu (npr. ista preplata HGK od 59 € pojavljuje se 2023–2026), pa bi dvostruko brojala. ${doG} je nepotpuna godina (do datuma obračuna).
  Generirano ${new Date().toLocaleDateString("hr-HR")}. Informativni izračun, nije službeni dokument Porezne uprave.
</footer>

</div></body></html>`;

writeFileSync(join(ROOT, "report.html"), html);
console.log("✓ report.html");
console.log(`  Plaćeno ${od}–${doG}: ${fmtEur(truePaid)} (zaduženo ${fmtEur(tDug)}, saldo danas ${fmtEur(saldoDanas)})`);
console.log(`  Napomena: Σ potražuje = ${fmtEur(tPot)} (NE koristi se — dvostruko broji prenesene pretplate)`);
console.log(`  Vrsta prihoda: ${codes.filter((c) => c.zaduzeno > 0).length}`);

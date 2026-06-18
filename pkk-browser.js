// =============================================================================
// PKK one-pager — 100% U BROWSERU. Zalijepi u konzolu na stranici ePorezne.
// =============================================================================
// 1) Prijavi se i odi na: https://upo.porezna-uprava.hr/profil/uvid-u-pkk
// 2) F12 -> Console -> zalijepi CIJELI ovaj file -> Enter
// 3) Kad skripta zatraži, KLIKNI gumb „Pretraži" na stranici (jednom) — tako
//    uhvati pristupni token (x-redirect-state) iz tvoje žive sesije.
// 4) Otvori se report u novom prozoru (gumb „Spremi kao PDF") + download HTML/CSV.
//
// Sve ostaje u tvom browseru. Cookie sesije šalje se automatski (isti origin),
// token se hvata automatski — NE treba ručno kopirati ništa.
// =============================================================================
(async () => {
  // ---- podesivo --------------------------------------------------------------
  const FIRMA = "";                 // npr. "Moja firma d.o.o." (prazno = auto iz zaglavlja)
  const POCETNA_GODINA = 2016;      // godina osnutka
  const ZAVRSNA_GODINA = new Date().getFullYear();
  const REDIRECT_STATE = "";        // popuni SAMO ako dobiješ 401/403
  const DOKUMENT = "UVIDI_PKK_PROFIL";
  // ---------------------------------------------------------------------------

  const HRK_PER_EUR = 7.5345, EURO_GODINA = 2023;
  const toEur = (n, g) => (g < EURO_GODINA ? n / HRK_PER_EUR : n);
  const eur = (n) => new Intl.NumberFormat("hr-HR", { style: "currency", currency: "EUR" }).format(n);
  const g0 = (n) => new Intl.NumberFormat("hr-HR", { maximumFractionDigits: 0 }).format(n);
  // Robustno parsiranje: prihvaća broj (6269.31) i hrvatski string ("6.269,31").
  // ePorezna ovisno o Accept-Language vraća lokalizirane stringove s zarezom.
  const N = (v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (typeof v !== "string" || !/\d/.test(v)) return 0;
    let t = v.trim().replace(/\s/g, "");
    const dot = t.includes("."), comma = t.includes(",");
    if (dot && comma) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
    else if (comma) t = t.replace(",", ".");
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  };
  const pad2 = (n) => String(n).padStart(2, "0");
  const datum = (y) => { const d = new Date(); return y < d.getFullYear() ? `${y}-12-31` : `${y}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

  let redirectState = REDIRECT_STATE;
  const post = async (endpoint, body) => {
    const res = await fetch(`/api/v1/knjigovodstvo/${endpoint}`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", "X-Requested-With": "JavaScript", ...(redirectState ? { "x-redirect-state": redirectState } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}` + ([401, 403].includes(res.status) ? " — sesija je istekla, osvježi stranicu i prijavu" : ""));
    const j = await res.json();
    if (j && j.uspjesno === false) throw new Error((j.poruke || []).map((p) => p.opis).join(" ") || "uspjesno=false (nema podataka)");
    return j;
  };

  // ePorezna API traži header `x-redirect-state` koji SPA dodaje svakom zahtjevu
  // (nosi kontekst odabranog poreznog obveznika). Iz konzole ga nemamo, pa ga
  // uhvatimo iz prvog zahtjeva koji SPA pošalje (presreći i fetch i XHR).
  if (!redirectState) {
    window.__pkkRS = null;
    const origFetch = window.fetch;
    const origSet = XMLHttpRequest.prototype.setRequestHeader;
    window.fetch = function (u, opt) {
      try { const rs = new Headers(opt && opt.headers).get("x-redirect-state"); if (rs) window.__pkkRS = rs; } catch (e) {}
      return origFetch.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      if (String(k).toLowerCase() === "x-redirect-state" && v) window.__pkkRS = v;
      return origSet.apply(this, arguments);
    };
    console.log("%c👉 KLIKNI gumb „Pretraži\" na stranici (jednom) — hvatam pristupni token…", "color:#06c;font-weight:bold;font-size:13px");
    redirectState = await new Promise((resolve) => {
      let n = 0; const iv = setInterval(() => {
        if (window.__pkkRS) { clearInterval(iv); resolve(window.__pkkRS); }
        else if (++n > 120) { clearInterval(iv); resolve(""); } // ~60 s
      }, 500);
    });
    window.fetch = origFetch;
    XMLHttpRequest.prototype.setRequestHeader = origSet;
    if (redirectState) console.log("✓ Token uhvaćen — nastavljam dohvat.");
    else { console.error("✗ Nisam uhvatio token za 60 s. Pokreni skriptu ponovno pa klikni „Pretraži\", ili upiši REDIRECT_STATE na vrhu (DevTools → Network → bilo koji pkk- zahtjev → Headers → x-redirect-state)."); return; }
  }

  // ---- šifarnik (sifra -> puniNaziv) -----------------------------------------
  const codebook = new Map();
  try {
    for (const v of (await post("pkk-dohvati-sifarnik-placanja", { dokumentOznaka: DOKUMENT }))?.podaci?.vrstaPrihoda || [])
      codebook.set(String(v.sifra).trim(), v.puniNaziv || v.naziv);
  } catch (e) { console.warn("Šifarnik nije dohvaćen:", e.message); }

  // ---- dohvat po godinama ----------------------------------------------------
  const perYear = [], perCode = new Map();
  let tDug = 0, firmaNaziv = FIRMA;
  for (let y = POCETNA_GODINA; y <= ZAVRSNA_GODINA; y++) {
    try {
      const j = await post("pkk-dohvati-stanje", { dokumentOznaka: DOKUMENT, godina: String(y), datumObracuna: datum(y), vrstaPrihoda: [] });
      let dug = 0, pot = 0, sal = 0;
      for (const p of j?.podaci?.saldaParticija || []) {
        const s = p?.saldoUkupno; if (s) { dug += N(s.duguje); pot += N(s.potrazuje); sal += N(s.ukupniSaldo); }
        for (const r of p?.saldaIspostavaIVrstaPrihoda || []) {
          const c = String(r.vrstaPrihoda).trim(), e = perCode.get(c) || { zaduzeno: 0 };
          e.zaduzeno += toEur(N(r.duguje), y); perCode.set(c, e);
        }
      }
      tDug += toEur(dug, y);
      perYear.push({ year: y, currency: y < EURO_GODINA ? "HRK" : "EUR", duguje: toEur(dug, y), potrazuje: toEur(pot, y), saldo: toEur(sal, y) });
      console.log(`✓ ${y}: zaduženo ${eur(toEur(dug, y))}`);
    } catch (e) { console.warn(`✗ ${y}: ${e.message}`); }
  }
  if (!perYear.length) { console.error("Nije dohvaćena nijedna godina."); return; }

  // NAPOMENA: koristimo ZADUŽENO (duguje), ne POTRAŽUJE — potraživanje uključuje
  // prenesene pretplate koje se ponavljaju iz godine u godinu (dvostruko brojanje).
  const saldoDanas = perYear[perYear.length - 1].saldo;
  const truePaid = tDug - saldoDanas;
  const codes = [...perCode.entries()].map(([sifra, v]) => ({ sifra, naziv: codebook.get(sifra) || "(nepoznato)", ...v }))
    .filter((c) => c.zaduzeno > 0).sort((a, b) => b.zaduzeno - a.zaduzeno);
  const od = perYear[0].year, doG = perYear[perYear.length - 1].year;
  const maxY = Math.max(...perYear.map((r) => r.duguje));
  if (!firmaNaziv) firmaNaziv = "Vaša firma";
  const slug = (firmaNaziv.toLowerCase().normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")) || "pkk";

  // ---- HTML report -----------------------------------------------------------
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const html = `<!doctype html><html lang="hr"><head><meta charset="utf-8"><title>Javna davanja — ${esc(firmaNaziv)}</title><style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:-apple-system,Arial,sans-serif;color:#1a2233;font-size:11px;margin:0;padding:18px}
.wrap{max-width:182mm;margin:0 auto}.noprint{text-align:right;margin-bottom:10px}button{font-size:12px;padding:7px 14px;border:0;border-radius:6px;background:#0b5;color:#fff;cursor:pointer}
header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:3px solid #0b5;padding-bottom:8px}h1{font-size:19px;margin:0}.sub{color:#667;margin-top:2px}.firma{font-size:13px;font-weight:700;color:#0b5}
.kpis{display:flex;gap:10px;margin:14px 0}.kpi{flex:1;border:1px solid #dde;border-radius:8px;padding:10px 12px}.kpi.main{background:#0b5;color:#fff}.kpi .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.4px;opacity:.85}.kpi .val{font-size:21px;font-weight:800;margin-top:3px}.kpi.main .val{font-size:25px}.kpi .note{font-size:9.5px;opacity:.8;margin-top:2px}
h2{font-size:12px;margin:16px 0 6px;color:#334;border-bottom:1px solid #e5e8ef;padding-bottom:3px}.cols{display:flex;gap:16px}.col{flex:1}
table{width:100%;border-collapse:collapse}td,th{padding:3px 4px;text-align:right;vertical-align:top}td{border-bottom:1px solid #f0f2f6}th{font-size:9px;text-transform:uppercase;color:#889;border-bottom:1px solid #dde}td.l,th.l{text-align:left}.naziv{white-space:normal;line-height:1.3;padding-right:8px}.bar{height:7px;background:#0b5;border-radius:3px}tfoot td{border-top:2px solid #334;font-weight:800}
footer{margin-top:14px;padding-top:8px;border-top:1px solid #e5e8ef;color:#889;font-size:9px;line-height:1.5}@media print{.noprint{display:none}body{padding:0}}
</style></head><body><div class="wrap">
<div class="noprint"><button onclick="window.print()">🖨️ Spremi kao PDF</button></div>
<header><div><h1>Uplaćena javna davanja</h1><div class="sub">Porezno-knjigovodstvena kartica (ePorezna) · razdoblje ${od}–${doG}</div></div><div class="firma">${esc(firmaNaziv)}</div></header>
<div class="kpis">
<div class="kpi main"><div class="lbl">Plaćeno javnih davanja ${od}–${doG}</div><div class="val">${eur(truePaid)}</div><div class="note">stvarno uplaćeno = zaduženo − saldo</div></div>
<div class="kpi"><div class="lbl">Obračunato (zaduženo)</div><div class="val">${eur(tDug)}</div><div class="note">sve obveze na PKK (strana „duguje")</div></div>
<div class="kpi"><div class="lbl">Saldo na ${new Date().toLocaleDateString("hr-HR")}</div><div class="val">${eur(saldoDanas)}</div><div class="note">knjig. god. ${doG}; − = preplata</div></div>
</div>
<div class="cols">
<div class="col"><h2>Obračunato (zaduženo) po godini — EUR</h2><table><thead><tr><th class="l">God.</th><th>Val.</th><th>Zaduženo</th><th class="l" style="width:90px"></th></tr></thead><tbody>
${perYear.map((r) => `<tr><td class="l">${r.year}</td><td>${r.currency}</td><td>${g0(r.duguje)} €</td><td class="l"><div class="bar" style="width:${Math.max(2, (r.duguje / maxY) * 100)}%"></div></td></tr>`).join("")}
</tbody><tfoot><tr><td class="l">Ukupno</td><td></td><td>${g0(tDug)} €</td><td></td></tr></tfoot></table></div>
<div class="col"><h2>Obračunato (zaduženo) po vrsti prihoda — EUR</h2><table><thead><tr><th class="l">Vrsta prihoda</th><th>Šifra</th><th>Zaduženo</th><th>%</th></tr></thead><tbody>
${codes.map((c) => `<tr><td class="l naziv">${esc(c.naziv)}</td><td>${c.sifra}</td><td>${g0(c.zaduzeno)} €</td><td>${((c.zaduzeno / tDug) * 100).toFixed(1)}%</td></tr>`).join("")}
</tbody><tfoot><tr><td class="l">Ukupno</td><td></td><td>${g0(tDug)} €</td><td>100%</td></tr></tfoot></table></div>
</div>
<footer>Izvor: ePorezna · Uvid u PKK (pkk-dohvati-stanje). Iznosi prije ${EURO_GODINA}. preračunati iz HRK po fiksnom tečaju 1 EUR = ${HRK_PER_EUR} HRK. „Zaduženo" = obračunate obveze = stvarna javna davanja; „plaćeno" = zaduženo − trenutni saldo. Kreditna strana „potražuje" se ne zbraja jer uključuje prenesene pretplate (dvostruko bi brojala). ${doG} je nepotpuna godina. Generirano ${new Date().toLocaleDateString("hr-HR")}. Informativno, nije službeni dokument.</footer>
</div></body></html>`;

  // ---- download helper -------------------------------------------------------
  const download = (name, content, type) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  };
  const csv = ["godina,valuta,zaduzeno_eur,saldo_eur",
    ...perYear.map((r) => `${r.year},${r.currency},${r.duguje.toFixed(2)},${r.saldo.toFixed(2)}`),
    `UKUPNO,EUR,${tDug.toFixed(2)},`].join("\n");

  console.table(perYear.map((r) => ({ godina: r.year, valuta: r.currency, zaduzeno_EUR: +r.duguje.toFixed(2), saldo_EUR: +r.saldo.toFixed(2) })));
  console.log(`%c>>> Plaćeno javnih davanja ${od}–${doG}: ${eur(truePaid)} (zaduženo ${eur(tDug)}, saldo ${eur(saldoDanas)})`, "font-size:14px;font-weight:bold;color:#0a0");

  // otvori report u novom prozoru; ako pop-up blokiran, ponudi download
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
  else { console.warn("Pop-up blokiran — preuzimam HTML."); download(`${slug}-javna-davanja.html`, html, "text/html"); }
  download(`${slug}-javna-davanja.csv`, csv, "text/csv");
  window.__pkk = { perYear, codes, tDug, truePaid, saldoDanas, html };
  console.log("Podaci u window.__pkk; HTML i CSV preuzeti.");
})();

# PKK izvještaj — koliko je tvoja firma platila javnih davanja

Izračunaj **koliko je tvoja firma uplatila javnih davanja** (poreza, doprinosa,
članarina…) od osnutka do danas, iz **ePorezne (Uvid u PKK)** — s ispravnim
preračunom kuna → euro i lijepim **PDF one-pagerom**.

Sve se izvršava **lokalno / u tvom browseru**. Nijedan podatak ne odlazi na
vanjski server.

> Tečaj: **1 EUR = 7,53450 HRK** (neopozivi fiksni tečaj, euro od 1.1.2023.).
> Iznosi za godine prije 2023. automatski se preračunavaju iz HRK u EUR.

---

## Opcija A — u browseru (preporuka, bez instalacije)

Najjednostavnije: pokreni u konzoli na stranici ePorezne. Kolačić prijave šalje
se automatski (isti origin), pa **ne treba kopirati nikakav token**.

1. Prijavi se: **https://upo.porezna-uprava.hr/profil/uvid-u-pkk** (NIAS).
2. Pritisni **F12** → tab **Console**.
3. Otvori [`pkk-browser.js`](./pkk-browser.js), kopiraj **cijeli** sadržaj,
   zalijepi u konzolu, **Enter**.
4. Otvori se report u novom prozoru → gumb **„Spremi kao PDF"**. Usput se
   preuzmu i HTML i CSV.

Naziv firme i raspon godina podesi na vrhu skripte (`FIRMA`, `POCETNA_GODINA`).
Kod greške HTTP 401/403 vidi [Često postavljana pitanja](#cesto).

> Zašto baš konzola, a ne web-stranica? Vanjska stranica ne može dohvatiti PKK
> zbog CORS-a i cross-site kolačića — to je sigurnosna granica browsera. Skripta
> u konzoli radi jer se izvršava na samoj ePorezna domeni.

---

## Opcija B — Node CLI (za napredne: sirovi JSON, batch, git)

Sprema sirove odgovore i radi analizu offline. Traži Node.js 18+ (bez ovisnosti).

```bash
cp .env.example .env        # 1) popuni PKK_SESSION + PKK_REDIRECT_STATE (vidi .env.example)
node pkk-fetch.mjs          # 2) povuci sve godine -> data/stanje-*.json
node pkk-analyze.mjs        # 3) tablica + CSV (data/uplaceno-po-godinama.csv)
./make-pdf.sh               # 4) PDF one-pager (javna-davanja.pdf)
```

`PKK_SESSION` i `PKK_REDIRECT_STATE` dohvatiš iz DevTools → Network →
`pkk-dohvati-stanje` → Copy as cURL (detalji u `.env.example`).

---

## Kako se računa

Endpoint `pkk-dohvati-stanje` vraća **saldo** PKK kartice po knjigovodstvenoj
godini: `podaci.saldaParticija[].saldoUkupno`:

- `duguje` = **zaduženo** (obračunate obveze) = stvarna javna davanja
- `potrazuje` = uplate + odobrenja (kreditna strana)
- `ukupniSaldo` = duguje − potrazuje (− = preplata)

**Headline = „stvarno plaćeno" = Σ zaduženo − trenutni saldo.** Pošto je račun u
pravilu podmiren (saldo ≈ 0), plaćeno ≈ zaduženo.

> ⚠️ Ne zbrajamo `potrazuje` kao „uplaćeno": ono uključuje **prenesene pretplate**
> koje se ponavljaju iz godine u godinu (ista preplata vidljiva u više godina), pa
> bi dvostruko brojalo. Razrada po vrsti prihoda temelji se na **zaduženju**.

Razrada po vrsti prihoda koristi šifarnik `pkk-dohvati-sifarnik-placanja`
(šifra → puni naziv).

<a name="cesto"></a>
## Često postavljana pitanja

**HTTP 401 / 403?** Sesija je istekla ili portal traži `x-redirect-state`.
- Browser: kopiraj header `x-redirect-state` iz Network taba (bilo koji `pkk-`
  zahtjev → Headers) i upiši u `REDIRECT_STATE` na vrhu `pkk-browser.js`.
- Node: osvježi `PKK_SESSION` i `PKK_REDIRECT_STATE` u `.env`.

**Pop-up blokiran?** Skripta tada preuzme HTML report — otvori ga i Cmd/Ctrl+P → Spremi kao PDF.

**Je li sigurno?** Skripte su read-only (samo dohvaćaju). Sve ostaje lokalno;
ništa se ne šalje trećoj strani. Pregledaj kod prije pokretanja.

## Privatnost

`.env`, `data/` i generirani reporti su u `.gitignore` i ne idu u repozitorij.
Ne dijeli svoj `token-handler.session` — to je tvoja aktivna sesija.

## Licenca

MIT — vidi [LICENSE](./LICENSE). Informativni alat; nije službeni dokument
Porezne uprave.

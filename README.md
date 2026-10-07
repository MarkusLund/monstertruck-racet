# Monstertruck-racet

3D monstertruck-racing for to spillere på delt skjerm, litt som første Mario Kart. Laget med [three.js](https://threejs.org/) og Gamepad API. Kjører i nettleseren på macOS (Chrome eller Safari).

## Kom i gang

```bash
npm install
npm start          # starter utviklingsserveren og åpner spillet i nettleseren
```

Du kan også bygge en statisk versjon med `npm run build` (legges i `dist/`) og åpne den med `npm run preview`.

## Kontroller (kun gass og sving)

|        | DualSense                      | Spiller 1 (tastatur) | Spiller 2 (tastatur) |
|--------|--------------------------------|----------------------|----------------------|
| Gass   | R2                             | W                    | ↑                    |
| Sving  | Venstre stikke (eller d-pad)   | A / D                | ← / →                |
| Start  | ✕ / Options                    | Enter / Mellomrom    | Enter / Mellomrom    |

- Koble DualSense-kontrollerne til Macen via Bluetooth. Nettlesere viser ikke kontrollere før du har trykket en knapp på dem mens spillet er åpent. Den første kontrolleren blir spiller 1, den andre spiller 2.
- Tastatur og kontroller kan blandes fritt. `Esc` går tilbake til startskjermen.

## Spillet

- Tre runder på en **tilfeldig generert bane** (ny for hvert løp). Først i mål vinner.
- **Delt skjerm** med kamera skrått ovenfra og bak trucken. Skygger, teksturer og lys.
- **Ramper** gir hopp. Hopper du over motstanderen, kolliderer dere ikke.
- **Kollisjon** mellom trucker (de dytter hverandre) og barrierer langs banen. Gress bremser.
- **Mynter** gir bedre akselerasjon (+3 % per mynt, opptil +60 %).
- **Slipstream:** kjører du tett bak den andre, får du fartsbonus.
- **Strikk:** den som ligger langt bak får litt ekstra fart og akselerasjon.
- **Power-ups** fra `?`-boksene (virker automatisk, ingen ekstra knapp). Den som ligger bak får bedre ting enn lederen:
  - Turbo (alle), skjold (kun leder)
  - Rakett som treffer lederen og spinner ham rundt (kun den bakerste)
  - Veisperre som legges ut foran lederen over hele asfalten, så han må ta omveien i gresset (kun den bakerste). Skjold knuser veisperren.

## Tester

```bash
npm test
```

Playwright-testene simulerer to DualSense-kontrollere (mocket Gamepad API) og tastaturet. De dekker styring, runder, mynter, slipstream, strikk, power-ups, veisperrer, kollisjon, ramper, tilfeldige baner og at et helt løp kan kjøres til mål. Headless Chromium rendrer med programvare og er tregt, men testene styrer tiden selv (`?manual=1`).

## Struktur

- `src/game.js`: spilltilstand, løp, mynter, power-ups, slipstream/strikk, kollisjon
- `src/truck.js`: truckfysikk (gass, sving, hopp, effekter)
- `src/track.js`: tilfeldig banegenerator, ramper, mynt- og boksplassering
- `src/input.js`: tastatur og kontrollere
- `src/render.js`: three.js-scene, teksturer, skygger, delt skjerm
- `src/sound.js`: syntetiserte lyder og motorbrumming

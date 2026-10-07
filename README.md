# Monstertruck-racet

2D monstertruck-racing for to spillere på samme skjerm. Laget med HTML5 Canvas, [planck.js](https://piqnt.com/planck.js/) (Box2D-fysikk) og Gamepad API. Kjører i nettleseren på macOS (Chrome eller Safari).

## Kom i gang

```bash
npm install
npm start          # starter utviklingsserveren og åpner spillet i nettleseren
```

Du kan også bygge en statisk versjon med `npm run build` (legges i `dist/`) og åpne den med `npm run preview`.

## Kontroller

|            | DualSense | Spiller 1 (tastatur) | Spiller 2 (tastatur) |
|------------|-----------|----------------------|----------------------|
| Gass       | R2        | D                    | →                    |
| Revers     | L2        | A                    | ←                    |
| Hopp       | ✕         | W                    | ↑                    |
| Start      | ✕ / Options | Enter / Mellomrom  | Enter / Mellomrom    |

- Koble DualSense-kontrollerne til Macen via Bluetooth (hold PS + Create til lyset blinker, velg den under Bluetooth-innstillinger).
- Nettlesere viser ikke kontrollere før du har trykket en knapp på dem mens spillet er åpent. Den første kontrolleren som dukker opp blir spiller 1, den andre spiller 2.
- Tastatur og kontroller kan blandes fritt.
- Gass og revers i lufta vipper trucken (som i Hill Climb Racing). Revers mens du kjører fremover bremser.
- `Esc` går tilbake til startskjermen.

## Tester

```bash
npm test
```

Playwright-testene simulerer to DualSense-kontrollere (mocket Gamepad API) og tastaturet. De sjekker blant annet start fra startskjermen, at hver spiller bare styrer sin egen truck, blandet tastatur/kontroller, hopp, hull og respawn, mynter, kamerazoom, at UI-et ikke skalerer, og at et helt løp kan kjøres til mål.

## Struktur

- `src/game.js` – spilltilstand, løp, mynter, mål, respawn
- `src/truck.js` – truckfysikk (hjul med fjæring, motor, hopp, luftkontroll)
- `src/track.js` – banen (ramper, hopp, bakker, hull) og myntplassering
- `src/input.js` – tastatur og kontrollere
- `src/camera.js` – felles kamera som zoomer ut
- `src/render.js` – tegning

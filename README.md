# Monstertruck-racet

3D monstertruck-racing for 1–4 spillere (delt skjerm og/eller flere Mac-er), litt som første Mario Kart. Laget med [three.js](https://threejs.org/) og Gamepad API. Kjører i nettleseren på macOS (Chrome eller Safari).

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

## Flerspiller (opptil 4 spillere på tvers av Mac-er)

Én Mac er **vert** og kjører hele spillet. De andre åpner bare en nettadresse i nettleseren, og trenger ikke installere noe.

1. På vertsmaskinen: `npm start`. Spillet åpner på `http://localhost:5173`. Maskinen som åpner `localhost` er alltid verten.
2. Startskjermen viser adressene andre kan bruke (samme nett, f.eks. `http://192.168.1.23:5173`). Del den med kollegaene.
3. Hver fjernspiller åpner adressen og får en farge (rød, blå, grønn, gul). Styring: `W A D`, piltaster eller kontroller (R2 og venstre stikke).
4. Verten starter løpet med `Enter`. Verten spiller selv som spiller 1, og `P` slår lokal spiller 2 av og på (to på samme tastatur). Maks 4 trucker totalt.
5. Alle ser sin egen truck i egen nettleser. Verten ser alle spillere på delt skjerm (1–4 ruter).

Hvis wifi-et har **klientisolering** (enheter kan ikke snakke sammen, vanlig på gjestenett og noen kontornett), når ikke de andre adressen over. Da kan verten åpne en tunnel med f.eks. `ngrok http 5173`. Adressen den gir (`https://….ngrok-free.app`) vises også på startskjermen, og alle kan åpne den. Trafikken går da via internett (ca. 20–60 ms ekstra).

Slik fungerer det: fjernspillere sender bare gass og sving til verten via en liten WebSocket-relay som ligger i Vite-serveren (`server/relay.js`). Verten simulerer alt og sender 30 øyeblikksbilder i sekundet tilbake. Banen lages av et frø, så alle får samme bane. Bruk `?room=navn` i adressen hvis flere grupper deler samme server.

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
- `src/render.js`: three.js-scene, teksturer, skygger, delt skjerm (1–4 ruter)
- `src/countdown.js`: 3D-tall for nedtellingen
- `src/net.js`: WebSocket-klient og glatting av øyeblikksbilder
- `server/relay.js`: relay for flerspiller (Vite-plugin)
- `src/sound.js`: syntetiserte lyder og motorbrumming

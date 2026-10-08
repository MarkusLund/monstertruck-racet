# Monstertruck-racet

3D monstertruck-racing for 1–4 spillere (delt skjerm og/eller flere Mac-er), litt som første Mario Kart. Laget med [three.js](https://threejs.org/) og Gamepad API. Kjører i nettleseren på macOS (Chrome eller Safari).

**Spill nå:** DEMO_URL

- Tilfeldig generert bane for hvert løp, med bakker, ramper, fjord og fjell
- 1–4 spillere på delt skjerm, eller flere maskiner via nettleseren (Cloudflare Workers eller lokal relay)
- Tastatur, PS5 DualSense og Nintendo Switch 2-kontrollere (også én Joy-Con 2 per spiller), med vibrasjon
- Power-ups, drift-boost, AI-motstandere og tilskuermodus
- Syntetisert motorlyd og musikk (Web Audio, ingen lydfiler)
- Ingen byggetrinn utover Vite, ren JavaScript og en deterministisk simulering som deles mellom nettleser og server

## Kom i gang

```bash
npm install
npm start          # starter utviklingsserveren og åpner spillet i nettleseren
```

Du kan også bygge en statisk versjon med `npm run build` (legges i `dist/`) og åpne den med `npm run preview`.

## Kontroller (kun gass og sving)

|        | DualSense                      | Spiller 1 (tastatur) | Spiller 2 (tastatur) |
|--------|--------------------------------|----------------------|----------------------|
| Gass   | R2                             | S                    | høyre ⌥              |
| Sving  | Venstre stikke (eller d-pad)   | 1 / 3                | ← / →                |
| Rygg   | L2                             | 2                    | ↓                    |
| Hopp   | □                              | A                    | høyre ⌘              |
| Start  | ✕ / Options                    | Enter / Mellomrom    | Enter / Mellomrom    |

- Koble DualSense-kontrollerne til Macen via Bluetooth. Nettlesere viser ikke kontrollere før du har trykket en knapp på dem mens spillet er åpent. Den første kontrolleren blir spiller 1, den andre spiller 2.
### Nintendo Switch 2-kontrollere på Mac

Spillet støtter opptil **4 kontrollere samtidig, én per spiller** (PS5 DualSense og Switch 2 kan blandes). Spiller 1–2 kan også bruke tastatur. Spiller 3–4 er kun kontrollere og blir med automatisk når de kobles til.

Macen ser ikke Switch 2-kontrollere som spillkontrollere av seg selv. Du trenger den gratis menylinjeappen [switch2mac](https://github.com/Peterksharma/switch2mac) («Finally the Controller Works»), som gjør dem om til virtuelle HID-gamepads. Støttet: Pro Controller 2, Joy-Con 2 og NSO GameCube-kontrolleren. Krever macOS 15 (Sequoia) eller nyere på Apple Silicon.

1. Last ned og installer switch2mac (se releases i GitHub-repoet) i Programmer-mappen, og start den. Den ligger i menylinjen.
2. Gi appen Bluetooth-tilgang når macOS spør. Det er den eneste tillatelsen den trenger.
3. **Hold Sync-knappen** på kontrolleren (ved USB-C-porten) til spillerlysene begynner å sveipe. Kontrolleren kobles til appen og ikke via Bluetooth-innstillingene i macOS.
4. Gjenta for hver kontroller (opptil 4). Etter første paring holder det å trykke en knapp for å koble til igjen.
5. Åpne spillet og **trykk en knapp** på hver kontroller. Nettlesere viser ikke kontrollere før de er rørt. Startskjermen viser «✓ Switch 2 tilkoblet» per spiller. Den første kontrolleren blir spiller 1, den neste spiller 2, og så videre.

Styring på Switch 2: **ZR** gass, **ZL** rygg/brems, **Y** hopp (knappen til venstre), **venstre stikke** eller d-pad for sving, **A** eller **+** for å starte, og d-pad opp/ned og venstre/høyre i menyen for AI-valg.

**Én Joy-Con 2 per spiller (UDP-bro).** switch2mac trenger Apples HID-entitlement for å lage virtuelle gamepader, og uten det ser ikke nettleseren kontrollerne. Da leser dev-serveren (`npm start`, kun localhost) switch2macs UDP-strøm på 127.0.0.1:24800–24803 og sender den videre til spillet (`server/joycon.js`, `src/joycon.js`). Hver Joy-Con holdes sidelengs og blir én spiller, som i Mario Kart: stikken styrer, knappen til høyre gasser, SL eller knappen nedenfor bremser/rygger, SR eller knappene oppe og til venstre hopper, +/− bekrefter. `?jcflip=1` snur oppsettet. Vibrasjon (treff, støt, landing, power-ups, mål) sendes tilbake til kontrolleren, og virker også på DualSense. Broen finnes ikke i Cloudflare-utgaven.

Feilsøking: kontrolleren kobler seg av etter noen sekunder hvis switch2mac ikke kjører. Vises den ikke i spillet, trykk en knapp på den med spillfanen i fokus, og sjekk at den står som tilkoblet i switch2mac. Åpne `?debug` hvis knappene virker feil.

Merk: Mappingen for Switch 2 er laget etter standard Gamepad-mapping, med en reserve for Nintendos rå HID-rekkefølge (A = knapp 1, hat-bryter som akse 9) hvis nettleseren ikke gjenkjenner enheten. Den er testet med mocket Gamepad API, ikke med fysisk kontroller.

- Tastatur og kontroller kan blandes fritt. `Esc` går tilbake til startskjermen. `M` slår musikken av og på (huskes i nettleseren).

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
3. Hver fjernspiller åpner adressen og får en farge (rød, blå, grønn, gul). Styring: `1 2 3` (venstre/rygge/høyre) + `S` gass + `A` hopp, piltaster + høyre ⌥ (gass) + høyre ⌘ (hopp), eller kontroller (R2 og venstre stikke).
4. Verten starter løpet med `Enter`. Verten spiller selv som spiller 1, og `P` slår lokal spiller 2 av og på (to på samme tastatur). Maks 4 trucker totalt.
5. Alle ser sin egen truck i egen nettleser. Verten ser alle spillere på delt skjerm (1–4 ruter), med minikart, runder igjen og stilling i midten.
6. **Tilskuermodus:** kobler noen til midt i et løp (eller løpet er fullt), ser de alle truckene på delt skjerm med minikart og stilling, og blir med i neste løp. Legg til `?watch` i adressen for en ren tilskuerskjerm (f.eks. en TV) som aldri tar en plass i løpet.

Hvis wifi-et har **klientisolering** (enheter kan ikke snakke sammen, vanlig på gjestenett og noen kontornett), når ikke de andre adressen over. Da kan verten åpne en tunnel med f.eks. `ngrok http 5173`. Adressen den gir (`https://….ngrok-free.app`) vises også på startskjermen, og alle kan åpne den. Trafikken går da via internett (ca. 20–60 ms ekstra).

Selve spilltrafikken (input og øyeblikksbilder) forsøker å gå **direkte mellom nettleserne** over en WebRTC-datakanal (UDP-lignende, STUN fra Cloudflare/Google). Tunnelen brukes da bare til oppkoblingen, så lagget blir omtrent som på lokalt nett. Hvis den direkte koblingen ikke lar seg opprette (streng brannmur/NAT), brukes tunnelen som før. Alternativ til ngrok: `npm run tunnel` (Cloudflare; installer med `brew install cloudflared`). Adressen vises på startskjermen.

Slik fungerer det: fjernspillere sender bare gass og sving til verten via en liten WebSocket-relay som ligger i Vite-serveren (`server/relay.js`). Verten simulerer alt og sender 30 øyeblikksbilder i sekundet tilbake. Banen lages av et frø, så alle får samme bane. Bruk `?room=navn` i adressen hvis flere grupper deler samme server.

## Hosting på Cloudflare (ingen vert nødvendig)

`server/worker.js` er en Cloudflare Worker med ett Durable Object per rom (`?room=navn`) som kjører hele simuleringen. Alle spillerne er vanlige klienter, og den som trykker `Enter` starter løpet. Legg til `?restart` i adressen for å nullstille spillet i rommet (alle sendes tilbake til lobbyen).

```bash
npm run deploy     # bygger og deployer med wrangler
npm run cf:dev     # kjører det samme lokalt på http://localhost:8787 (bruk ?role=client, ellers tror localhost at den er vert)
```

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
- `src/racecenter.js`: tilskuerpanelet (minikart, runder igjen, stilling)
- `src/countdown.js`: 3D-tall for nedtellingen
- `src/net.js`: WebSocket-klient og glatting av øyeblikksbilder
- `server/relay.js`: relay for flerspiller (Vite-plugin)
- `src/sound.js`: lydmiksen, effekter, plassering (avstand og retning fra hver spillers truck) og styring av musikken
- `src/engine-sound.js`: motorlyd (V8 bygget av enkelttenninger, automatgir, last, eksosresonanser)
- `src/music.js`: prosedyremusikk (ny låt for hver bane, opptrapping på siste runde, fanfare i mål)
- `server/worker.js`: Cloudflare Worker med ett Durable Object per rom som kjører simuleringen
- `server/joycon.js`, `src/joycon.js`, `src/rumble.js`: UDP-bro for Joy-Con 2 og vibrasjon

## Lisens

[MIT](LICENSE)

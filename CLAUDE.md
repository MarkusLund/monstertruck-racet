# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Monstertruck-racet: 3D-racing i nettleseren (three.js, Gamepad API) for 1–4 spillere på delt skjerm og/eller flere maskiner. Ren JavaScript (ES-moduler), ingen TypeScript, ingen linter og ingen byggetrinn utover Vite. UI-tekst, kodekommentarer, testnavn og commit-meldinger skrives på norsk (en test i `game.spec.js` sjekker at all synlig tekst er norsk).

## Kommandoer

```bash
npm start                 # Vite-utviklingsserver (port 5173) med flerspiller-relay; localhost blir vert
npm run build             # statisk bygg til dist/
npm test                  # alle Playwright-tester
npx playwright test tests/game.spec.js            # én fil
npx playwright test tests/game.spec.js -g "mynter"       # tester med navn som matcher
TEST_SEED=3 npx playwright test tests/terrain.spec.js    # annen bane (standard-frø er 7)
npm run cf:dev            # bygg + wrangler dev på :8787 (åpne med ?role=client, ellers blir localhost vert)
npm run deploy            # bygg + deploy til Cloudflare
npm run tunnel            # cloudflared-tunnel mot :5173 (adressen vises på startskjermen)
```

Playwright starter selv en egen Vite på port 5199 (`reuseExistingServer`) og bruker `channel: 'chrome'`, så Google Chrome må være installert. Headless Chromium rendrer med programvare og er tregt; derfor styrer testene tiden selv.

## Arkitektur

### Simuleringen er ren og delt
`src/game.js` (`Game`) og det den importerer (`truck.js`, `track.js`, `terrain.js`, `fences.js`, `pads.js`, `powerups.js`) er ren spillogikk uten DOM eller three.js. Den samme koden kjøres både i nettleseren (`src/main.js`) og i Cloudflare-workeren (`server/worker.js`). Ikke importer three.js, `window` eller DOM i disse filene. Alt som er visuelt ligger i `render.js`, `scenery.js`, `fencemesh.js`, `fx.js`, `countdown.js` og `camera.js` (f.eks. `fences.js` = kollisjonslogikk, `fencemesh.js` = geometri). Lyden ligger i `sound.js`, `engine-sound.js` og `music.js`.

- Fast tidssteg `DT = 1/60`. `game.step(inputs)` tar én input per truck (`{ throttle, steer, brake, jump }`).
- Tilstander: `menu` → `countdown` → `racing` → `finished`.
- Simuleringen legger hendelser i `game.events` (lyd/effekter). Kalleren tømmer listen etter hvert steg og sender dem videre i øyeblikksbildet (`s.ev`).

### Determinisme fra ett frø
Bane, terreng, gjerder og mynter genereres fra `game.seed` med `mulberry(seed)`. Klienter mottar bare frøet og bygger identisk bane selv (`applySnapshot` kaller `newRace(sn.seed)` når frøet endres). Ny tilfeldighet i banegenereringen må bruke den seedede generatoren som sendes inn, aldri `Math.random`. `terrain.js` har modulnivå-tilstand (`active`) som settes av `setTerrain`; `groundHeight` m.fl. leser fra den.

### Nettverk: to servermodi, samme protokoll
1. **Vite-relay** (`server/relay.js`, Vite-plugin): «dum» videresending per rom. Én nettleser er vert (localhost, eller `?role=host`), kjører simuleringen i `main.js` (`simStep`, `hostMessage`) og sender øyeblikksbilder. Serveren har også `/api/info` (LAN- og tunneladresser).
2. **Cloudflare** (`server/worker.js`): ett Durable Object (`GameRoom`) per rom kjører simuleringen selv. Alle nettlesere er klienter. Spillere identifiseres med en fast `pid` fra localStorage, så en ny innlasting gir tilbake samme truck.

Klientsiden (`clientMessage`/`clientStep` i `main.js`) er den samme i begge modi. Meldingstypene (`hello`, `host`, `hostgone`, `peer`, `lobby`, `assign`, `full`, `snap`, `in`, `watch`, `start`, `restart`, `rtc`, `ai`, `ready`, `go`) må holdes i synk mellom `main.js`, `relay.js` og `worker.js` når protokollen endres.

`src/net.js`: WebSocket for lobby og signalering, pluss forsøk på direkte WebRTC-datakanal (uordnet, uten gjensending) for `snap` og `in`. Faller tilbake til WebSocket. Øyeblikksbilder har løpenummer `q`, og gamle bilder kastes.

Cloudflare-lobbyen (kun `worker.js`; relayen/verten støtter den ikke, og klienten faller tilbake til gammel `start`-oppførsel når `lobby` mangler `rdy`): `ready` (klient → server) veksler spillerens klar-markering (Enter/kontroller-bekreft), og løpet starter når alle ikke-tilskuere er klare (alene: umiddelbart). `go` («start nå», tasten `S`) tvinger start. `lobby` har feltet `rdy` (0/1 per spiller, samme rekkefølge som `you`). `start` brukes fortsatt for «finished → nytt løp». En spiller med `pid` som kobler til mens et løp pågår overtar siste AI-truck (`assign` + `lobby`); finnes ingen, ser hen på som før.

### Joy-Con 2 via UDP-bro
`server/joycon.js` (Vite-plugin, bare dev) leser UDP fra switch2mac («Finally the Controller Works») på 127.0.0.1:24800–24803 og sender tilstanden over WebSocket `/joycon` (kun loopback). `src/joycon.js` (`JoyconBridge`, kun på localhost uten `?manual`) gjør hver kontroller om til et Gamepad-lignende objekt (indeks 100+plass, `mapping: 'standard'`) som `Input.poll` blander inn med `navigator.getGamepads()`. Brukes når appen ikke kan lage virtuelle gamepader (mangler Apples HID-entitlement, se issue #3 hos switch2mac). Enkelt Joy-Con holdt sidelengs: stikken styrer, SR eller knappen til høyre = gass, SL eller knappen nedenfor = brems/rygg, knappene oppe og til venstre eller L/ZL/R/ZR = hopp, +/− = bekreft (venstre Joy-Con er rotert mot klokka, høyre med klokka; se `FACE_DIRS`). `?jcflip=1` snur oppsettet (skinnen ned). Appen sender bare tilstand når noe endres og melder ikke frakobling, så en kontroller regnes som tilkoblet til siden lastes på nytt.

### Lyd
Alt er syntetisert med Web Audio (ingen lydfiler) og startes av første tastetrykk/klikk (`sound.unlock`). `main.js` kaller `sound.event(e)` for hver hendelse og `sound.update(dt, game, { listeners, pans, throttle })` hver frame. Lytterne er de lokale spillernes trucker; andre truckers motorer og effekter dempes og panoreres etter avstand og retning.
- `engine-sound.js`: `EngineModel` (turtall, automatgir, last; ren logikk) og `EngineVoice` (lydgrafen: en løkke med V8-tenninger spilt av med fart etter turtallet, gjennom faste eksosresonanser).
- `music.js`: lookahead-sequencer på lydklokka. `makeSong(seed)` lager låten fra banens frø.
- Lydkoden må aldri bruke `Math.random` (testene seeder den for å få like baner), men den seedede `rng` fra `engine-sound.js`.
- Feil i lydkoden fanges i `Sound.update`/`Sound.event` og i sequenceren, så de aldri stopper spill-løkka eller gjentar et steg.

### Øyeblikksbilder
30 per sekund (hvert andre steg). `Game.snapshot()`/`applySnapshot()` i `game.js` serialiserer kompakt. Truck-felt som klienter trenger må stå i `TRUCK_FIELDS`. `lerpSnapshot` (net.js) interpolerer feltene i `SMOOTH`. Klienten spiller av fra en jitterbuffer der forsinkelsen tilpasses p95 av gapene mellom bildene (`updateSnapDelay` i main.js).

### URL-parametre (main.js)
`?manual=1` (ingen sanntidsløkke, testene styrer tiden), `?room=navn`, `?role=host|client`, `?watch` (ren tilskuerskjerm), `?restart` (nullstiller rommet på Cloudflare), `?debug` (fps/nettverks-overlay). Uten `manual` (eller med `room`) kobler siden til `/ws`.

## Tester

Testene driver spillet via `window.__game` (definert nederst i `main.js`): `advance(s)` (simuler og tegn), `simulate(s)` (uten tegning, raskt), `state()`, `teleport`, `quiet`, `addBarricade`, `addCoin`. Utvid disse krokene når en ny test trenger tilgang til intern tilstand.

`tests/helpers.js`:
- `open(page)` erstatter `Math.random` med en seedet generator (`TEST_SEED`) og åpner `?manual=1`, så banene er like hver gang.
- `mockGamepads(page)` mocker to DualSense-kontrollere (`window.__pads`, knappeindekser i `BTN`).
- `startRace(page)` trykker Enter, hopper over nedtellingen og fjerner som standard item-bokser, boost-pads og ramper (`quiet: false` beholder dem).
- `driveAll(page)` kjører et helt løp med en enkel autopilot.

Flerspillertestene åpner vert og klienter i egne nettleserkontekster med et unikt `?room=` per test, så de kan kjøre parallelt.

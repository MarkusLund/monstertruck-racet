// Beste løptid, lagret i localStorage: totalt og per bane (frø). All tilgang er pakket inn i try/catch,
// så spillet fungerer også når lagring er blokkert (privat vindu, ingen tilgang).
const KEY = 'monstertruck.records.v1';
const MAX_SEEDS = 50;

export function loadRecords() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY));
    if (r && typeof r === 'object') {
      return { best: Number.isFinite(r.best) ? r.best : null, seeds: r.seeds && typeof r.seeds === 'object' ? r.seeds : {} };
    }
  } catch { /* ingen lagring */ }
  return { best: null, seeds: {} };
}

// Registrerer en løptid. Returnerer rekordene slik de var før denne tiden (null = ingen), og om tiden slo dem.
export function submitTime(seed, time) {
  const rec = loadRecords();
  const prevBest = rec.best;
  const key = `s${seed}`; // bokstavprefiks så nøklene beholder rekkefølgen de ble lagt inn i
  const prevTrack = Number.isFinite(rec.seeds[key]) ? rec.seeds[key] : null;
  const result = {
    newRecord: prevBest === null || time < prevBest,
    newTrackRecord: prevTrack !== null && time < prevTrack,
    best: prevBest,
    trackBest: prevTrack,
  };
  if (result.newRecord) rec.best = time;
  if (prevTrack === null || time < prevTrack) {
    delete rec.seeds[key];
    rec.seeds[key] = time;
    const keys = Object.keys(rec.seeds);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SEEDS))) delete rec.seeds[k];
  }
  try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch { /* ingen lagring */ }
  return result;
}

// Vibrasjon per hendelse fra simuleringen. Ren logikk (ingen DOM), så den kan testes direkte.
// Hver oppføring er { truck, strong, weak, ms }: strong er den tunge motoren, weak den lette.
// truck er null når hendelsen gjelder alle (f.eks. start).

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function rumbleFor(e) {
  switch (e.type) {
    case 'hit':
      if (e.cause === 'shield') return [{ truck: e.truck, strong: 0.3, weak: 0.5, ms: 200 }];
      if (e.shielded) return [{ truck: e.truck, strong: 0.4, weak: 0.6, ms: 250 }]; // skjoldet tok støtet
      if (e.cause === 'spin') return [{ truck: e.truck, strong: 0.6, weak: 0.5, ms: 500 }];
      return [{ truck: e.truck, strong: 0.95, weak: 0.7, ms: 600 }]; // rakett og mine
    case 'bump': {
      // Styrken følger støtet (power er relativ fart, 5 og oppover). Begge trucker kjenner det.
      const p = clamp01(((e.power || 5) - 5) / 15);
      const r = { strong: 0.3 + 0.6 * p, weak: 0.2 + 0.4 * p, ms: Math.round(120 + 150 * p) };
      return e.other == null ? [{ truck: e.truck, ...r }] : [{ truck: e.truck, ...r }, { truck: e.other, ...r }];
    }
    case 'land': return [{ truck: e.truck, strong: 0.5, weak: 0.2, ms: 140 }];
    case 'rescue': return [{ truck: e.truck, strong: 0.5, weak: 0.5, ms: 300 }];
    case 'item': return [{ truck: e.truck, strong: 0, weak: 0.5, ms: 100 }];
    case 'coin': return [{ truck: e.truck, strong: 0, weak: 0.25, ms: 35 }];
    case 'lap': return [{ truck: e.truck, strong: 0.3, weak: 0.6, ms: 250 }];
    case 'finish': return [{ truck: e.truck, strong: 0.7, weak: 0.7, ms: 700 }];
    case 'go': return [{ truck: null, strong: 0.4, weak: 0.6, ms: 200 }];
    default: return [];
  }
}

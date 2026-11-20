// Engineer rate-limit proof (07-02): node scripts/smoke-engineer-limit.mjs [baseUrl] [--model]
// Limits are counted in one Limiter Durable Object for every request, valid or not, so this uses schema-invalid
// bodies (400, no model call, no neurons). With --model, the first request is a real question (1 model call).
// Prints the colo of every response (cf-ray suffix) to show the burst was spread and still counted once.
// Exits 1 unless request client+1 (per client id) and request ip+1 (per address) are the first 429s.
const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) ?? 'https://suspension-lab.zh-a16.workers.dev').replace(/\/$/, '');
const withModel = args.includes('--model');
const LIMITS = { client: 6, ip: 40 }; // worker/routes/engineer.ts ENGINEER_LIMITS
const run = `${process.pid}-${Date.now().toString(36)}`;
const colos = new Map();

const telemetry = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../tests/fixtures/06-02-telemetry-carousel.json', import.meta.url), 'utf8'));

async function ask(clientId, body) {
  const res = await fetch(`${base}/api/engineer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-id': clientId },
    body: JSON.stringify(body),
  });
  const colo = res.headers.get('cf-ray')?.split('-')[1] ?? 'local';
  colos.set(colo, (colos.get(colo) ?? 0) + 1);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}
const invalid = { question: '' };

let failed = 0;
const report = (ok, msg) => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};

// 1. Per client id: requests 1..6 pass the limiter (200 model / 400 invalid), request 7 is 429.
const c1 = `limit-proof-${run}`;
const statuses = [];
let ipHits = 0;
for (let i = 0; i < LIMITS.client + 1; i++) {
  const r = await ask(c1, withModel && i === 0 ? { question: 'Why is the outside front wheel leaning like that?', telemetry, history: [] } : invalid);
  ipHits++;
  statuses.push(r.status === 200 ? `200 ${r.json?.source}` : String(r.status));
}
report(
  statuses.slice(0, LIMITS.client).every((s) => !s.startsWith('429')) && statuses[LIMITS.client] === '429',
  `per client id: ${LIMITS.client} allowed, request ${LIMITS.client + 1} limited — [${statuses.join(', ')}]`,
);

// 2. Per address: rotate client ids (each under its own limit); the address's request ip+1 is the first 429.
let firstBusy = null;
while (ipHits < LIMITS.ip + 1) {
  const r = await ask(`limit-proof-${run}-${ipHits}`, invalid);
  ipHits++;
  if (r.status === 429 && firstBusy === null) firstBusy = ipHits;
}
report(firstBusy === LIMITS.ip + 1, `per address with rotating client ids: first 429 at request ${firstBusy} (expected ${LIMITS.ip + 1})`);
console.log(`     colos: ${[...colos].map(([c, n]) => `${c}×${n}`).join(' ')}`);
console.log(failed ? `engineer-limit: ${failed} check(s) failed` : 'engineer-limit: all checks passed');
process.exit(failed ? 1 : 0);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cholesky, forwardSub, backSub, posterior, sampleTheta, chooseDaily, makeRng, STAR_REWARD, dot } from '../server/recs/model.js';
import { featurize, priorMean, D, tokenSlot } from '../server/recs/features.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('cholesky solves a small SPD system exactly', () => {
  const d = 3;
  const A = Float64Array.from([4, 2, 0.6, 2, 2, 0.5, 0.6, 0.5, 3]);
  const b = Float64Array.from([1, 2, 3]);
  const L = cholesky(A, d);
  const x = backSub(L, forwardSub(L, b, d), d);
  for (let i = 0; i < d; i++) {
    let s = 0;
    for (let j = 0; j < d; j++) s += A[i * d + j] * x[j];
    close(s, b[i]);
  }
});

test('with no ratings the posterior mean is the prior', () => {
  const mu0 = new Float64Array(D).map((_, i) => (i % 5) / 10);
  const post = posterior(D, mu0, []);
  for (let i = 0; i < D; i++) close(post.mean[i], mu0[i]);
});

test('a 5-star rating raises the score of similar songs, a 1-star lowers it', () => {
  const mu0 = new Float64Array(D);
  const song = featurize({ tags: [{ name: 'dream pop', count: 5 }], affinity: 0.5 });
  const twin = featurize({ tags: [{ name: 'dream pop', count: 3 }], affinity: 0.4 });
  const before = dot(posterior(D, mu0, []).mean, twin.x);
  const liked = dot(posterior(D, mu0, [{ x: song.x, reward: STAR_REWARD[5], age: 0 }]).mean, twin.x);
  const hated = dot(posterior(D, mu0, [{ x: song.x, reward: STAR_REWARD[1], age: 0 }]).mean, twin.x);
  assert.ok(liked > before && before > hated, `${hated} < ${before} < ${liked}`);
});

test('old ratings count less than recent ones (forgetting)', () => {
  const mu0 = new Float64Array(D);
  const song = featurize({ tags: [{ name: 'techno', count: 4 }] });
  const fresh = dot(posterior(D, mu0, [{ x: song.x, reward: 1, age: 0 }]).mean, song.x);
  const old = dot(posterior(D, mu0, [{ x: song.x, reward: 1, age: 365 }]).mean, song.x);
  assert.ok(fresh > old && old > 0);
});

test('Thompson samples are centred on the posterior mean', () => {
  const mu0 = new Float64Array(D).fill(0.1);
  const post = posterior(D, mu0, []);
  const rng = makeRng(7);
  const avg = new Float64Array(D);
  const n = 4000;
  for (let k = 0; k < n; k++) {
    const t = sampleTheta(post, rng);
    for (let i = 0; i < D; i++) avg[i] += t[i] / n;
  }
  for (let i = 0; i < D; i++) close(avg[i], 0.1, 0.05);
});

test('the prior from your library favours your genres', () => {
  const mu = priorMean([{ name: 'Tame Impala', weight: 1, tags: [{ name: 'psychedelic pop', count: 5 }] }]);
  const psych = featurize({ tags: [{ name: 'psychedelic pop', count: 5 }], affinity: 0.5 });
  const metal = featurize({ tags: [{ name: 'death metal', count: 5 }], affinity: 0.5 });
  assert.ok(dot(mu, psych.x) > dot(mu, metal.x));
});

test('daily picks: 3 songs, different artists, one wildcard, valid propensities', () => {
  const rng = makeRng(1);
  const cands = Array.from({ length: 60 }, (_, i) => {
    const f = featurize({ tags: [{ name: `genre${i % 7}`, count: 3 }], affinity: (i % 10) / 10 });
    return { ...f, artistKey: `artist${i % 20}`, affinity: (i % 10) / 10, id: i };
  });
  const picks = chooseDaily(cands, posterior(D, new Float64Array(D), []), rng);
  assert.equal(picks.length, 3);
  assert.equal(new Set(picks.map((p) => p.artistKey)).size, 3);
  assert.deepEqual(picks.map((p) => p.kind), ['safe', 'safe', 'wild']);
  for (const p of picks) assert.ok(p.propensity > 0 && p.propensity <= 1);
});

test('feature hashing is stable', () => {
  assert.deepEqual(tokenSlot('tag:indie rock'), tokenSlot('tag:indie rock'));
});

/**
 * Simulated listener. They have a hidden taste over 30 genres, rate only ~60% of the picks
 * (the rest are ignored, which must not count as dislikes) and are a bit noisy.
 * After two months the model's picks should clearly beat random picks.
 */
test('simulation: the model learns a hidden taste from ratings alone', () => {
  const rng = makeRng(42);
  const genres = Array.from({ length: 30 }, (_, i) => `g${i}`);
  const taste = Object.fromEntries(genres.map((g) => [g, rng.normal()]));
  const makeSong = (id) => {
    const tags = [0, 1].map(() => ({ name: genres[Math.floor(rng.uniform() * genres.length)], count: 1 + Math.floor(rng.uniform() * 4) }));
    const truth = tags.reduce((s, t) => s + taste[t.name] * t.count, 0) / tags.reduce((s, t) => s + t.count, 0);
    const f = featurize({ tags, affinity: rng.uniform() });
    return { ...f, artistKey: `a${id}`, affinity: f.x[1], truth };
  };
  const toStars = (truth) => Math.max(1, Math.min(5, Math.round(3 + 1.3 * truth + 0.5 * rng.normal())));

  const ratings = [];
  const learned = [];
  const random = [];
  let id = 0;
  for (let day = 0; day < 60; day++) {
    const cands = Array.from({ length: 150 }, () => makeSong(id++));
    const post = posterior(D, new Float64Array(D), ratings.map((r) => ({ ...r, age: day - r.day })));
    const picks = chooseDaily(cands, post, rng, { propensityRuns: 0 });
    learned.push(picks.filter((p) => p.kind === 'safe').reduce((s, p) => s + p.truth, 0) / 2);
    random.push((cands[0].truth + cands[1].truth) / 2);
    for (const p of picks) {
      if (rng.uniform() < 0.4) continue; // ignored: no update at all
      ratings.push({ x: p.x, reward: STAR_REWARD[toStars(p.truth)], day });
    }
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const early = mean(learned.slice(0, 10));
  const late = mean(learned.slice(-20));
  const rand = mean(random);
  console.log(`  taste match: random ${rand.toFixed(2)}, first 10 days ${early.toFixed(2)}, last 20 days ${late.toFixed(2)}`);
  assert.ok(late > rand + 0.4, 'learned picks should beat random');
  assert.ok(late > early, 'picks should improve over time');
});

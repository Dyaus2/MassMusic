/**
 * Bayesian linear contextual bandit with Thompson sampling.
 *
 *   reward ≈ θ · x + noise,   θ ~ N(μ0, (1/λ0) I)   (prior built from your library)
 *
 * Every rating adds one observation. Nothing else updates the model: an ignored
 * recommendation is missing data, not a dislike. Old ratings fade with a daily
 * forgetting factor so the model follows your taste as it changes.
 *
 * The model has no stored weights: the posterior is recomputed from the ratings log,
 * which takes well under a millisecond for d = 64 and a few thousand ratings.
 */

export const DEFAULTS = {
  priorStrength: 2, // λ0: the prior counts like ~2 ratings per direction
  noise: 0.5, // σ: how noisy one rating is
  dailyDecay: 0.995, // γ: a rating loses half its weight in ~138 days
  wildcardBoost: 2.5, // extra exploration for the wildcard slot
};

/** 1–5 stars → reward in [-1, 1]. 3★ is neutral but still informative (it pulls the score to 0). */
export const STAR_REWARD = { 1: -1, 2: -0.5, 3: 0, 4: 0.5, 5: 1 };

/* ---------------- small dense linear algebra (d ≤ ~128) ---------------- */

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** In-place Cholesky of a symmetric positive-definite matrix (flat, row-major). Returns lower L. */
export function cholesky(A, d) {
  const L = new Float64Array(d * d);
  for (let i = 0; i < d; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * d + j];
      for (let k = 0; k < j; k++) s -= L[i * d + k] * L[j * d + k];
      if (i === j) L[i * d + i] = Math.sqrt(Math.max(s, 1e-12));
      else L[i * d + j] = s / L[j * d + j];
    }
  }
  return L;
}

/** Solve L y = b (L lower triangular). */
export function forwardSub(L, b, d) {
  const y = new Float64Array(d);
  for (let i = 0; i < d; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * d + k] * y[k];
    y[i] = s / L[i * d + i];
  }
  return y;
}

/** Solve Lᵀ x = y. */
export function backSub(L, y, d) {
  const x = new Float64Array(d);
  for (let i = d - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < d; k++) s -= L[k * d + i] * x[k];
    x[i] = s / L[i * d + i];
  }
  return x;
}

/* ---------------- random numbers (seedable, for tests) ---------------- */

export function makeRng(seed = Date.now()) {
  // mulberry32
  let a = seed >>> 0;
  const uniform = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  const normal = () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = uniform();
    const v = uniform();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return { uniform, normal };
}

/* ---------------- posterior ---------------- */

/**
 * @param {number} d             feature size
 * @param {Float64Array} mu0     prior mean (from the library profile)
 * @param {{x:number[], reward:number, age:number}[]} ratings   age in days
 */
export function posterior(d, mu0, ratings, opts = {}) {
  const { priorStrength, noise, dailyDecay } = { ...DEFAULTS, ...opts };
  const A = new Float64Array(d * d);
  const b = new Float64Array(d);
  for (let i = 0; i < d; i++) {
    A[i * d + i] = priorStrength;
    b[i] = priorStrength * mu0[i];
  }
  const inv = 1 / (noise * noise);
  let effective = 0;
  for (const r of ratings) {
    const w = inv * Math.pow(dailyDecay, Math.max(0, r.age));
    effective += Math.pow(dailyDecay, Math.max(0, r.age));
    const x = r.x;
    for (let i = 0; i < d; i++) {
      const xi = x[i];
      if (xi === 0) continue;
      b[i] += w * r.reward * xi;
      const row = i * d;
      for (let j = 0; j <= i; j++) A[row + j] += w * xi * x[j];
    }
  }
  for (let i = 0; i < d; i++) for (let j = 0; j < i; j++) A[j * d + i] = A[i * d + j];
  const L = cholesky(A, d);
  const mean = backSub(L, forwardSub(L, b, d), d);
  return { d, L, mean, effective, count: ratings.length };
}

/** θ ~ N(mean, scale² · A⁻¹)  via  θ = mean + scale · L⁻ᵀ z */
export function sampleTheta(post, rng, scale = 1) {
  const { d, L, mean } = post;
  const z = new Float64Array(d);
  for (let i = 0; i < d; i++) z[i] = rng.normal();
  const e = backSub(L, z, d);
  const theta = new Float64Array(d);
  for (let i = 0; i < d; i++) theta[i] = mean[i] + scale * e[i];
  return theta;
}

/** Posterior standard deviation of θ·x (how unsure the model is about this song). */
export function uncertainty(post, x) {
  const y = forwardSub(post.L, x, post.d);
  return Math.sqrt(dot(y, y));
}

/* ---------------- choosing the daily picks ---------------- */

function cosine(a, b) {
  const n = Math.sqrt(dot(a, a) * dot(b, b));
  return n ? dot(a, b) / n : 0;
}

function pickOnce(cands, post, rng, opts) {
  const { wildcardBoost, safeSlots, maxSimilarity } = opts;
  const chosen = [];
  const usedArtists = new Set();
  const okWith = (c) => !usedArtists.has(c.artistKey) && chosen.every((p) => cosine(p.tags, c.tags) < maxSimilarity);

  // safe slots: plain Thompson sampling
  const theta = sampleTheta(post, rng, 1);
  const ranked = cands.map((c, i) => ({ i, s: dot(theta, c.x) })).sort((a, b) => b.s - a.s);
  for (const r of ranked) {
    if (chosen.length >= safeSlots) break;
    const c = cands[r.i];
    if (!okWith(c)) continue;
    chosen.push({ ...c, index: r.i, kind: 'safe' });
    usedArtists.add(c.artistKey);
  }

  // wildcard: wider sampling, restricted to songs outside your comfort zone
  const thetaW = sampleTheta(post, rng, wildcardBoost);
  const affinities = cands.map((c) => c.affinity).sort((a, b) => a - b);
  const medianAffinity = affinities[Math.floor(affinities.length / 2)] ?? 0;
  const means = cands.map((c) => dot(post.mean, c.x)).sort((a, b) => a - b);
  const floor = means[Math.floor(means.length * 0.25)] ?? -Infinity;
  let best = null;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (!okWith(c) || chosen.some((p) => p.index === i)) continue;
    if (c.affinity > medianAffinity || dot(post.mean, c.x) < floor) continue;
    const s = dot(thetaW, c.x);
    if (!best || s > best.s) best = { i, s };
  }
  if (!best) {
    // nothing outside the comfort zone: fall back to any remaining song
    for (let i = 0; i < cands.length; i++) {
      if (!okWith(cands[i]) || chosen.some((p) => p.index === i)) continue;
      const s = dot(thetaW, cands[i].x);
      if (!best || s > best.s) best = { i, s };
    }
  }
  if (best) chosen.push({ ...cands[best.i], index: best.i, kind: 'wild' });
  return chosen;
}

/**
 * Pick the day's songs. Also estimates each pick's propensity (how likely this policy was to
 * choose that song for that slot), logged for off-policy evaluation of future model versions.
 *
 * cands: [{ x: Float64Array, tags: Float64Array, artistKey, affinity, ... }]
 */
export function chooseDaily(cands, post, rng, options = {}) {
  const opts = { wildcardBoost: DEFAULTS.wildcardBoost, safeSlots: 2, maxSimilarity: 0.92, propensityRuns: 100, ...options };
  if (!cands.length) return [];
  const picks = pickOnce(cands, post, rng, opts);
  const hits = picks.map(() => 0);
  for (let r = 0; r < opts.propensityRuns; r++) {
    const again = pickOnce(cands, post, rng, opts);
    picks.forEach((p, k) => {
      if (again[k]?.index === p.index) hits[k]++;
    });
  }
  return picks.map((p, k) => ({
    ...p,
    propensity: Math.max(1, hits[k]) / opts.propensityRuns,
    score: dot(post.mean, p.x),
    uncertainty: uncertainty(post, p.x),
  }));
}

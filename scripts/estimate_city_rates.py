#!/usr/bin/env python3
"""Hierarchical (partial-pooling) estimates of per-city pedestrian rates, with uncertainty.

Why this exists
---------------
The globe ranks cities by raw per-pedestrian rates (risky crossing, red-light running,
crosswalk use, phone use). Those rates have two problems a sample-size gate cannot fix:

* Pedestrians are clustered in videos. 54 of the 60 cities that once passed the n >= 30 gate
  rested on ONE video, so "30 pedestrians" was 30 people seen at one place, one time of day,
  one weather, one camera angle -- not 30 independent observations of the city.
* With one video per city, a city effect and a video effect are confounded. The only way to
  say how much of a city's rate is "the city" is to learn the between-video spread from the
  cities that DO have several videos, and pool that information.

The model, per metric, over videos v in cities c:

    k_v ~ Binomial(n_v, logistic(mu + u_c + e_v))
    u_c ~ Normal(0, sigma_city)     city effect
    e_v ~ Normal(0, sigma_video)    video-within-city effect (camera/time/weather/...)

fit with NUTS (NumPyro). The reported city quantity is the city's expected rate for a new
video, E_e[logistic(mu + u_c + e)], integrated over the video effect by Gauss-Hermite
quadrature -- the model analogue of the raw pooled rate. A single-video city's interval is
therefore at least as wide as the between-video variation, which is the honest answer.

Outputs (tables created by migrations/*_city-metric-estimates.sql):
    metric_model_runs      one row per fit: variance components + convergence diagnostics
    city_metric_estimates  one row per (city, metric): raw rate, n, videos, posterior mean,
                           95% interval, 95% rank interval among cities passing the gate

Each fit is tagged with an explicitly requested dataset release. Unversioned writes are
disabled. A fit may publish only while that release remains active; publication clears
previous-release intervals. Failed fits can retain only estimates from the same release.

Usage: python scripts/estimate_city_rates.py [--metric risky_crossing] [--draws 1000]
                                             [--chains 4] [--seed 20261010] [--dry-run]
DATABASE_URL is read from the environment, else from .env.local / .env.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
import time
from pathlib import Path

# NumPyro runs chains in parallel only if JAX is told about >1 host device BEFORE import.
os.environ.setdefault("XLA_FLAGS", "--xla_force_host_platform_device_count=4")

import numpy as np  # noqa: E402
import psycopg  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

# metric key -> pedestrians column. The key is the prefix the API/globe use
# (<key>_rate in v_city_summary). n counts pedestrians whose flag is KNOWN (NOT NULL),
# the same denominator as v_city_summary since 2026-09-07.
METRICS = {
    "risky_crossing": "risky_crossing",
    "run_red_light": "run_red_light",
    "crosswalk_usage": "crosswalk_use_or_not",
    "phone_usage": "phone_using",
}
# Rank intervals are computed among the cities the globe actually ranks: the same gate as
# Globe.tsx METRIC_CONFIG (minN 30 on the rate's own denominator).
RANK_MIN_N = 30
# Convergence bar for replacing a metric's estimates.
MAX_RHAT = 1.01
MIN_ESS = 400
PPC_P_RANGE = (0.01, 0.99)
PUBLISH_LOCK = 1735025711


def require_active_release(conn, release_id):
    """Called before reading and again under the publication lock before writing."""
    if not release_id:
        raise ValueError("Unversioned model writes are disabled; supply --dataset-release-id")
    row = conn.execute(
        "SELECT dataset_release_id FROM dataset_releases WHERE dataset_release_id = %s AND is_active",
        (release_id,),
    ).fetchone()
    if not row:
        raise ValueError(f"Dataset release is not active: {release_id}; model results were not written")


def database_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    for name in (".env.local", ".env"):
        f = ROOT / name
        if f.exists():
            m = re.search(r'^DATABASE_URL\s*=\s*"?([^"\n]+?)"?\s*$', f.read_text(encoding="utf-8"), re.M)
            if m:
                return m.group(1)
    sys.exit("DATABASE_URL is not set (checked env, .env.local, .env)")


def load_counts(conn, column: str, release_id: str, metric: str):
    """Per-video successes / known observations for one pedestrian flag, plus the
    measurement era that produced them (NULL pipeline_version = the 2025-12 bulk import)."""
    rows = conn.execute(
        f"""
        SELECT v.city_id,
               COALESCE(v.pipeline_version, 'import_2025') AS era,
               count(*) FILTER (WHERE p.{column}) AS k,
               count(p.{column})                  AS n
          FROM videos v
          JOIN pedestrians p ON p.video_id = v.id
         WHERE v.city_id IS NOT NULL AND v.dataset_release_id = %s
           AND v.eligible_for_comparison IS TRUE
           AND v.metric_validity -> %s ->> 'status' = 'validated'
         GROUP BY v.id, v.city_id, era
        HAVING count(p.{column}) > 0
         ORDER BY v.id
        """, (release_id, metric)
    ).fetchall()
    if not rows:
        return np.array([]), np.array([]), np.array([]), np.array([])
    city_id, era, k, n = zip(*rows)
    return np.asarray(city_id), np.asarray(era), np.asarray(k, float), np.asarray(n, float)


def fit(city_idx, era_idx, n_eras, k, n, n_cities, chains, draws, seed):
    import jax
    import jax.numpy as jnp
    import numpyro
    import numpyro.distributions as dist
    from numpyro.infer import MCMC, NUTS

    p0 = (k.sum() + 0.5) / (n.sum() + 1.0)

    def model(city_idx, era_idx, n, k=None):
        mu = numpyro.sample("mu", dist.Normal(np.log(p0 / (1 - p0)), 1.5))
        # Measurement era as a FIXED effect. The 2025-12 bulk import and PedX-Insight's
        # pipelines are different instruments (crosswalk use 9.8% vs 1.6% on average), and
        # left in the random effects that gap was read as city/video variance.
        beta = numpyro.sample("beta", dist.Normal(0.0, 1.5).expand([n_eras - 1]))
        era_shift = jnp.concatenate([jnp.zeros(1), beta])
        # Variance-partition parameterisation. With one video per city the likelihood only
        # sees sigma_city^2 + sigma_video^2, so sampling the two SDs directly walks a ridge
        # (r_hat 1.3, hundreds of divergences). tau (total SD) is well identified; rho (the
        # city share of the variance) is learned from the multi-video cities, and its prior
        # carries the rest -- which is the honest state of knowledge.
        tau = numpyro.sample("tau", dist.HalfNormal(1.5))
        rho = numpyro.sample("rho", dist.Beta(2.0, 2.0))
        sigma_city = numpyro.deterministic("sigma_city", tau * jnp.sqrt(rho))
        sigma_video = numpyro.deterministic("sigma_video", tau * jnp.sqrt(1.0 - rho))
        # Non-centred: most groups have a single member, the funnel case.
        with numpyro.plate("cities", n_cities):
            z_c = numpyro.sample("z_city", dist.Normal(0.0, 1.0))
        with numpyro.plate("videos", len(n)):
            z_v = numpyro.sample("z_video", dist.Normal(0.0, 1.0))
            logit = mu + era_shift[era_idx] + sigma_city * z_c[city_idx] + sigma_video * z_v
            numpyro.sample("k", dist.Binomial(total_count=n, logits=logit), obs=k)

    mcmc = MCMC(
        NUTS(model, target_accept_prob=0.95),
        num_warmup=draws, num_samples=draws, num_chains=chains,
        chain_method="parallel" if jax.local_device_count() >= chains else "sequential",
        progress_bar=False,
    )
    mcmc.run(jax.random.PRNGKey(seed), city_idx=jnp.asarray(city_idx), era_idx=jnp.asarray(era_idx),
             n=jnp.asarray(n), k=jnp.asarray(k))
    return mcmc


def summarise(mcmc, theta_by_chain):
    """Convergence over the hyperparameters AND the reported city rates.

    The raw z_city / z_video of a single-video city are not individually identified (only
    their sum is), so their r_hat says nothing about anything published; the city rates
    built from them are what must have mixed."""
    from numpyro.diagnostics import summary

    g = mcmc.get_samples(group_by_chain=True)
    sites = {k: v for k, v in g.items() if k in ("mu", "beta", "tau", "rho")}
    sites["theta"] = theta_by_chain
    s = summary(sites, prob=0.95)
    rhat = max(float(np.nanmax(v["r_hat"])) for v in s.values())
    ess = min(float(np.nanmin(v["n_eff"])) for v in s.values())
    divergences = int(np.asarray(mcmc.get_extra_fields()["diverging"]).sum())
    return rhat, ess, divergences


def city_rates(samples, era_weights, n_quad=24):
    """Posterior draws of each city's expected rate for a new video:

        theta_c = sum_k w_ck * E_e[logistic(mu + beta_k + u_c + e)],  e ~ N(0, sigma_video)

    w_ck is the share of city c's observations made in era k, so the estimate stays on the
    scale the city was actually measured on (no silent re-scaling to a reference era).
    The expectation over e uses Gauss-Hermite quadrature. Leading axes of the samples are
    kept, so (chains, draws, ...) input gives (chains, draws, cities) output."""
    from numpy.polynomial.hermite_e import hermegauss
    from scipy.special import expit

    x, w = hermegauss(n_quad)              # probabilists' nodes: integrate against N(0, 1)
    w = w / w.sum()
    mu = np.asarray(samples["mu"])[..., None, None, None]                       # (.., 1, 1, 1)
    beta = np.asarray(samples["beta"])
    shift = np.concatenate([np.zeros(beta.shape[:-1] + (1,)), beta], axis=-1)    # (.., K)
    u = np.asarray(samples["sigma_city"])[..., None] * np.asarray(samples["z_city"])  # (.., C)
    sv = np.asarray(samples["sigma_video"])[..., None, None, None]              # (.., 1, 1, 1)
    eta = (mu + u[..., :, None, None] + shift[..., None, :, None]
           + sv * x)                                                             # (.., C, K, Q)
    per_era = (expit(eta) * w).sum(axis=-1)                                      # (.., C, K)
    return (per_era * era_weights).sum(axis=-1)                                  # (.., C)


def posterior_predictive_pvalues(samples, city_idx, era_idx, k, n, seed, max_draws=4000):
    """Two posterior predictive checks, as p-values P(T(rep) >= T(obs)):

    * overdispersion -- Pearson X^2 of video counts around the pooled rate. Tests whether
      the model reproduces how much videos really differ (the thing that sets the width of
      every city interval). Near 0 or 1 = the model's spread is wrong.
    * zeros -- share of videos with no event at all. Tests the tail for rare outcomes
      (phone use), where a logit-normal can under-produce zero-count videos.
    """
    rng = np.random.default_rng(seed)
    S = min(max_draws, len(samples["mu"]))
    pick = rng.choice(len(samples["mu"]), S, replace=False)
    beta = np.asarray(samples["beta"])[pick]
    shift = np.concatenate([np.zeros((S, 1)), beta], axis=1)
    logit = (np.asarray(samples["mu"])[pick, None] + shift[:, era_idx]
             + np.asarray(samples["sigma_city"])[pick, None] * np.asarray(samples["z_city"])[pick][:, city_idx]
             + np.asarray(samples["sigma_video"])[pick, None] * np.asarray(samples["z_video"])[pick])
    k_rep = rng.binomial(n.astype(int)[None, :], 1.0 / (1.0 + np.exp(-logit)))
    p_bar = k.sum() / n.sum()
    var = n * p_bar * (1 - p_bar)

    def x2(kk):
        return (((kk - n * p_bar) ** 2) / var).sum(axis=-1)

    p_disp = float((x2(k_rep) >= x2(k)).mean())
    p_zero = float(((k_rep == 0).mean(axis=1) >= (k == 0).mean()).mean())
    return p_disp, p_zero


def rank_intervals(theta, gated):
    """95% interval of each gated city's rank (1 = highest rate) across posterior draws."""
    out_lo = np.full(theta.shape[1], np.nan)
    out_hi = np.full(theta.shape[1], np.nan)
    idx = np.flatnonzero(gated)
    if len(idx) < 2:
        return out_lo, out_hi
    sub = theta[:, idx]
    # rank 1 = largest value in that draw
    ranks = (-sub).argsort(axis=1).argsort(axis=1) + 1
    out_lo[idx] = np.percentile(ranks, 2.5, axis=0)
    out_hi[idx] = np.percentile(ranks, 97.5, axis=0)
    return np.floor(out_lo), np.ceil(out_hi)


def script_digest() -> str:
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()[:12]


def run_metric(conn, metric, column, args):
    require_active_release(conn, args.dataset_release_id)
    city_id, era, k, n = load_counts(conn, column, args.dataset_release_id, metric)
    # Release the read transaction during expensive fitting; a fresh check under
    # the same advisory lock as publication prevents publishing a stale fit.
    conn.commit()
    if len(n) == 0:
        print(f"[{metric}] no observations; skipped")
        return False
    cities, city_idx = np.unique(city_id, return_inverse=True)
    eras, era_idx = np.unique(era, return_inverse=True)
    era_weights = np.zeros((len(cities), len(eras)))
    np.add.at(era_weights, (city_idx, era_idx), n)
    era_weights /= era_weights.sum(axis=1, keepdims=True)
    t0 = time.time()
    mcmc = fit(city_idx, era_idx, len(eras), k, n, len(cities), args.chains, args.draws, args.seed)
    theta_by_chain = city_rates(mcmc.get_samples(group_by_chain=True), era_weights)
    rhat, ess, divergences = summarise(mcmc, theta_by_chain)
    samples = mcmc.get_samples()
    theta = theta_by_chain.reshape(-1, len(cities))

    n_city = np.bincount(city_idx, weights=n)
    k_city = np.bincount(city_idx, weights=k)
    v_city = np.bincount(city_idx)
    gated = n_city >= RANK_MIN_N
    r_lo, r_hi = rank_intervals(theta, gated)
    est = theta.mean(axis=0)
    lo, hi = np.percentile(theta, [2.5, 97.5], axis=0)
    sc = np.asarray(samples["sigma_city"])
    sv = np.asarray(samples["sigma_video"])

    p_disp, p_zero = posterior_predictive_pvalues(samples, city_idx, era_idx, k, n, args.seed)
    # Accept only a converged fit whose between-video spread matches the data: that spread
    # is what sets every city's interval width. The zero-count check is reported, not gating.
    ok = (rhat <= MAX_RHAT and ess >= MIN_ESS and divergences == 0
          and PPC_P_RANGE[0] <= p_disp <= PPC_P_RANGE[1])
    beta = np.asarray(samples["beta"]).mean(axis=0)
    rho = np.asarray(samples["rho"])
    print(f"[{metric}] eras {list(eras)} beta {np.round(beta, 2).tolist()} | "
          f"city share of variance rho {rho.mean():.2f} [{np.percentile(rho, 2.5):.2f}, {np.percentile(rho, 97.5):.2f}] | "
          f"PPC p: dispersion {p_disp:.2f}, zeros {p_zero:.2f}")
    print(f"[{metric}] {len(n)} videos, {len(cities)} cities, {int(n.sum())} obs, {time.time() - t0:.0f}s | "
          f"sigma_city {sc.mean():.2f} [{np.percentile(sc, 2.5):.2f}, {np.percentile(sc, 97.5):.2f}] "
          f"sigma_video {sv.mean():.2f} [{np.percentile(sv, 2.5):.2f}, {np.percentile(sv, 97.5):.2f}] | "
          f"max r_hat {rhat:.3f}, min ESS {ess:.0f}, divergences {divergences} -> {'OK' if ok else 'REJECTED'}")
    if args.dry_run:
        return True

    pct = lambda a, q: float(np.percentile(a, q))  # noqa: E731
    run_row = dict(
        dataset_release_id=args.dataset_release_id,
        metric=metric, accepted=ok, eras=",".join(map(str, eras)),
        era_effects=",".join(f"{b:.3f}" for b in np.atleast_1d(beta)),
        n_videos=len(n), n_cities=len(cities), n_obs=int(n.sum()),
        sigma_city_mean=float(sc.mean()), sigma_city_low=pct(sc, 2.5), sigma_city_high=pct(sc, 97.5),
        sigma_video_mean=float(sv.mean()), sigma_video_low=pct(sv, 2.5), sigma_video_high=pct(sv, 97.5),
        city_share_mean=float(rho.mean()), city_share_low=pct(rho, 2.5), city_share_high=pct(rho, 97.5),
        ppc_dispersion_p=p_disp, ppc_zeros_p=p_zero, max_rhat=rhat, min_ess=ess, divergences=divergences,
        chains=args.chains, draws=args.draws, seed=args.seed, script_digest=script_digest(),
    )
    insert_run = (f"INSERT INTO metric_model_runs ({', '.join(run_row)}) "
                  f"VALUES ({', '.join(['%s'] * len(run_row))}) RETURNING id")
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (PUBLISH_LOCK,))
        require_active_release(conn, args.dataset_release_id)
        run_id = conn.execute(insert_run, tuple(run_row.values())).fetchone()[0]
        if not ok:
            return False
        conn.execute("DELETE FROM city_metric_estimates WHERE metric = %s", (metric,))
        with conn.cursor().copy(
            "COPY city_metric_estimates (city_id, metric, n_obs, n_successes, n_videos, raw_rate, "
            "est_mean, est_low, est_high, rank_low, rank_high, ranked_cities, model_run_id, dataset_release_id) FROM STDIN"
        ) as cp:
            n_ranked = int(gated.sum())
            for i, c in enumerate(cities):
                cp.write_row((
                    int(c), metric, int(n_city[i]), int(k_city[i]), int(v_city[i]),
                    float(k_city[i] / n_city[i]), float(est[i]), float(lo[i]), float(hi[i]),
                    None if np.isnan(r_lo[i]) else int(r_lo[i]),
                    None if np.isnan(r_hi[i]) else int(r_hi[i]),
                    n_ranked if gated[i] else None, run_id, args.dataset_release_id,
                ))
        conn.execute("""UPDATE dataset_releases SET model_status = CASE WHEN
            (SELECT COUNT(DISTINCT metric) FROM city_metric_estimates WHERE dataset_release_id = %s) = %s
            THEN 'available_for_release' ELSE 'partial_for_release' END
            WHERE dataset_release_id = %s AND is_active""",
                     (args.dataset_release_id, len(METRICS), args.dataset_release_id))
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--metric", choices=sorted(METRICS), action="append")
    ap.add_argument("--draws", type=int, default=4000)
    ap.add_argument("--chains", type=int, default=4)
    ap.add_argument("--seed", type=int, default=20261010)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--dataset-release-id", default=os.environ.get("PEDX_DATASET_RELEASE_ID"))
    args = ap.parse_args()
    if not args.dataset_release_id:
        ap.error("Unversioned fitting/writes are disabled; supply --dataset-release-id for the active release")

    with psycopg.connect(database_url()) as conn:
        accepted = []
        for metric in args.metric or METRICS:
            accepted.append(run_metric(conn, metric, METRICS[metric], args))
            conn.commit()
    if not all(accepted):
        sys.exit("One or more metrics had no usable observations or failed fit checks; no stale-release estimates were published")


if __name__ == "__main__":
    main()

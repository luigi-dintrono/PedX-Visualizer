-- Up Migration
--
-- Per-city rate estimates WITH uncertainty, written by scripts/estimate_city_rates.py
-- (hierarchical binomial model: city and video-within-city random effects, measurement era
-- as a fixed effect, NUTS via NumPyro). The raw rate on the globe is a point estimate whose
-- precision depends on how many VIDEOS stand behind it, not how many pedestrians: most
-- cities rest on one video, so their pedestrians share one camera, one time, one weather.
-- These tables carry the interval and the video count the globe and leaderboard show.

CREATE TABLE metric_model_runs (
    id                 SERIAL PRIMARY KEY,
    metric             VARCHAR(40) NOT NULL,
    fitted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- false = fit failed its convergence/predictive checks; published estimates untouched
    accepted           BOOLEAN NOT NULL,
    eras               TEXT,               -- measurement eras in the fit, reference first
    era_effects        TEXT,               -- posterior mean logit shift of each non-reference era
    n_videos           INTEGER NOT NULL,
    n_cities           INTEGER NOT NULL,
    n_obs              INTEGER NOT NULL,
    sigma_city_mean    DOUBLE PRECISION,   -- between-city SD (logit scale)
    sigma_city_low     DOUBLE PRECISION,
    sigma_city_high    DOUBLE PRECISION,
    sigma_video_mean   DOUBLE PRECISION,   -- between-video-within-city SD (logit scale)
    sigma_video_low    DOUBLE PRECISION,
    sigma_video_high   DOUBLE PRECISION,
    city_share_mean    DOUBLE PRECISION,   -- rho = sigma_city^2 / (sigma_city^2 + sigma_video^2)
    city_share_low     DOUBLE PRECISION,
    city_share_high    DOUBLE PRECISION,
    ppc_dispersion_p   DOUBLE PRECISION,   -- posterior predictive p, between-video spread
    ppc_zeros_p        DOUBLE PRECISION,   -- posterior predictive p, share of zero-event videos
    max_rhat           DOUBLE PRECISION,
    min_ess            DOUBLE PRECISION,
    divergences        INTEGER,
    chains             INTEGER,
    draws              INTEGER,
    seed               BIGINT,
    script_digest      VARCHAR(16)
);
CREATE INDEX idx_metric_model_runs_metric ON metric_model_runs (metric, fitted_at DESC);

CREATE TABLE city_metric_estimates (
    city_id       INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    metric        VARCHAR(40) NOT NULL,
    n_obs         INTEGER NOT NULL,          -- pedestrians whose flag is known
    n_successes   INTEGER NOT NULL,
    n_videos      INTEGER NOT NULL,
    raw_rate      DOUBLE PRECISION NOT NULL, -- n_successes / n_obs, as on the globe
    est_mean      DOUBLE PRECISION NOT NULL, -- posterior mean expected rate for a new video
    est_low       DOUBLE PRECISION NOT NULL, -- 95% credible interval
    est_high      DOUBLE PRECISION NOT NULL,
    rank_low      INTEGER,                   -- 95% interval of rank (1 = highest rate) among
    rank_high     INTEGER,                   --   the ranked_cities passing the n_obs >= 30 gate
    ranked_cities INTEGER,
    model_run_id  INTEGER NOT NULL REFERENCES metric_model_runs(id),
    PRIMARY KEY (city_id, metric)
);

-- One row per city, one column group per metric, for a single LEFT JOIN in the API.
CREATE VIEW v_city_rate_estimates AS
SELECT city_id,
       max(n_videos)   FILTER (WHERE metric = 'risky_crossing')  AS risky_crossing_videos,
       max(est_mean)   FILTER (WHERE metric = 'risky_crossing')  AS risky_crossing_est,
       max(est_low)    FILTER (WHERE metric = 'risky_crossing')  AS risky_crossing_lo,
       max(est_high)   FILTER (WHERE metric = 'risky_crossing')  AS risky_crossing_hi,
       max(rank_low)   FILTER (WHERE metric = 'risky_crossing')  AS risky_crossing_rank_lo,
       max(rank_high)  FILTER (WHERE metric = 'risky_crossing')  AS risky_crossing_rank_hi,
       max(n_videos)   FILTER (WHERE metric = 'run_red_light')   AS run_red_light_videos,
       max(est_mean)   FILTER (WHERE metric = 'run_red_light')   AS run_red_light_est,
       max(est_low)    FILTER (WHERE metric = 'run_red_light')   AS run_red_light_lo,
       max(est_high)   FILTER (WHERE metric = 'run_red_light')   AS run_red_light_hi,
       max(rank_low)   FILTER (WHERE metric = 'run_red_light')   AS run_red_light_rank_lo,
       max(rank_high)  FILTER (WHERE metric = 'run_red_light')   AS run_red_light_rank_hi,
       max(n_videos)   FILTER (WHERE metric = 'crosswalk_usage') AS crosswalk_usage_videos,
       max(est_mean)   FILTER (WHERE metric = 'crosswalk_usage') AS crosswalk_usage_est,
       max(est_low)    FILTER (WHERE metric = 'crosswalk_usage') AS crosswalk_usage_lo,
       max(est_high)   FILTER (WHERE metric = 'crosswalk_usage') AS crosswalk_usage_hi,
       max(rank_low)   FILTER (WHERE metric = 'crosswalk_usage') AS crosswalk_usage_rank_lo,
       max(rank_high)  FILTER (WHERE metric = 'crosswalk_usage') AS crosswalk_usage_rank_hi,
       max(n_videos)   FILTER (WHERE metric = 'phone_usage')     AS phone_usage_videos,
       max(est_mean)   FILTER (WHERE metric = 'phone_usage')     AS phone_usage_est,
       max(est_low)    FILTER (WHERE metric = 'phone_usage')     AS phone_usage_lo,
       max(est_high)   FILTER (WHERE metric = 'phone_usage')     AS phone_usage_hi,
       max(rank_low)   FILTER (WHERE metric = 'phone_usage')     AS phone_usage_rank_lo,
       max(rank_high)  FILTER (WHERE metric = 'phone_usage')     AS phone_usage_rank_hi,
       max(ranked_cities) FILTER (WHERE metric = 'risky_crossing')  AS risky_crossing_ranked,
       max(ranked_cities) FILTER (WHERE metric = 'run_red_light')   AS run_red_light_ranked,
       max(ranked_cities) FILTER (WHERE metric = 'crosswalk_usage') AS crosswalk_usage_ranked,
       max(ranked_cities) FILTER (WHERE metric = 'phone_usage')     AS phone_usage_ranked
  FROM city_metric_estimates
 GROUP BY city_id;

-- Down Migration

DROP VIEW IF EXISTS v_city_rate_estimates;
DROP TABLE IF EXISTS city_metric_estimates;
DROP TABLE IF EXISTS metric_model_runs;

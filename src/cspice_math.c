#include "cspice_math.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <math.h>
#include <float.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include "SpiceUsr.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

typedef struct {
    const char *name;
    double lat;
    double lon;
    double alt_m;
} CandidateSite;

static const CandidateSite CANDIDATE_SITES[] = {
    /* NASA reference region centres, shared with the Navigator catalogue.
       Heights default to the reference sphere unless supplied by the caller. */
    {"Shackleton Rim",   -89.7668, -171.87,    0.0},
    {"Connecting Ridge", -89.4632, -137.49,    0.0},
    {"Malapert Massif",  -85.9948,   -0.23578, 0.0},
    {"Nobile Rim 1",     -85.4381,   37.36667, 0.0},
    {"Haworth",          -86.7639,  -22.777,   0.0}
};
static const int NUM_CANDIDATE_SITES = 5;
static bool is_spice_initialized = false;

static bool path_exists(const char *path) {
    return (access(path, F_OK) == 0);
}

int init_spice_engine(const char *custom_kernel_dir) {
    if (is_spice_initialized) return 0;

    erract_c("SET", 0, "RETURN");

    const char *base_dir = NULL;
    if (custom_kernel_dir && path_exists(custom_kernel_dir)) {
        base_dir = custom_kernel_dir;
    } else if (path_exists("data/kernels/naif0012.tls")) {
        base_dir = "data/kernels";
    } else if (path_exists("../data/kernels/naif0012.tls")) {
        base_dir = "../data/kernels";
    } else {
        return -1;
    }

    char path_tls[512], path_pck[512], path_bsp[512];
    snprintf(path_tls, sizeof(path_tls), "%s/naif0012.tls", base_dir);
    snprintf(path_pck, sizeof(path_pck), "%s/pck00010.tpc", base_dir);
    snprintf(path_bsp, sizeof(path_bsp), "%s/de440s.bsp", base_dir);

    furnsh_c(path_tls);
    furnsh_c(path_pck);
    furnsh_c(path_bsp);

    if (failed_c()) {
        reset_c();
        return -1;
    }

    is_spice_initialized = true;
    return 0;
}

/* Optional latitude-major square grid of 360-float horizon profiles, -90..-80 deg.
   Without a valid local profile use the geometric horizon, keeping the result labeled. */
static bool load_horizon_mask(double lat, double lon, bool use_dem, double mask[HORIZON_BINS]) {
    memset(mask, 0, HORIZON_BINS * sizeof(*mask));
    if (!use_dem || lat < -90.0 || lat > -80.0) return false;

    int fd = open("data/lola_southpole.bin", O_RDONLY);
    if (fd < 0) fd = open("../data/lola_southpole.bin", O_RDONLY);
    if (fd < 0) return false;

    float profile[HORIZON_BINS];
    struct stat st;
    bool valid = false;
    if (fstat(fd, &st) == 0 && S_ISREG(st.st_mode) &&
        st.st_size > 0 && st.st_size % (off_t)sizeof(profile) == 0) {
        size_t records = (size_t)(st.st_size / (off_t)sizeof(profile));
        size_t side = (size_t)sqrt((double)records);
        if (side * side == records) {
            size_t row = (size_t)fmin((lat + 90.0) / 10.0 * side, (double)(side - 1));
            double east = fmod(fmod(lon, 360.0) + 360.0, 360.0);
            size_t col = (size_t)(east / 360.0 * side);
            off_t offset = (off_t)((row * side + col) * sizeof(profile));
            valid = pread(fd, profile, sizeof(profile), offset) == (ssize_t)sizeof(profile);
            for (int i = 0; valid && i < HORIZON_BINS; ++i)
                valid = isfinite(profile[i]) && fabs(profile[i]) <= 90.0;
        }
    }
    close(fd);
    if (valid) {
        for (int i = 0; i < HORIZON_BINS; ++i) mask[i] = profile[i];
    }
    return valid;
}

// Count elapsed SI seconds in TAI. UTC leap seconds are real elapsed time;
// ET/TDB has a periodic rate offset and is used only for SPICE geometry.
typedef struct {
    double start_tai;
    double duration_seconds;
    int step_seconds;
    int count;
} TimeGrid;

static void close_window(VisibilityWindow *window, const TimeGrid *grid,
                         double begin_offset, double end_offset) {
    double begin_et = unitim_c(grid->start_tai + begin_offset, "TAI", "ET");
    double end_et = unitim_c(grid->start_tai + end_offset, "TAI", "ET");
    et2utc_c(begin_et, "ISOC", 0, sizeof(window->start_utc), window->start_utc);
    et2utc_c(end_et, "ISOC", 0, sizeof(window->end_utc), window->end_utc);
    window->duration_hours = (end_offset - begin_offset) / 3600.0;
}

static int simulate_single_site(
    const char *site_name,
    double lat,
    double lon,
    double altitude_m,
    const TimeGrid *grid,
    bool use_dem_horizon,
    double min_sun_el_deg,
    double min_earth_el_deg,
    bool include_earth_disk,
    SiteSummary *out_summary,
    double out_mask[HORIZON_BINS],
    bool *out_used_real_dem,
    TimeSample *out_samples,
    VisibilityWindow **out_sun_windows,
    int *out_sun_win_count,
    VisibilityWindow **out_earth_windows,
    int *out_earth_win_count
) {
    strncpy(out_summary->site_name, site_name, sizeof(out_summary->site_name) - 1);
    out_summary->site_name[sizeof(out_summary->site_name) - 1] = '\0';
    out_summary->latitude_deg = lat;
    out_summary->longitude_deg = lon;
    out_summary->altitude_m = altitude_m;

    double local_mask[HORIZON_BINS];
    bool real_dem = load_horizon_mask(lat, lon, use_dem_horizon, local_mask);
    if (out_used_real_dem) *out_used_real_dem = real_dem;
    if (out_mask) {
        memcpy(out_mask, local_mask, sizeof(local_mask));
    }

    double radius_km = 1737.4 + (altitude_m / 1000.0);
    SpiceDouble site_pos[3];
    latrec_c(radius_km, lon * rpd_c(), lat * rpd_c(), site_pos);

    /* The bundled PCK defines a spherical Moon. Longitude fixes the local
       reference meridian even at a pole, where an ellipsoid tangent frame is singular. */
    double lat_r = lat * rpd_c(), lon_r = lon * rpd_c();
    double east[3] = {-sin(lon_r), cos(lon_r), 0.0};
    double north[3] = {-sin(lat_r) * cos(lon_r), -sin(lat_r) * sin(lon_r), cos(lat_r)};
    double up[3] = {cos(lat_r) * cos(lon_r), cos(lat_r) * sin(lon_r), sin(lat_r)};

    double sun_seconds = 0.0, earth_seconds = 0.0, overlap_seconds = 0.0;
    double cur_sun_streak = 0.0, max_sun_streak = 0.0;
    double cur_earth_streak = 0.0, max_earth_streak = 0.0;
    double cur_dark_streak = 0.0, max_dark_streak = 0.0;
    double sun_el_sum = 0.0, earth_el_sum = 0.0;

    bool prev_sun_vis = false;
    bool prev_earth_vis = false;
    int sun_win_count = 0;
    int earth_win_count = 0;

    VisibilityWindow *sun_wins = NULL;
    VisibilityWindow *earth_wins = NULL;
    if (out_sun_windows && out_earth_windows) {
        size_t max_wins = (size_t)(grid->count / 2 + 2);
        sun_wins = (VisibilityWindow *)calloc(max_wins, sizeof(VisibilityWindow));
        earth_wins = (VisibilityWindow *)calloc(max_wins, sizeof(VisibilityWindow));
        if (!sun_wins || !earth_wins) {
            free(sun_wins);
            free(earth_wins);
            return -1;
        }
    }

    double sun_win_begin = 0.0;
    double earth_win_begin = 0.0;

    // A left-edge sample describes only its part of [start_utc, end_utc).
    for (int s = 0; s < grid->count; s++) {
        double offset = (double)s * grid->step_seconds;
        double seconds = fmin(grid->step_seconds, grid->duration_seconds - offset);
        SpiceDouble current_et = unitim_c(grid->start_tai + offset, "TAI", "ET");
        SpiceDouble sun[6], earth[6], lt;
        spkcpo_c("SUN", current_et, "IAU_MOON", "OBSERVER", "LT+S",
                 site_pos, "MOON", "IAU_MOON", sun, &lt);
        spkcpo_c("EARTH", current_et, "IAU_MOON", "OBSERVER", "LT+S",
                 site_pos, "MOON", "IAU_MOON", earth, &lt);
        if (failed_c()) {
            reset_c();
            free(sun_wins);
            free(earth_wins);
            return -1;
        }

        double sun_e = vdot_c(sun, east), sun_n = vdot_c(sun, north);
        double earth_e = vdot_c(earth, east), earth_n = vdot_c(earth, north);
        double sun_az = fmod(atan2(sun_e, sun_n) * dpr_c() + 360.0, 360.0);
        double earth_az = fmod(atan2(earth_e, earth_n) * dpr_c() + 360.0, 360.0);
        double sun_el = atan2(vdot_c(sun, up), hypot(sun_e, sun_n)) * dpr_c();
        double earth_el = atan2(vdot_c(earth, up), hypot(earth_e, earth_n)) * dpr_c();
        double earth_range_km = vnorm_c(earth);
        double earth_disk_bonus_deg = 0.0;
        if (include_earth_disk && earth_range_km > 6378.137) {
            earth_disk_bonus_deg = asin(6378.137 / earth_range_km) * dpr_c();
        }

        int sun_bin = ((int)floor(sun_az)) % HORIZON_BINS;
        if (sun_bin < 0) sun_bin += HORIZON_BINS;

        int earth_bin = ((int)floor(earth_az)) % HORIZON_BINS;
        if (earth_bin < 0) earth_bin += HORIZON_BINS;

        double sun_terrain_deg = local_mask[sun_bin];
        double earth_terrain_deg = local_mask[earth_bin];

        double effective_sun_limit = fmax(sun_terrain_deg, min_sun_el_deg);
        double effective_earth_limit = fmax(earth_terrain_deg, min_earth_el_deg);

        bool is_sun_vis = (sun_el > effective_sun_limit);
        bool is_earth_vis = ((earth_el + earth_disk_bonus_deg) > effective_earth_limit);

        if (is_sun_vis) {
            sun_seconds += seconds;
            cur_sun_streak += seconds;
            if (cur_sun_streak > max_sun_streak) max_sun_streak = cur_sun_streak;
            cur_dark_streak = 0;

            if (!prev_sun_vis) {
                sun_win_begin = offset;
            }
        } else {
            cur_dark_streak += seconds;
            if (cur_dark_streak > max_dark_streak) max_dark_streak = cur_dark_streak;
            cur_sun_streak = 0;

            if (prev_sun_vis && sun_wins) {
                close_window(&sun_wins[sun_win_count], grid, sun_win_begin, offset);
                sun_win_count++;
            }
        }
        prev_sun_vis = is_sun_vis;

        if (is_earth_vis) {
            earth_seconds += seconds;
            cur_earth_streak += seconds;
            if (cur_earth_streak > max_earth_streak) max_earth_streak = cur_earth_streak;

            if (!prev_earth_vis) {
                earth_win_begin = offset;
            }
        } else {
            cur_earth_streak = 0;
            if (prev_earth_vis && earth_wins) {
                close_window(&earth_wins[earth_win_count], grid, earth_win_begin, offset);
                earth_win_count++;
            } else if (prev_earth_vis) {
                earth_win_count++;
            }
        }
        prev_earth_vis = is_earth_vis;

        if (is_sun_vis && is_earth_vis) {
            overlap_seconds += seconds;
        }

        sun_el_sum += sun_el * seconds;
        earth_el_sum += earth_el * seconds;

        if (out_samples != NULL) {
            out_samples[s].step_index = s;
            et2utc_c(current_et, "ISOC", 0, sizeof(out_samples[s].utc), out_samples[s].utc);
            out_samples[s].et_seconds = current_et;
            out_samples[s].sun_azimuth_deg = sun_az;
            out_samples[s].sun_elevation_deg = sun_el;
            out_samples[s].earth_azimuth_deg = earth_az;
            out_samples[s].earth_elevation_deg = earth_el;
            out_samples[s].sun_terrain_horizon_deg = sun_terrain_deg;
            out_samples[s].earth_terrain_horizon_deg = earth_terrain_deg;
            out_samples[s].is_sun_visible = is_sun_vis;
            out_samples[s].is_earth_visible = is_earth_vis;
        }
    }

    if (prev_sun_vis && sun_wins) {
        close_window(&sun_wins[sun_win_count++], grid, sun_win_begin, grid->duration_seconds);
    }
    if (prev_earth_vis) {
        if (earth_wins) {
            close_window(&earth_wins[earth_win_count], grid, earth_win_begin, grid->duration_seconds);
        }
        earth_win_count++;
    }

    if (out_sun_windows && out_sun_win_count) {
        *out_sun_windows = sun_wins;
        *out_sun_win_count = sun_win_count;
    }
    if (out_earth_windows && out_earth_win_count) {
        *out_earth_windows = earth_wins;
        *out_earth_win_count = earth_win_count;
    }

    out_summary->total_sun_hours = sun_seconds / 3600.0;
    out_summary->illumination_percent = (sun_seconds / grid->duration_seconds) * 100.0;
    out_summary->longest_sun_hours = max_sun_streak / 3600.0;

    out_summary->total_earth_hours = earth_seconds / 3600.0;
    out_summary->earth_visibility_percent = (earth_seconds / grid->duration_seconds) * 100.0;
    out_summary->longest_earth_hours = max_earth_streak / 3600.0;
    out_summary->dte_window_count = earth_win_count;

    out_summary->overlap_hours = overlap_seconds / 3600.0;
    out_summary->longest_dark_hours = max_dark_streak / 3600.0;
    out_summary->avg_sun_elevation_deg = sun_el_sum / grid->duration_seconds;
    out_summary->avg_earth_elevation_deg = earth_el_sum / grid->duration_seconds;

    double illum_score = out_summary->illumination_percent * 0.50;
    double earth_score = out_summary->earth_visibility_percent * 0.30;
    double dark_ratio = max_dark_streak / grid->duration_seconds;
    double dark_score = (1.0 - dark_ratio) * 20.0;

    int raw_score = (int)round(illum_score + earth_score + dark_score);
    if (raw_score > 100) raw_score = 100;
    if (raw_score < 0) raw_score = 0;
    out_summary->mission_score = raw_score;

    return 0;
}

SimulationResult run_lunar_simulation(
    const char *site_name,
    double lat_deg,
    double lon_deg,
    double altitude_m,
    bool use_custom_coords,
    const char *start_utc,
    const char *end_utc,
    int step_seconds,
    bool use_dem_horizon,
    double min_sun_el_deg,
    double min_earth_el_deg,
    bool include_earth_disk
) {
    SimulationResult res;
    memset(&res, 0, sizeof(SimulationResult));

    if (init_spice_engine(NULL) != 0) {
        res.status = -1;
        snprintf(res.error_msg, sizeof(res.error_msg), "NASA SPICE kernelleri yüklenemedi.");
        return res;
    }

    if (step_seconds < 60 || !start_utc || !*start_utc || !end_utc || !*end_utc) {
        res.status = -1;
        snprintf(res.error_msg, sizeof(res.error_msg),
                 "Başlangıç ve bitiş UTC değerleri ile en az 60 saniyelik adım gereklidir.");
        return res;
    }
    res.step_seconds = step_seconds;
    SpiceDouble start_et, end_et;
    str2et_c(start_utc, &start_et);
    str2et_c(end_utc, &end_et);
    if (failed_c()) {
        getmsg_c("SHORT", sizeof(res.error_msg), res.error_msg);
        reset_c();
        res.status = -1;
        return res;
    }
    double start_tai = unitim_c(start_et, "ET", "TAI");
    double end_tai = unitim_c(end_et, "ET", "TAI");
    double duration = end_tai - start_tai;
    if (!isfinite(duration) || duration <= 0) {
        res.status = -1;
        snprintf(res.error_msg, sizeof(res.error_msg), "Bitiş zamanı başlangıçtan sonra olmalıdır.");
        return res;
    }
    // Remove only floating-point round-trip error at a grid boundary.
    double nearest = round(duration / step_seconds) * step_seconds;
    double tolerance = 4 * DBL_EPSILON * fmax(1.0, fmax(fabs(start_tai), fabs(end_tai)));
    if (nearest > 0.0 && fabs(duration - nearest) <= tolerance) duration = nearest;
    double count = ceil(duration / step_seconds);
    if (count > MAX_SIMULATION_STEPS) {
        res.status = -1;
        snprintf(res.error_msg, sizeof(res.error_msg),
                 "Görev aralığı %d örneği aşıyor; süreyi kısaltın veya adımı büyütün.", MAX_SIMULATION_STEPS);
        return res;
    }
    TimeGrid grid = { start_tai, duration, step_seconds, (int)count };
    int total_steps = grid.count;

    double target_lat = lat_deg;
    double target_lon = lon_deg;
    double target_alt = altitude_m;
    const char *resolved_name = (site_name && strlen(site_name) > 0) ? site_name : "Custom Site";

    // Yalnızca özel koordinat verilmemişse aday saha tablosundan koordinat çek
    if (!use_custom_coords) {
        bool found = false;
        for (int i = 0; i < NUM_CANDIDATE_SITES; i++) {
            if (strcasecmp(resolved_name, CANDIDATE_SITES[i].name) == 0) {
                found = true;
                target_lat = CANDIDATE_SITES[i].lat;
                target_lon = CANDIDATE_SITES[i].lon;
                if (target_alt == 0.0) target_alt = CANDIDATE_SITES[i].alt_m;
                break;
            }
        }
        if (!found) {
            res.status = -1;
            snprintf(res.error_msg, sizeof(res.error_msg), "Unknown named landing site.");
            return res;
        }
    }

    if (use_dem_horizon && (target_lat < -90.0 || target_lat > -80.0)) {
        res.dem_out_of_bounds = true;
        snprintf(res.warning_msg, sizeof(res.warning_msg),
                 "UYARI: Seçilen koordinat (%.2f°) Güney Kutbu DEM kapsama alanı (-80°..-90°) dışında.",
                 target_lat);
    }

    res.samples = (TimeSample *)calloc((size_t)total_steps, sizeof(TimeSample));
    if (!res.samples) {
        res.status = -1;
        snprintf(res.error_msg, sizeof(res.error_msg), "Bellek tahsis hatası.");
        return res;
    }
    res.total_steps = total_steps;

    if (simulate_single_site(
            resolved_name, target_lat, target_lon, target_alt,
            &grid,
            use_dem_horizon, min_sun_el_deg, min_earth_el_deg, include_earth_disk,
            &res.summary, res.terrain_horizon_mask, &res.using_real_dem, res.samples,
            &res.sun_windows, &res.sun_window_count,
            &res.earth_windows, &res.earth_window_count) != 0) {
        free_simulation_result(&res);
        res.status = -1;
        snprintf(res.error_msg, sizeof(res.error_msg), "SPICE hesaplama hatası.");
        return res;
    }

    if (use_dem_horizon && !res.using_real_dem && strlen(res.warning_msg) == 0) {
        snprintf(res.warning_msg, sizeof(res.warning_msg),
                 "BİLGİ: data/lola_southpole.bin eksik veya geçersiz; geometrik ufuk kullanıldı.");
    }

    res.comparison_count = NUM_CANDIDATE_SITES;
    for (int i = 0; i < NUM_CANDIDATE_SITES; i++) {
        if (simulate_single_site(
            CANDIDATE_SITES[i].name, CANDIDATE_SITES[i].lat, CANDIDATE_SITES[i].lon, CANDIDATE_SITES[i].alt_m,
            &grid,
            use_dem_horizon, min_sun_el_deg, min_earth_el_deg, include_earth_disk,
            &res.comparisons[i], NULL, NULL, NULL, NULL, NULL, NULL, NULL
        ) != 0) {
            free_simulation_result(&res);
            res.status = -1;
            snprintf(res.error_msg, sizeof(res.error_msg), "Candidate site calculation failed.");
            return res;
        }
    }

    res.status = 0;
    return res;
}

void free_simulation_result(SimulationResult *res) {
    if (!res) return;
    free(res->samples);
    free(res->sun_windows);
    free(res->earth_windows);
    res->samples = NULL;
    res->sun_windows = NULL;
    res->earth_windows = NULL;
    res->total_steps = 0;
}
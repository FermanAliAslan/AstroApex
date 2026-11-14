// src/main.c
#include <stdio.h>
#include <errno.h>
#include <signal.h>
#include <strings.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <arpa/inet.h>

#include <lua.h>
#include <lualib.h>
#include <lauxlib.h>

#include "cspice_math.h"

#define PORT 8080

static lua_State *L = NULL;

static void push_site_summary_to_lua(lua_State *L_vm, const SiteSummary *s) {
    lua_newtable(L_vm);

    lua_pushstring(L_vm, s->site_name);
    lua_setfield(L_vm, -2, "site_name");

    lua_pushnumber(L_vm, s->latitude_deg);
    lua_setfield(L_vm, -2, "latitude_deg");

    lua_pushnumber(L_vm, s->longitude_deg);
    lua_setfield(L_vm, -2, "longitude_deg");

    lua_pushnumber(L_vm, s->altitude_m);
    lua_setfield(L_vm, -2, "altitude_m");

    lua_pushnumber(L_vm, s->total_sun_hours);
    lua_setfield(L_vm, -2, "total_sun_hours");

    lua_pushnumber(L_vm, s->illumination_percent);
    lua_setfield(L_vm, -2, "illumination_percent");

    lua_pushnumber(L_vm, s->longest_sun_hours);
    lua_setfield(L_vm, -2, "longest_sun_hours");

    lua_pushnumber(L_vm, s->total_earth_hours);
    lua_setfield(L_vm, -2, "total_earth_hours");

    lua_pushnumber(L_vm, s->earth_visibility_percent);
    lua_setfield(L_vm, -2, "earth_visibility_percent");

    lua_pushnumber(L_vm, s->longest_earth_hours);
    lua_setfield(L_vm, -2, "longest_earth_hours");

    lua_pushinteger(L_vm, s->dte_window_count);
    lua_setfield(L_vm, -2, "dte_window_count");

    lua_pushnumber(L_vm, s->overlap_hours);
    lua_setfield(L_vm, -2, "overlap_hours");

    lua_pushnumber(L_vm, s->longest_dark_hours);
    lua_setfield(L_vm, -2, "longest_dark_hours");

    lua_pushnumber(L_vm, s->avg_sun_elevation_deg);
    lua_setfield(L_vm, -2, "avg_sun_elevation_deg");

    lua_pushnumber(L_vm, s->avg_earth_elevation_deg);
    lua_setfield(L_vm, -2, "avg_earth_elevation_deg");

    lua_pushinteger(L_vm, s->mission_score);
    lua_setfield(L_vm, -2, "mission_score");
}

static void push_windows_to_lua(lua_State *L_vm, const VisibilityWindow *wins, int count) {
    lua_newtable(L_vm);
    for (int i = 0; i < count; i++) {
        lua_newtable(L_vm);
        lua_pushstring(L_vm, wins[i].start_utc);
        lua_setfield(L_vm, -2, "start_utc");
        lua_pushstring(L_vm, wins[i].end_utc);
        lua_setfield(L_vm, -2, "end_utc");
        lua_pushnumber(L_vm, wins[i].duration_hours);
        lua_setfield(L_vm, -2, "duration_hours");
        lua_rawseti(L_vm, -2, i + 1);
    }
}

static int l_nasa_compute_c(lua_State *L_vm) {
    luaL_checktype(L_vm, 1, LUA_TTABLE);

    lua_getfield(L_vm, 1, "site_name");
    const char *site_name = luaL_optstring(L_vm, -1, "Shackleton Rim");

    lua_getfield(L_vm, 1, "latitude_deg");
    double lat = luaL_optnumber(L_vm, -1, -89.90);

    lua_getfield(L_vm, 1, "longitude_deg");
    double lon = luaL_optnumber(L_vm, -1, 0.00);

    lua_getfield(L_vm, 1, "altitude_m");
    double alt_m = luaL_optnumber(L_vm, -1, 0.0);

    lua_getfield(L_vm, 1, "use_custom");
    bool use_custom = lua_toboolean(L_vm, -1);

    lua_getfield(L_vm, 1, "start_utc");
    const char *start_utc = luaL_optstring(L_vm, -1, "2026-10-18T00:00:00");

    lua_getfield(L_vm, 1, "end_utc");
    const char *end_utc = luaL_optstring(L_vm, -1, "2026-11-01T00:00:00");

    lua_getfield(L_vm, 1, "step_seconds");
    int step_seconds = (int)luaL_optinteger(L_vm, -1, 3600);

    lua_getfield(L_vm, 1, "use_dem_horizon");
    bool use_dem = lua_isnil(L_vm, -1) ? true : lua_toboolean(L_vm, -1);

    lua_getfield(L_vm, 1, "min_sun_elevation_deg");
    double min_sun_el = luaL_optnumber(L_vm, -1, 0.0);

    lua_getfield(L_vm, 1, "min_earth_elevation_deg");
    double min_earth_el = luaL_optnumber(L_vm, -1, 0.0);

    lua_getfield(L_vm, 1, "include_earth_disk");
    bool include_disk = lua_toboolean(L_vm, -1);

    SimulationResult res = run_lunar_simulation(
        site_name, lat, lon, alt_m, use_custom,
        start_utc, end_utc, step_seconds,
        use_dem, min_sun_el, min_earth_el, include_disk
    );

    lua_pop(L_vm, 12);

    luaL_checkstack(L_vm, 20, "Lua stack yetersiz");
    lua_newtable(L_vm);

    lua_pushinteger(L_vm, res.status);
    lua_setfield(L_vm, -2, "status_code");

    if (res.status != 0) {
        lua_pushstring(L_vm, res.error_msg);
        lua_setfield(L_vm, -2, "error_msg");
        return 1;
    }

    lua_pushboolean(L_vm, res.using_real_dem);
    lua_setfield(L_vm, -2, "using_real_dem");

    lua_pushboolean(L_vm, res.dem_out_of_bounds);
    lua_setfield(L_vm, -2, "dem_out_of_bounds");

    lua_pushstring(L_vm, res.warning_msg);
    lua_setfield(L_vm, -2, "warning_msg");

    push_site_summary_to_lua(L_vm, &res.summary);
    lua_setfield(L_vm, -2, "summary");

    push_windows_to_lua(L_vm, res.sun_windows, res.sun_window_count);
    lua_setfield(L_vm, -2, "sun_windows");

    push_windows_to_lua(L_vm, res.earth_windows, res.earth_window_count);
    lua_setfield(L_vm, -2, "earth_windows");

    lua_newtable(L_vm);
    for (int i = 0; i < HORIZON_BINS; i++) {
        lua_pushnumber(L_vm, res.terrain_horizon_mask[i]);
        lua_rawseti(L_vm, -2, i + 1);
    }
    lua_setfield(L_vm, -2, "terrain_horizon_mask");

    lua_newtable(L_vm);
    for (int s = 0; s < res.total_steps; s++) {
        TimeSample *t = &res.samples[s];
        lua_newtable(L_vm);

        lua_pushinteger(L_vm, t->step_index);
        lua_setfield(L_vm, -2, "step_index");

        lua_pushstring(L_vm, t->utc);
        lua_setfield(L_vm, -2, "utc");

        lua_pushnumber(L_vm, t->sun_azimuth_deg);
        lua_setfield(L_vm, -2, "sun_azimuth_deg");

        lua_pushnumber(L_vm, t->sun_elevation_deg);
        lua_setfield(L_vm, -2, "sun_elevation_deg");

        lua_pushnumber(L_vm, t->earth_azimuth_deg);
        lua_setfield(L_vm, -2, "earth_azimuth_deg");

        lua_pushnumber(L_vm, t->earth_elevation_deg);
        lua_setfield(L_vm, -2, "earth_elevation_deg");

        lua_pushnumber(L_vm, t->sun_terrain_horizon_deg);
        lua_setfield(L_vm, -2, "sun_terrain_horizon_deg");

        lua_pushnumber(L_vm, t->earth_terrain_horizon_deg);
        lua_setfield(L_vm, -2, "earth_terrain_horizon_deg");

        lua_pushboolean(L_vm, t->is_sun_visible);
        lua_setfield(L_vm, -2, "is_sun_visible");

        lua_pushboolean(L_vm, t->is_earth_visible);
        lua_setfield(L_vm, -2, "is_earth_visible");

        lua_rawseti(L_vm, -2, s + 1);
    }
    lua_setfield(L_vm, -2, "samples");

    lua_newtable(L_vm);
    for (int i = 0; i < res.comparison_count; i++) {
        push_site_summary_to_lua(L_vm, &res.comparisons[i]);
        lua_rawseti(L_vm, -2, i + 1);
    }
    lua_setfield(L_vm, -2, "site_comparison");

    free_simulation_result(&res);
    return 1;
}

static char *execute_lua_pipeline(const char *json_request, int *status) {
    lua_getglobal(L, "handle_simulation_json");
    lua_pushstring(L, json_request);
    if (lua_pcall(L, 1, 2, 0) != LUA_OK) {
        fprintf(stderr, "[LUA] %s\n", lua_tostring(L, -1));
        lua_pop(L, 1);
        *status = 500;
        return NULL;
    }

    const char *json = lua_tostring(L, -2);
    char *copy = json ? strdup(json) : NULL;
    *status = copy ? (int)lua_tointeger(L, -1) : 500;
    lua_pop(L, 2);
    return copy;
}

/* Only the CLI publishes a snapshot. The temp file lives beside the target so
 * readers see either the previous complete JSON or the new complete JSON. */
static int save_snapshot(const char *path, const char *json) {
    char temp[128];
    int len = snprintf(temp, sizeof(temp), "%s.XXXXXX", path);
    if (len < 0 || (size_t)len >= sizeof(temp)) { errno = ENAMETOOLONG; return -1; }
    int fd = mkstemp(temp);
    if (fd < 0) return -1;
    FILE *fp = fdopen(fd, "wb");
    int error = 0;
    if (!fp) {
        error = errno;
        close(fd);
    } else {
        if (fputs(json, fp) == EOF || fflush(fp) != 0 || fsync(fd) != 0) error = errno;
        if (fclose(fp) != 0 && !error) error = errno;
    }
    if (!error && rename(temp, path) != 0) error = errno;
    if (error) {
        unlink(temp);
        errno = error;
        return -1;
    }
    return 0;
}

static int run_once(bool from_root) {
    const char *input = from_root ? "data/input.json" : "../data/input.json";
    const char *output = from_root ? "data/output.json" : "../data/output.json";
    char *request = NULL;
    FILE *fp = fopen(input, "rb");
    if (!fp && errno != ENOENT) { perror(input); return 1; }
    if (fp) {
        long length;
        if (fseek(fp, 0, SEEK_END) != 0 || (length = ftell(fp)) < 0 ||
            fseek(fp, 0, SEEK_SET) != 0 || !(request = malloc((size_t)length + 1))) {
            perror(input); fclose(fp); return 1;
        }
        size_t got = fread(request, 1, (size_t)length, fp);
        int failed = ferror(fp) || got != (size_t)length || memchr(request, 0, got) != NULL;
        fclose(fp);
        if (failed) { fprintf(stderr, "Cannot read JSON from %s\n", input); free(request); return 1; }
        request[got] = '\0';
    }
    int status;
    char *json = execute_lua_pipeline(request ? request : "{}", &status);
    free(request);
    int result = 1;
    if (!json || status != 200) {
        fprintf(stderr, "[CLI] %s\n", json ? json : "Internal calculation error");
    } else if (save_snapshot(output, json) != 0) {
        perror(output);
    } else {
        printf("[CLI] %s (%zu bytes)\n", output, strlen(json));
        result = 0;
    }
    free(json);
    return result;
}

static void write_all(int socket_fd, const char *data, size_t length) {
    while (length > 0) {
        ssize_t written = write(socket_fd, data, length);
        if (written < 0 && errno == EINTR) continue;
        if (written <= 0) return;
        data += written;
        length -= (size_t)written;
    }
}

static void send_response(int socket_fd, int status, const char *json) {
    const char *reason = status == 200 ? "OK" : status == 204 ? "No Content" :
        status == 400 ? "Bad Request" : status == 404 ? "Not Found" :
        status == 411 ? "Length Required" : status == 413 ? "Content Too Large" :
        status == 422 ? "Unprocessable Content" : "Internal Server Error";
    char header[512];
    int n = snprintf(header, sizeof(header),
        "HTTP/1.1 %d %s\r\nConnection: close\r\n"
        "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\nContent-Type: application/json; charset=utf-8\r\n"
        "Content-Length: %zu\r\n\r\n", status, reason, strlen(json));
    write_all(socket_fd, header, (size_t)n);
    write_all(socket_fd, json, strlen(json));
}

static ssize_t read_chunk(int fd, char *buffer, size_t size) {
    ssize_t n;
    do { n = read(fd, buffer, size); } while (n < 0 && errno == EINTR);
    return n;
}

/* The local API accepts bounded, length-delimited JSON. Read to the declared
 * length, since a normal browser can send headers and body separately. */
static void handle_client(int fd) {
    char buffer[8192];
    size_t received = 0;
    char *body = NULL;
    while (received < sizeof(buffer) - 1) {
        ssize_t n = read_chunk(fd, buffer + received, sizeof(buffer) - 1 - received);
        if (n <= 0) goto bad_request;
        received += (size_t)n;
        buffer[received] = '\0';
        body = strstr(buffer, "\r\n\r\n");
        if (body) break;
    }
    if (!body) goto too_large;

    *body = '\0';
    body += 4;
    if (strncmp(buffer, "OPTIONS /api/calculate HTTP/", 28) == 0) {
        send_response(fd, 204, "");
        goto done;
    }
    if (strncmp(buffer, "POST /api/calculate HTTP/", 25) != 0) {
        send_response(fd, 404, "{\"status\":\"ERROR\",\"message\":\"Unknown endpoint\"}");
        goto done;
    }

    long length = -1;
    char *line = strstr(buffer, "\r\n");
    while (line) {
        line += 2;
        char *next = strstr(line, "\r\n");
        if (next) *next = '\0';
        if (strncasecmp(line, "Content-Length:", 15) == 0) {
            char *end;
            const char *number = line + 15;
            while (*number == ' ' || *number == '\t') number++;
            if (length != -1 || *number < '0' || *number > '9') goto bad_request;
            errno = 0;
            length = strtol(number, &end, 10);
            while (*end == ' ' || *end == '\t') end++;
            if (*end != '\0' || errno != 0) goto bad_request;
        }
        line = next;
    }
    if (length < 0) {
        send_response(fd, 411, "{\"status\":\"ERROR\",\"message\":\"Content-Length required\"}");
        goto done;
    }
    size_t available = sizeof(buffer) - (size_t)(body - buffer) - 1;
    if ((size_t)length > available) goto too_large;
    size_t have = received - (size_t)(body - buffer);
    while (have < (size_t)length) {
        ssize_t n = read_chunk(fd, body + have, (size_t)length - have);
        if (n <= 0) goto bad_request;
        have += (size_t)n;
    }
    if (memchr(body, 0, (size_t)length)) goto bad_request;
    body[length] = '\0';
    int status;
    char *response = execute_lua_pipeline(body, &status);
    send_response(fd, status, response ? response : "{\"status\":\"ERROR\",\"message\":\"Internal calculation error\"}");
    free(response);
    goto done;
bad_request:
    send_response(fd, 400, "{\"status\":\"ERROR\",\"message\":\"Invalid request\"}");
    goto done;
too_large:
    send_response(fd, 413, "{\"status\":\"ERROR\",\"message\":\"Request exceeds 8 KiB limit\"}");
done:
    close(fd);
}

int main(int argc, char **argv) {
    if (init_spice_engine(NULL) != 0) {
        fprintf(stderr, "[HATA] NASA SPICE motoru başlatılamadı.\n");
        return 1;
    }

    L = luaL_newstate();
    luaL_openlibs(L);
    lua_register(L, "nasa_compute_c", l_nasa_compute_c);

    bool from_root = access("lua/main.lua", F_OK) == 0;
    const char *lua_script = from_root ? "lua/main.lua" : "../lua/main.lua";
    if (luaL_dofile(L, lua_script) != LUA_OK) {
        fprintf(stderr, "[HATA] Lua script yüklenemedi: %s\n", lua_tostring(L, -1));
        lua_close(L);
        return 1;
    }

    // 1. CLI Modu (--once): data/input.json dosyasını okur, data/output.json üretir ve çıkar
    if (argc > 1 && strcmp(argv[1], "--once") == 0) {
        int result = run_once(from_root);
        lua_close(L);
        return result;
    }

    signal(SIGPIPE, SIG_IGN);
    // 2. HTTP API Sunucu Modu (8080 Portu)
    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in address;
    memset(&address, 0, sizeof(address));
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(PORT);

    if (bind(server_fd, (struct sockaddr *)&address, sizeof(address)) < 0) {
        perror("[HATA] Port 8080 bağlanamadı");
        lua_close(L);
        return 1;
    }

    listen(server_fd, 16);
    printf("[C+LUA ENGINE] Mission Planner API http://localhost:%d adresinde hazır!\n", PORT);

    while (1) {
        socklen_t addrlen = sizeof(address);
        int client_socket = accept(server_fd, (struct sockaddr *)&address, &addrlen);
        if (client_socket >= 0) {
            handle_client(client_socket);
        }
    }

    lua_close(L);
    return 0;
}
-- Lua orchestrator for the mission request/response contract.
local source = debug.getinfo(1, "S").source
local directory = source:match("^@(.*/)") or "lua/"
local decode_json = dofile(directory .. "json.lua")()
local json_null = {}

local function json_escape(value)
    return (tostring(value):gsub('[%z\1-\31\\"]', function(char)
        if char == '"' then return '\\"' end
        if char == '\\' then return '\\\\' end
        return string.format("\\u%04x", string.byte(char))
    end))
end

local function serialize_windows(win_list)
    local items = {}
    for i = 1, #win_list do
        local w = win_list[i]
        items[i] = string.format(
            '{"start_utc": "%s", "end_utc": "%s", "duration_hours": %.2f}',
            json_escape(w.start_utc), json_escape(w.end_utc), w.duration_hours
        )
    end
    return "[" .. table.concat(items, ", ") .. "]"
end

local function build_contract_json(c_res, req)
    local s = c_res.summary
    local buf = {}
    local function add(str) buf[#buf + 1] = str end

    local dem_label = "GEOMETRIC_HORIZON_ONLY"
    if req.use_dem_horizon then
        dem_label = c_res.using_real_dem and "LOLA_SOUTH_POLE_DEM" or "GEOMETRIC_HORIZON_FALLBACK"
    end

    add('{\n')
    add('  "status": "SUCCESS",\n')
    add(string.format('  "using_real_dem": %s,\n', tostring(c_res.using_real_dem)))
    add(string.format('  "dem_out_of_bounds": %s,\n', tostring(c_res.dem_out_of_bounds)))
    add(string.format('  "warning_msg": "%s",\n', json_escape(c_res.warning_msg or "")))

    add('  "meta": {\n')
    add(string.format('    "site_name": "%s",\n', json_escape(s.site_name)))
    add(string.format('    "latitude_deg": %.4f,\n', s.latitude_deg))
    add(string.format('    "longitude_deg": %.4f,\n', s.longitude_deg))
    add(string.format('    "altitude_m": %.1f,\n', s.altitude_m))
    add(string.format('    "start_utc": "%s",\n', json_escape(req.start_utc)))
    add(string.format('    "end_utc": "%s",\n', json_escape(req.end_utc)))
    add(string.format('    "step_seconds": %d,\n', req.step_seconds))
    add(string.format('    "use_dem_horizon": %s,\n', tostring(req.use_dem_horizon)))
    add(string.format('    "min_sun_elevation_deg": %.2f,\n', req.min_sun_elevation_deg))
    add(string.format('    "min_earth_elevation_deg": %.2f,\n', req.min_earth_elevation_deg))
    add(string.format('    "earth_visibility_model": "%s",\n', req.include_earth_disk and "EARTH_LIMB_DISK (~0.95 deg radius)" or "EARTH_CENTER_POINT"))
    add('    "spice_kernels": ["naif0012.tls", "de440s.bsp", "pck00010.tpc"],\n')
    add(string.format('    "dem_info": {"name": "%s", "is_real_dem": %s, "coverage": "-90 to -80 deg", "bins": 360},\n', dem_label, tostring(c_res.using_real_dem)))
    add('    "score_weights": {"illumination": 0.50, "earth_visibility": 0.30, "low_darkness": 0.20}\n')
    add('  },\n')

    add('  "summary": {\n')
    add(string.format('    "total_sun_hours": %.2f,\n', s.total_sun_hours))
    add(string.format('    "illumination_percent": %.2f,\n', s.illumination_percent))
    add(string.format('    "longest_sun_hours": %.2f,\n', s.longest_sun_hours))
    add(string.format('    "total_earth_hours": %.2f,\n', s.total_earth_hours))
    add(string.format('    "earth_visibility_percent": %.2f,\n', s.earth_visibility_percent))
    add(string.format('    "longest_earth_hours": %.2f,\n', s.longest_earth_hours))
    add(string.format('    "dte_window_count": %d,\n', s.dte_window_count))
    add(string.format('    "overlap_hours": %.2f,\n', s.overlap_hours))
    add(string.format('    "longest_dark_hours": %.2f,\n', s.longest_dark_hours))
    add(string.format('    "avg_sun_elevation_deg": %.2f,\n', s.avg_sun_elevation_deg))
    add(string.format('    "avg_earth_elevation_deg": %.2f,\n', s.avg_earth_elevation_deg))
    add(string.format('    "mission_score": %d\n', s.mission_score))
    add('  },\n')

    add('  "windows": {\n')
    add('    "sun": ' .. serialize_windows(c_res.sun_windows) .. ',\n')
    add('    "earth": ' .. serialize_windows(c_res.earth_windows) .. '\n')
    add('  },\n')

    local mask_parts = {}
    for i = 1, #c_res.terrain_horizon_mask do
        mask_parts[i] = string.format("%.2f", c_res.terrain_horizon_mask[i])
    end
    add('  "terrain_horizon_mask": [' .. table.concat(mask_parts, ", ") .. '],\n')

    add('  "samples": [\n')
    local count = #c_res.samples
    for i = 1, count do
        local t = c_res.samples[i]
        local comma = (i < count) and "," or ""
        add(string.format(
            '    {"step_index": %d, "utc": "%s", "sun_azimuth_deg": %.2f, "sun_elevation_deg": %.2f, "earth_azimuth_deg": %.2f, "earth_elevation_deg": %.2f, "sun_terrain_horizon_deg": %.2f, "earth_terrain_horizon_deg": %.2f, "is_sun_visible": %s, "is_earth_visible": %s}%s\n',
            t.step_index, json_escape(t.utc),
            t.sun_azimuth_deg, t.sun_elevation_deg,
            t.earth_azimuth_deg, t.earth_elevation_deg,
            t.sun_terrain_horizon_deg, t.earth_terrain_horizon_deg,
            tostring(t.is_sun_visible), tostring(t.is_earth_visible), comma
        ))
    end
    add('  ],\n')

    add('  "site_comparison": [\n')
    local cmp_count = #c_res.site_comparison
    for i = 1, cmp_count do
        local c = c_res.site_comparison[i]
        local comma = (i < cmp_count) and "," or ""
        add(string.format(
            '    {"site_name": "%s", "latitude_deg": %.2f, "longitude_deg": %.2f, "total_sun_hours": %.2f, "illumination_percent": %.2f, "longest_sun_hours": %.2f, "total_earth_hours": %.2f, "longest_earth_hours": %.2f, "dte_window_count": %d, "overlap_hours": %.2f, "longest_dark_hours": %.2f, "mission_score": %d}%s\n',
            json_escape(c.site_name), c.latitude_deg, c.longitude_deg,
            c.total_sun_hours, c.illumination_percent, c.longest_sun_hours,
            c.total_earth_hours, c.longest_earth_hours, c.dte_window_count,
            c.overlap_hours, c.longest_dark_hours, c.mission_score, comma
        ))
    end
    add('  ]\n')
    add('}\n')

    return table.concat(buf)
end

local function parse_request(raw)
    -- The optional array length at index 0 distinguishes {} from [].
    local root = decode_json(raw, nil, json_null, true)
    local function object(value, name)
        if value == json_null or type(value) ~= "table" or value[0] ~= nil then
            error(name .. " must be a JSON object", 0)
        end
        return value
    end
    object(root, "Request")

    -- Nested sections have precedence; older clients send the fields flat.
    local function section(name)
        if root[name] == nil then return root end
        return object(root[name], name)
    end
    local function field(group, kind, key, alias, default)
        local value = group[key]
        if value == nil and alias then value = group[alias] end
        if value == nil and group ~= root then
            value = root[key]
            if value == nil and alias then value = root[alias] end
        end
        if value == nil then return default end
        if type(value) ~= kind then error(key .. " must be a " .. kind, 0) end
        if kind == "number" and math.abs(value) == math.huge then
            error(key .. " must be finite", 0)
        end
        if kind == "string" and (value == "" or value:find("%z")) then
            error(key .. " must be a non-empty string without NUL", 0)
        end
        return value
    end

    local site = section("site")
    local time = section("time_range")
    local options = section("options")
    local lat = field(site, "number", "latitude_deg", "latitude")
    local lon = field(site, "number", "longitude_deg", "longitude")
    local custom = field(site, "boolean", "use_custom", nil, lat ~= nil or lon ~= nil)
    if custom and (lat == nil or lon == nil) then
        error("Custom sites require latitude_deg and longitude_deg", 0)
    end
    if lat and (lat < -90 or lat > 90) then error("Latitude must be within [-90, 90]", 0) end
    if lon and (lon < -180 or lon > 360) then error("Longitude must be within [-180, 360]", 0) end

    local step = field(time, "number", "step_seconds", "interval_seconds", 3600)
    if not math.tointeger(step) or step < 60 or step > 2147483647 then
        error("step_seconds must be an integer between 60 and 2147483647", 0)
    end
    return {
        site_name = field(site, "string", "site_name", "name", custom and "Custom Coordinate" or "Shackleton Rim"),
        latitude_deg = lat or -89.90,
        longitude_deg = lon or 0,
        altitude_m = field(site, "number", "altitude_m", "altitude", 0),
        use_custom = custom,
        start_utc = field(time, "string", "start_utc", "start_date", "2026-10-18T00:00:00"):gsub("Z$", ""),
        end_utc = field(time, "string", "end_utc", "end_date", "2026-11-01T00:00:00"):gsub("Z$", ""),
        step_seconds = step,
        use_dem_horizon = field(options, "boolean", "use_dem_horizon", nil, true),
        min_sun_elevation_deg = field(options, "number", "min_sun_elevation_deg", nil, 0),
        min_earth_elevation_deg = field(options, "number", "min_earth_elevation_deg", nil, 0),
        include_earth_disk = field(options, "boolean", "include_earth_disk", nil, false)
    }
end

local function error_response(message, status)
    return string.format('{"status":"ERROR","message":"%s"}', json_escape(message)), status
end

function handle_simulation_json(raw)
    local ok, request = pcall(parse_request, raw or "{}")
    if not ok then return error_response(request, 400) end

    local result = nasa_compute_c(request)
    if not result or result.status_code ~= 0 then
        return error_response(result and result.error_msg or "Calculation failed", 422)
    end
    return build_contract_json(result, request), 200
end

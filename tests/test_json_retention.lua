-- The decoder lives for the native server's lifetime. Completed requests must
-- release their object keys after collection.
local decode = dofile("lua/json.lua")()
assert(decode('{"site\\u005fid":"ridge"}').site_id == "ridge")
collectgarbage("collect")
local before = collectgarbage("count")
for i = 1, 10000 do
    local key = "completed_request_" .. i
    local value = decode('{"' .. key .. '":true}')
    assert(value[key] == true)
end
collectgarbage("collect")
local retained_kib = collectgarbage("count") - before
assert(retained_kib < 128, "decoder retains completed request keys")
print(string.format("JSON retention passed (%.2f KiB retained)", retained_kib))

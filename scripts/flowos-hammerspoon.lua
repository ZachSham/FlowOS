local FLOWOS_PORT = tonumber(os.getenv("FLOWOS_HS_PORT") or "7710")
local LOG_PATH = "/tmp/flowos-hs-bridge.log"
flowos_last_moved_windows = flowos_last_moved_windows or {}

local function log_line(message)
  local file = io.open(LOG_PATH, "a")
  if file then
    file:write(os.date("%Y-%m-%d %H:%M:%S") .. " " .. tostring(message) .. "\n")
    file:close()
  end
end

local function encode(result)
  if hs and hs.json and hs.json.encode then
    return hs.json.encode(result)
  end
  return tostring(result and result.moved or 0)
end

local function decode_json(value)
  if not value or value == "" then
    return nil
  end
  if not hs or not hs.json or not hs.json.decode then
    return nil
  end
  local ok, parsed = pcall(hs.json.decode, value)
  if ok then
    return parsed
  end
  return nil
end

local function move_window_to_space(spaces_mod, win, target_space)
  local ok = pcall(function()
    spaces_mod.moveWindowToSpace(win, target_space)
  end)
  if ok then
    return true
  end

  return pcall(function()
    spaces_mod.moveWindowToSpace(win:id(), target_space)
  end)
end

function flowos_move_distractions_to_space2(app_names, title_tokens, keep_apps, move_non_focus_fallback)
  local result = {
    ok = false,
    moved = 0,
    reason = nil,
    seenApps = {},
    seenTitles = {},
    bridgeVersion = "flowos-hs-bridge-v2"
  }

  if not hs then
    result.reason = "hs_unavailable"
    return result
  end

  local spaces_mod = hs.spaces
  if not spaces_mod then
    result.reason = "spaces_module_unavailable"
    return result
  end

  local screen = hs.screen.primaryScreen()
  if not screen then
    result.reason = "no_primary_screen"
    return result
  end

  local space_ids = spaces_mod.spacesForScreen(screen:getUUID()) or {}
  if #space_ids < 2 then
    result.reason = "need_second_desktop"
    return result
  end

  local target_space = space_ids[2]
  local names = app_names or {"Discord", "Spotify", "Mail"}
  local keep = keep_apps or {"Code", "Terminal", "Google Chrome", "Codex", "Hammerspoon"}
  local keep_lookup = {}
  for _, app_name in ipairs(keep) do
    keep_lookup[string.lower(app_name)] = true
  end
  local effective_title_tokens = title_tokens or {"youtube", "gmail", "reddit", "x.com", "twitter", "netflix", "amazon"}
  if type(effective_title_tokens) ~= "table" then
    effective_title_tokens = {"youtube", "gmail", "reddit", "x.com", "twitter", "netflix", "amazon"}
  end

  local tokens = {}
  for _, name in ipairs(names) do
    table.insert(tokens, string.lower(name))
  end

  local title_token_lookup = {}
  for _, token in ipairs(effective_title_tokens) do
    title_token_lookup[string.lower(token)] = true
  end

  local function should_move_app(app_name)
    if not app_name then
      return false
    end
    local lower_name = string.lower(app_name)
    for _, token in ipairs(tokens) do
      if string.find(lower_name, token, 1, true) then
        return true
      end
    end
    return false
  end

  local function should_move_title(title)
    if not title then
      return false
    end
    local lower_title = string.lower(title)
    for token, _ in pairs(title_token_lookup) do
      if string.find(lower_title, token, 1, true) then
        return true
      end
    end
    return false
  end

  local function is_keep_app(app_name)
    if not app_name then
      return false
    end
    return keep_lookup[string.lower(app_name)] == true
  end

  flowos_last_moved_windows = {}
  local all_windows = hs.window.allWindows() or {}
  local seen = {}
  local seen_titles = {}
  local fallback_candidates = {}
  for _, win in ipairs(all_windows) do
    local app = win:application()
    local app_name = app and app:name() or nil
    local title = win:title()
    if app_name then
      seen[app_name] = true
    end
    if title and title ~= "" and #seen_titles < 25 then
      table.insert(seen_titles, title)
    end
    local matched = should_move_app(app_name) or should_move_title(title)
    if matched then
      local before_spaces = hs.spaces.windowSpaces(win) or {}
      if move_window_to_space(spaces_mod, win, target_space) then
        result.moved = result.moved + 1
        if win:id() and before_spaces[1] then
          table.insert(flowos_last_moved_windows, {
            id = win:id(),
            originalSpace = before_spaces[1]
          })
        end
      end
    elseif move_non_focus_fallback and not is_keep_app(app_name) then
      table.insert(fallback_candidates, win)
    end
  end

  if result.moved == 0 and move_non_focus_fallback and #fallback_candidates > 0 then
    for _, win in ipairs(fallback_candidates) do
      local before_spaces = hs.spaces.windowSpaces(win) or {}
      if move_window_to_space(spaces_mod, win, target_space) then
        result.moved = result.moved + 1
        if win:id() and before_spaces[1] then
          table.insert(flowos_last_moved_windows, {
            id = win:id(),
            originalSpace = before_spaces[1]
          })
        end
      end
    end
    if result.moved > 0 then
      result.reason = "moved_non_focus_fallback"
    end
  end

  for name, _ in pairs(seen) do
    table.insert(result.seenApps, name)
  end
  table.sort(result.seenApps)
  result.seenTitles = seen_titles

  result.ok = result.moved > 0
  if not result.ok and not result.reason then
    if #all_windows == 0 then
      result.reason = "no_visible_windows"
    else
      result.reason = "no_matching_windows"
    end
  end

  return result
end

function flowos_restore_last_moved_windows()
  local result = {
    ok = false,
    restored = 0,
    reason = nil
  }

  if not hs or not hs.window or not hs.spaces then
    result.reason = "hs_unavailable"
    return result
  end

  if not flowos_last_moved_windows or #flowos_last_moved_windows == 0 then
    result.reason = "nothing_to_restore"
    result.ok = true
    return result
  end

  for _, item in ipairs(flowos_last_moved_windows) do
    local win = hs.window.get(item.id)
    if win and item.originalSpace then
      local moved = move_window_to_space(hs.spaces, win, item.originalSpace)
      if moved then
        result.restored = result.restored + 1
      end
    end
  end

  flowos_last_moved_windows = {}
  result.ok = true
  return result
end

local function flowos_http_handler(method, path, _headers, body)
  if method == "GET" and path == "/health" then
    return "ok", 200, { ["Content-Type"] = "text/plain" }
  end

  if method == "POST" and path == "/move_distractions" then
    local payload = decode_json(body) or {}
    local app_names = payload.apps
    local result = flowos_move_distractions_to_space2(
      app_names,
      payload.titleTokens,
      payload.keepApps,
      payload.moveNonFocusFallback == true
    )
    return encode(result), 200, { ["Content-Type"] = "application/json" }
  end

  if method == "POST" and path == "/restore_last_move" then
    local result = flowos_restore_last_moved_windows()
    return encode(result), 200, { ["Content-Type"] = "application/json" }
  end

  return "not found", 404, { ["Content-Type"] = "text/plain" }
end

if flowos_http_server then
  flowos_http_server:stop()
end

if not hs or not hs.httpserver then
  log_line("FlowOS bridge failed: hs.httpserver unavailable")
  return
end

flowos_http_server = hs.httpserver.new(false, false)
flowos_http_server:setPort(FLOWOS_PORT)
flowos_http_server:setCallback(flowos_http_handler)
pcall(function()
  flowos_http_server:setInterface("127.0.0.1")
end)
flowos_http_server:start()
log_line(string.format("FlowOS bridge listening on 127.0.0.1:%d", FLOWOS_PORT))
print(string.format("FlowOS Hammerspoon bridge listening on 127.0.0.1:%d", FLOWOS_PORT))

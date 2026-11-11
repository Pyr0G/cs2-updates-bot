#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <algorithm>
#include <vector>
#include <time.h>
#include <errno.h>
#include "patchnotes.h"

extern const char caRoots[] asm("_binary_certs_roots_pem_start");
namespace {
constexpr size_t PAGE_SIZE = 10, MAX_ITEMS = 64, MAX_BOUNDARY = 32;
constexpr uint32_t POLL_MS = 120000;
const char *FEED = "steam_community_announcements";
const char *IMAGE = "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/730/header.jpg";
Preferences prefs;
// Bound retained network JSON allocations even if an upstream response grows.
class LimitedAllocator : public ArduinoJson::Allocator {
    struct alignas(max_align_t) Header { size_t size; };
    size_t used = 0;
    static constexpr size_t LIMIT = 48000;
public:
    void *allocate(size_t size) override {
        if (size > LIMIT - used) return nullptr;
        auto p = static_cast<Header *>(malloc(size + sizeof(Header)));
        if (!p) return nullptr;
        p->size = size; used += size; return p + 1;
    }
    void deallocate(void *ptr) override {
        if (!ptr) return;
        auto p = static_cast<Header *>(ptr) - 1;
        used -= p->size; free(p);
    }
    void *reallocate(void *ptr, size_t size) override {
        if (!ptr) return allocate(size);
        auto p = static_cast<Header *>(ptr) - 1;
        size_t old = p->size;
        if (size > LIMIT - used + old) return nullptr;
        auto next = static_cast<Header *>(realloc(p, size + sizeof(Header)));
        if (!next) return nullptr;
        next->size = size; used = used - old + size; return next + 1;
    }
} networkMemory;
JsonDocument config, state;
bool ready = false, paused = true, storageOK = false;
uint32_t lastPoll = 0, lastConnect = 0;
String serialLine;
bool serialOverflow = false;
bool sessionBaseline = true;
struct Item { String id, title, text, url; uint32_t date; };

bool digits(const String &s, size_t minimum = 1, size_t maximum = 20) {
    if (s.length() < minimum || s.length() > maximum) return false;
    for (char c : s) if (c < '0' || c > '9') return false;
    return true;
}
String channel() { return config["channel"].as<String>(); }
bool persist(JsonDocument &doc, const char *key) {
    String text;
    serializeJson(doc, text);
    if (!storageOK || text.length() > 7000 || prefs.putString(key, text) != text.length()) {
        paused = true; storageOK = false;
        Serial.println("ERROR: flash save failed; posting paused.");
        return false;
    }
    return true;
}
bool validConfig(JsonDocument &d) {
    return d["ssid"].is<String>() && d["ssid"].as<String>().length() > 0 &&
        d["ssid"].as<String>().length() <= 32 && d["password"].is<String>() &&
        d["password"].as<String>().length() <= 63 && d["token"].is<String>() &&
        d["token"].as<String>().length() > 20 && d["token"].as<String>().length() <= 200 &&
        digits(d["application"].as<String>(), 17) && digits(d["guild"].as<String>(), 17) &&
        digits(d["channel"].as<String>(), 17) && digits(d["role"].as<String>(), 17);
}
bool validState(JsonDocument &d) {
    if (d["version"].as<int>() != 1 || !digits(d["channel"].as<String>(), 17) ||
        !d["since"].is<uint32_t>() || d["since"].as<uint32_t>() == 0 || !d["ids"].is<JsonArray>() || d["ids"].size() > MAX_BOUNDARY) return false;
    for (JsonVariant id : d["ids"].as<JsonArray>()) if (!id.is<String>() || !digits(id.as<String>())) return false;
    if (!d["skip"].isNull()) {
        if (!d["skip"].is<JsonArray>() || d["skip"].size() > 256) return false;
        for (JsonVariant id : d["skip"].as<JsonArray>()) if (!id.is<String>() || !digits(id.as<String>())) return false;
    }
    if (!d["pending"].isNull()) {
        if (!d["pending"].is<JsonObject>() || !digits(d["pending"]["gid"].as<String>()) ||
            !d["pending"]["date"].is<uint32_t>() || d["pending"]["date"].as<uint32_t>() < d["since"].as<uint32_t>()) return false;
    }
    return true;
}
bool saveState() { return persist(state, "state"); }
bool setPaused(bool value) {
    if (!storageOK || prefs.putBool("paused", value) != 1) {
        paused = true;
        Serial.println("ERROR: cannot save posting mode.");
        return false;
    }
    paused = value;
    return true;
}
bool seen(const Item &item) {
    for (JsonVariant id : state["skip"].as<JsonArray>()) if (id.as<String>() == item.id) return true;
    uint32_t since = state["since"] | 0U;
    if (item.date < since) return true;
    if (item.date > since) return false;
    for (JsonVariant id : state["ids"].as<JsonArray>()) if (id.as<String>() == item.id) return true;
    return false;
}
bool confirm(const Item &item, const String &message = "") {
    if (item.date > (state["since"] | 0U)) {
        state["since"] = item.date;
        state["ids"].to<JsonArray>();
    }
    if (!seen(item)) {
        if (state["ids"].size() >= MAX_BOUNDARY) {
            Serial.println("ERROR: timestamp boundary full; pending delivery retained.");
            return false;
        }
        state["ids"].as<JsonArray>().add(item.id);
    }
    state["pending"] = nullptr;
    state["lastMessage"] = message;
    return saveState();
}

bool network() {
    if (!ready || !storageOK) return false;
    if (WiFi.status() != WL_CONNECTED) {
        if (millis() - lastConnect >= 15000 || lastConnect == 0) {
            lastConnect = millis();
            WiFi.disconnect();
            WiFi.begin(config["ssid"].as<const char *>(), config["password"].as<const char *>());
            Serial.println("Connecting to Wi-Fi...");
        }
        return false;
    }
    if (time(nullptr) < 1700000000) return false;
    return true;
}

// HTTP/1.0 avoids chunk framing when deserializing directly from the TLS stream.
// Redirects are disabled: neither credentials nor feed reads follow arbitrary hosts.
int request(const String &url, JsonDocument &out, const String *body = nullptr, bool discord = false, const char *kind = "object") {
    if (!network()) return -1;
    WiFiClientSecure client;
    client.setCACert(caRoots);
    client.setHandshakeTimeout(15);
    HTTPClient http;
    http.useHTTP10(true);
    http.setTimeout(20000);
    http.setConnectTimeout(15000);
    http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
    if (!http.begin(client, url)) return -1;
    http.addHeader("User-Agent", "CS2UpdatesBotLite/0.1");
    if (discord) http.addHeader("Authorization", "Bot " + config["token"].as<String>());
    int status;
    if (body) {
        http.addHeader("Content-Type", "application/json");
        status = http.POST(*body);
    } else status = http.GET();
    if (status == 200 || status == 201 || status == 429) {
        // Keep only required fields; no whole response copies or article downloads.
        JsonDocument filter;
        if (!discord) {
            filter["appnews"]["appid"] = true;
            JsonObject f = filter["appnews"]["newsitems"][0].to<JsonObject>();
            for (const char *key : {"gid", "title", "contents", "url", "date", "feedname", "appid"}) f[key] = true;
        } else if (String(kind) == "roles" && status != 429) {
            for (const char *key : {"id", "permissions", "mentionable"}) filter[0][key] = true;
        } else {
            for (const char *key : {"id", "guild_id", "type", "retry_after", "roles"}) filter[key] = true;
            for (const char *key : {"id", "type", "allow", "deny"}) filter["permission_overwrites"][0][key] = true;
        }
        auto err = deserializeJson(out, http.getStream(), DeserializationOption::Filter(filter), DeserializationOption::NestingLimit(12));
        if (err) {
            Serial.println("ERROR: invalid or oversized JSON response.");
            status = -2;
        }
    }
    http.end();
    return status;
}
String discordURL(const String &path) { return "https://discord.com/api/v10" + path; }
bool checkDiscord() {
    JsonDocument me(&networkMemory), destination(&networkMemory), roles(&networkMemory), member(&networkMemory);
    int status = request(discordURL("/users/@me"), me, nullptr, true);
    String application = config["application"].as<String>(), guild = config["guild"].as<String>(), roleId = config["role"].as<String>();
    if (status != 200 || me["id"].as<String>() != application) {
        Serial.printf("ERROR: bot identity check failed (%d).\n", status); return false;
    }
    me.clear();
    status = request(discordURL("/channels/" + channel()), destination, nullptr, true);
    if (status != 200 || destination["guild_id"].as<String>() != guild ||
        !destination["type"].is<int>() || !(destination["type"].as<int>() == 0 || destination["type"].as<int>() == 5)) {
        Serial.printf("ERROR: channel/server check failed (%d).\n", status); return false;
    }
    status = request(discordURL("/guilds/" + guild + "/roles"), roles, nullptr, true, "roles");
    if (status != 200 || !roles.is<JsonArray>()) { Serial.println("ERROR: cannot verify server roles."); return false; }
    status = request(discordURL("/guilds/" + guild + "/members/" + application), member, nullptr, true);
    if (status != 200 || !member["roles"].is<JsonArray>()) { Serial.println("ERROR: cannot verify bot membership."); return false; }
    auto hasRole = [&](const String &id) {
        for (JsonVariant r : member["roles"].as<JsonArray>()) if (r.as<String>() == id) return true;
        return false;
    };
    bool found = false, mentionable = false, permissionValid = true;
    auto bits = [&](JsonVariantConst value) -> uint64_t {
        String text = value.as<String>();
        if (!digits(text)) { permissionValid = false; return 0; }
        char *end = nullptr;
        errno = 0;
        uint64_t result = strtoull(text.c_str(), &end, 10);
        if (errno || !end || *end) permissionValid = false;
        return result;
    };
    uint64_t permissions = 0;
    for (JsonObject role : roles.as<JsonArray>()) {
        String id = role["id"].as<String>();
        if (id == roleId) { found = true; mentionable = role["mentionable"] | false; }
        if (id == guild || hasRole(id)) permissions |= bits(role["permissions"]);
    }
    if (!found) { Serial.println("ERROR: configured notification role is absent."); return false; }
    if (!(permissions & 8ULL)) {
        uint64_t allow = 0, deny = 0;
        JsonArray overwrites = destination["permission_overwrites"].as<JsonArray>();
        for (JsonObject o : overwrites) if (o["id"].as<String>() == guild) permissions = (permissions & ~bits(o["deny"])) | bits(o["allow"]);
        for (JsonObject o : overwrites) if (o["type"].as<int>() == 0 && hasRole(o["id"].as<String>())) {
            deny |= bits(o["deny"]); allow |= bits(o["allow"]);
        }
        permissions = (permissions & ~deny) | allow;
        for (JsonObject o : overwrites) if (o["type"].as<int>() == 1 && o["id"].as<String>() == application)
            permissions = (permissions & ~bits(o["deny"])) | bits(o["allow"]);
        const uint64_t required = 1024ULL | 2048ULL | 16384ULL;
        if ((permissions & required) != required || (!mentionable && !(permissions & 131072ULL))) {
            Serial.println("ERROR: missing View Channel, Send Messages, Embed Links or role mention permission."); return false;
        }
    }
    if (!permissionValid) { Serial.println("ERROR: invalid Discord permission bitfield."); return false; }
    Serial.println("Bot identity, destination, role and permissions verified; no message sent.");
    return true;
}
String utf8Prefix(String text, size_t bytes) {
    if (text.length() <= bytes) return text;
    while (bytes && (static_cast<uint8_t>(text[bytes]) & 0xC0) == 0x80) --bytes;
    return text.substring(0, bytes);
}
bool safeURL(const String &url) {
    // Restrict authority exactly; never fetch announcement HTML on the ESP32.
    for (const char *host : {"steamcommunity.com", "store.steampowered.com", "steamstore-a.akamaihd.net"}) {
        String prefix = String("https://") + host + "/";
        if (url.startsWith(prefix) && url.indexOf('\n') < 0 && url.indexOf('\r') < 0) return true;
    }
    return false;
}
bool fetchNews(std::vector<Item> &items, bool baseline) {
    uint32_t end = 0, since = state["since"] | 0U;
    for (size_t page = 0; page < 100; ++page) {
        String url = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=730&feeds=steam_community_announcements&count=10&maxlength=1";
        if (end) url += "&enddate=" + String(end);
        JsonDocument doc(&networkMemory);
        int status = request(url, doc);
        if (status != 200 || doc["appnews"]["appid"].as<int>() != 730 || !doc["appnews"]["newsitems"].is<JsonArray>()) {
            Serial.printf("ERROR: Steam read failed (%d); checkpoint unchanged.\n", status);
            return false;
        }
        JsonArray batch = doc["appnews"]["newsitems"].as<JsonArray>();
        if (batch.size() > PAGE_SIZE) return false;
        uint32_t oldest = UINT32_MAX;
        for (JsonObject obj : batch) {
            Item item{obj["gid"].as<String>(), obj["title"].as<String>(), obj["contents"].as<String>(), obj["url"].as<String>(), obj["date"] | 0U};
            if (obj["appid"].as<int>() != 730 || obj["feedname"].as<String>() != FEED || !digits(item.id) ||
                !obj["date"].is<uint32_t>() || item.date == 0 || !obj["title"].is<String>() ||
                !obj["contents"].is<String>() || !safeURL(item.url) || item.title.length() > 2048 ||
                item.text.length() > 8000 || item.url.length() > 2048) {
                Serial.println("ERROR: invalid Steam announcement.");
                return false;
            }
            oldest = std::min(oldest, item.date);
            if (!baseline && (item.date < since || seen(item))) continue;
            bool duplicate = false;
            for (const Item &saved : items) if (saved.id == item.id) duplicate = true;
            if (!duplicate) {
                if (items.size() >= MAX_ITEMS || ESP.getFreeHeap() < 70000) {
                    Serial.println("ERROR: catch-up memory limit; checkpoint unchanged. Use desktop bot to catch up.");
                    return false;
                }
                items.push_back(std::move(item));
            }
        }
        if (baseline || batch.size() < PAGE_SIZE || oldest < since) {
            std::sort(items.begin(), items.end(), [](const Item &a, const Item &b) {
                return a.date < b.date || (a.date == b.date && a.id < b.id);
            });
            return true;
        }
        uint32_t next = oldest + 1;
        if (end && next >= end) {
            Serial.println("ERROR: Steam pagination made no progress; checkpoint unchanged.");
            return false;
        }
        end = next;
    }
    return false;
}
bool fullArticle(Item &item) {
    // Fetch one full article at a time so old feed pages cannot exhaust ESP RAM.
    for (unsigned count : {1U, 10U}) {
        String url = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=730&feeds=steam_community_announcements&maxlength=0&count=" + String(count) + "&enddate=" + String(item.date + 1);
        JsonDocument doc(&networkMemory);
        int status = request(url, doc);
        if (status != 200 || doc["appnews"]["appid"].as<int>() != 730 || !doc["appnews"]["newsitems"].is<JsonArray>()) {
            Serial.println("ERROR: full article unavailable; nothing sent and checkpoint retained."); return false;
        }
        for (JsonObject obj : doc["appnews"]["newsitems"].as<JsonArray>()) {
            if (obj["gid"].as<String>() != item.id) continue;
            if (obj["appid"].as<int>() != 730 || obj["feedname"].as<String>() != FEED ||
                obj["date"].as<uint32_t>() != item.date || !obj["contents"].is<String>() ||
                obj["contents"].as<String>().length() > patchnotes::MAX_SOURCE) {
                Serial.println("ERROR: invalid or oversized full article; nothing sent."); return false;
            }
            item.text = obj["contents"].as<String>(); return true;
        }
    }
    Serial.println("ERROR: exact full announcement not found; nothing sent."); return false;
}
String payload(const Item &item, bool ping) {
    std::vector<std::string> parts;
    if (!patchnotes::descriptions(std::string(item.text.c_str(), item.text.length()), parts)) {
        Serial.println("ERROR: complete patch notes exceed safe Discord/device limits; nothing sent. Checkpoint retained."); return "";
    }
    JsonDocument doc;
    doc["content"] = ping ? "<@&" + config["role"].as<String>() + ">" : "";
    doc["allowed_mentions"]["parse"].to<JsonArray>();
    JsonArray roles = doc["allowed_mentions"]["roles"].to<JsonArray>();
    if (ping) roles.add(config["role"].as<String>());
    doc["allowed_mentions"]["users"].to<JsonArray>();
    doc["allowed_mentions"]["replied_user"] = false;
    doc["nonce"] = item.id;
    doc["enforce_nonce"] = true;
    time_t published = item.date;
    struct tm date;
    gmtime_r(&published, &date);
    char timestamp[25];
    strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", &date);
    for (size_t part = 0; part < parts.size(); ++part) {
        JsonObject embed = doc["embeds"].add<JsonObject>();
        embed["title"] = utf8Prefix(item.title, part ? 244 : 256) + (part ? " (continued)" : "");
        embed["url"] = item.url + (part ? "#cs2lite-part-" + String(part + 1) : "");
        embed["description"] = parts[part];
        embed["color"] = 0xf0a126;
        if (part + 1 == parts.size()) embed["image"]["url"] = IMAGE;
        embed["footer"]["text"] = "Counter-Strike 2 / Steam";
        embed["timestamp"] = timestamp;
    }
    String body;
    serializeJson(doc, body);
    return body;
}
bool sendItem(Item item) {
    if (!fullArticle(item)) return false;
    String body = payload(item, true);
    if (!body.length()) return false;
    // Save intent before POST. On loss of power or an uncertain response, require review.
    state["pending"]["gid"] = item.id;
    state["pending"]["date"] = item.date;
    state["pending"]["title"] = utf8Prefix(item.title, 256);
    state["pending"]["url"] = item.url;
    if (!saveState()) return false;
    JsonDocument response(&networkMemory);
    int status = request(discordURL("/channels/" + channel() + "/messages"), response, &body, true);
    if (status == 429) {
        // A received 429 is a definite rejection. Retry on a later polling cycle.
        double retry = response["retry_after"] | 120.0;
        if (!isfinite(retry) || retry < 0 || retry > 86400) retry = 86400;
        state["retryAt"] = static_cast<uint32_t>(time(nullptr)) + static_cast<uint32_t>(ceil(retry)) + 1;
        state["pending"] = nullptr;
        saveState();
        Serial.println("Discord rate limited; waiting before retry.");
        return false;
    }
    if (status != 200 && status != 201) {
        Serial.printf("ERROR: delivery needs manual review (%d). Posting blocked.\n", status);
        return false;
    }
    String id = response["id"].as<String>();
    if (!digits(id, 17)) { Serial.println("ERROR: missing message receipt; review required."); return false; }
    if (!confirm(item, id)) return false;
    Serial.printf("Delivered Steam announcement %s.\n", item.id.c_str());
    return true;
}
void poll(bool preview = false) {
    if (!network()) { Serial.println("Waiting for Wi-Fi and clock synchronization."); return; }
    if (!state["pending"].isNull()) { Serial.println("Posting blocked: pending delivery requires review."); return; }
    if (state["channel"].is<String>() && state["channel"].as<String>() != channel()) {
        Serial.println("ERROR: saved history belongs to another channel."); return;
    }
    if ((state["retryAt"] | 0U) > static_cast<uint32_t>(time(nullptr))) return;
    bool baseline = sessionBaseline || state["version"].isNull();
    std::vector<Item> items;
    if (!fetchNews(items, baseline || preview)) return;
    if (preview) {
        if (items.empty()) Serial.println("No unseen announcements to preview.");
        else if (fullArticle(items.back())) Serial.println(payload(items.back(), false));
        return;
    }
    if (baseline) {
        if (items.empty()) { Serial.println("Empty feed; baseline not saved."); return; }
        state.clear(); // Pending and destination guards above must pass before resetting startup history.
        state["version"] = 1;
        state["channel"] = channel();
        state["since"] = items.back().date;
        state["ids"].to<JsonArray>();
        state["pending"] = nullptr;
        for (const Item &item : items) if (item.date == items.back().date) state["ids"].as<JsonArray>().add(item.id);
        if (saveState()) {
            sessionBaseline = false;
            Serial.println("Quiet startup baseline saved; watching only new announcements.");
        }
        return;
    }
    if (paused) { Serial.printf("Paused: %u unseen announcement(s).\n", static_cast<unsigned>(items.size())); return; }
    for (const Item &item : items) {
        if (item.date == (state["since"] | 0U) && state["ids"].size() >= MAX_BOUNDARY) {
            Serial.println("ERROR: boundary capacity reached; posting stopped before send."); return;
        }
        if (!sendItem(item)) return;
        delay(1500);
    }
}
void command(const String &line) {
    if (line == "status") {
        Serial.printf("configured=%s wifi=%s clock=%s paused=%s heap=%u\n", ready ? "yes" : "no",
            WiFi.status() == WL_CONNECTED ? "connected" : "disconnected", time(nullptr) > 1700000000 ? "ready" : "waiting",
            paused ? "yes" : "no", ESP.getFreeHeap());
        Serial.printf("startup_baseline=%s next_boot=%s\n", sessionBaseline ? "waiting" : "ready", prefs.getBool("paused", false) ? "paused" : "enabled");
        Serial.printf("formatter=full-notes-v1.1.1 checkpoint=%u boundary_ids=%u\n", state["since"] | 0U, static_cast<unsigned>(state["ids"].size()));
        if (!state["pending"].isNull()) Serial.println("Pending Steam ID: " + state["pending"]["gid"].as<String>());
    } else if (line.startsWith("configure ")) {
        JsonDocument next;
        if (deserializeJson(next, line.substring(10)) || !validConfig(next)) { Serial.println("ERROR: invalid configuration."); return; }
        if (state["channel"].is<String>() && state["channel"].as<String>() != next["channel"].as<String>()) {
            Serial.println("ERROR: configuration conflicts with saved channel."); return;
        }
        if (!setPaused(true) || !persist(next, "config")) return;
        Serial.println("Configuration saved privately; restarting in paused mode.");
        delay(100); ESP.restart();
    } else if (line == "check") checkDiscord();
    else if (line == "preview") poll(true);
    else if (line == "poll") { poll(); lastPoll = millis(); }
    else if (line == "standby") {
        if (!ready || !state["pending"].isNull()) { Serial.println("ERROR: configure and resolve pending delivery before arming."); return; }
        if (setPaused(false)) {
            paused = true;
            Serial.println("Current session paused; automatic posting armed for next power-up.");
        }
    }
    else if (line == "pause") { if (setPaused(true)) Serial.println("Automatic posting paused."); }
    else if (line == "enable") {
        if (!ready || !state["pending"].isNull() || state["channel"].as<String>() != channel()) {
            Serial.println("ERROR: configure, establish/import baseline and resolve pending delivery first."); return;
        }
        if (checkDiscord() && setPaused(false)) { Serial.println("Automatic posting enabled. Keep desktop instance stopped."); lastPoll = millis() - POLL_MS; }
    } else if (line.startsWith("import ")) {
        if (!paused) { Serial.println("ERROR: pause before importing history."); return; }
        JsonDocument next;
        if (deserializeJson(next, line.substring(7)) || !validState(next) || !ready || next["channel"].as<String>() != channel()) {
            Serial.println("ERROR: invalid or mismatched history."); return;
        }
        if (!state["pending"].isNull()) { Serial.println("ERROR: resolve existing pending delivery first."); return; }
        if (persist(next, "state")) { state.set(next); Serial.println("History imported; posting remains paused."); }
    } else if (line.startsWith("resolve-sent ") || line.startsWith("resolve-retry ")) {
        bool sent = line.startsWith("resolve-sent ");
        String id = line.substring(sent ? 13 : 14);
        if (!paused || state["pending"].isNull() || state["pending"]["gid"].as<String>() != id) {
            Serial.println("ERROR: pause and supply exact pending Steam ID after checking Discord."); return;
        }
        if (sent) {
            Item item{id, "", "", "", state["pending"]["date"] | 0U};
            confirm(item);
        } else { state["pending"] = nullptr; saveState(); }
        Serial.println("Review recorded; posting remains paused.");
    } else Serial.println("Commands: status, check, preview, poll, pause, standby, enable, configure JSON, import JSON, resolve-sent ID, resolve-retry ID");
}
} // namespace

void setup() {
    Serial.begin(115200);
    Serial.setTimeout(100);
    delay(500);
    Serial.println("CS2 Updates Bot Lite / ESP32; serial commands at 115200 baud.");
    storageOK = prefs.begin("cs2lite", false);
    if (!storageOK) { Serial.println("ERROR: NVS unavailable; halted."); return; }
    paused = prefs.getBool("paused", false);
    String raw = prefs.getString("state", "");
    if (raw.length() && (deserializeJson(state, raw) || !validState(state))) {
        Serial.println("ERROR: saved history corrupt; halted without resetting it."); storageOK = false; paused = true; return;
    }
    raw = prefs.getString("config", "");
    ready = raw.length() && !deserializeJson(config, raw) && validConfig(config);
    if (!ready) { paused = true; Serial.println("Configure using tools/device.py; secrets are never echoed."); return; }
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
    network();
    lastPoll = millis() - POLL_MS;
}
void loop() {
    while (Serial.available()) {
        char c = Serial.read();
        if (c == '\r') continue;
        if (c == '\n') {
            if (!serialOverflow && serialLine.length() && storageOK) command(serialLine);
            else if (serialOverflow) Serial.println("ERROR: serial command too long.");
            serialLine = ""; serialOverflow = false;
        } else if (serialLine.length() < 8192 && !serialOverflow) serialLine += c;
        else serialOverflow = true;
    }
    if (network() && millis() - lastPoll >= POLL_MS) { lastPoll = millis(); poll(); }
    delay(10);
}

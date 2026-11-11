#pragma once
#include <string>
#include <vector>
#include <cctype>
#include <cstdlib>
#include <algorithm>

namespace patchnotes {
constexpr size_t MAX_SOURCE = 32000;
constexpr size_t MAX_DESCRIPTION_TOTAL = 5200; // leaves room under Discord's 6000 embed-character sum
inline std::string lower(std::string s) {
    for (char &c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}
inline void line(std::string &s, size_t breaks = 1) {
    while (!s.empty() && (s.back() == ' ' || s.back() == '\t')) s.pop_back();
    if (s.empty()) return;
    size_t trailing = 0;
    for (size_t i = s.size(); i > 0 && s[i - 1] == '\n'; --i) ++trailing;
    while (trailing++ < breaks) s += '\n';
}
inline void unicode(std::string &out, unsigned long cp) {
    if (!cp || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return;
    if (cp < 0x80) out += static_cast<char>(cp);
    else if (cp < 0x800) { out += char(0xc0 | cp >> 6); out += char(0x80 | (cp & 63)); }
    else if (cp < 0x10000) { out += char(0xe0 | cp >> 12); out += char(0x80 | (cp >> 6 & 63)); out += char(0x80 | (cp & 63)); }
    else { out += char(0xf0 | cp >> 18); out += char(0x80 | (cp >> 12 & 63)); out += char(0x80 | (cp >> 6 & 63)); out += char(0x80 | (cp & 63)); }
}
inline std::string entities(const std::string &text) {
    std::string out;
    for (size_t i = 0; i < text.size(); ++i) {
        if (text[i] == '&') {
            size_t end = text.find(';', i + 1);
            if (end != std::string::npos && end - i <= 16) {
                std::string name = lower(text.substr(i + 1, end - i - 1)), value;
                if (name == "amp") value = "&";
                else if (name == "lt") value = "<";
                else if (name == "gt") value = ">";
                else if (name == "quot") value = "\"";
                else if (name == "apos") value = "'";
                else if (name == "nbsp") value = " ";
                else if (!name.empty() && name[0] == '#') {
                    bool hex = name.size() > 1 && name[1] == 'x';
                    const char *start = name.c_str() + (hex ? 2 : 1);
                    char *tail = nullptr;
                    unsigned long cp = std::strtoul(start, &tail, hex ? 16 : 10);
                    if (*start && tail && !*tail) unicode(value, cp);
                }
                if (!value.empty()) { out += value; i = end; continue; }
            }
        }
        if (static_cast<unsigned char>(text[i]) == 0xc2 && i + 1 < text.size() && static_cast<unsigned char>(text[i + 1]) == 0xa0) { out += ' '; ++i; }
        else out += text[i];
    }
    return out;
}
inline bool format(const std::string &source, std::string &result) {
    if (source.size() > MAX_SOURCE) return false;
    std::string plain;
    unsigned depth = 0;
    for (size_t i = 0; i < source.size();) {
        if (plain.size() > MAX_DESCRIPTION_TOTAL) return false;
        // Steam escapes literal section brackets, e.g. \[ MAP SCRIPTING ].
        if (source[i] == '\\' && i + 1 < source.size() && (source[i + 1] == '[' || source[i + 1] == ']')) {
            plain += source[i + 1]; i += 2; continue;
        }
        bool html = source[i] == '<';
        if (source[i] == '[' || html) {
            size_t end = source.find(html ? '>' : ']', i + 1);
            if (end != std::string::npos && end - i <= 2048) {
                std::string tag = lower(source.substr(i + 1, end - i - 1));
                bool closing = !tag.empty() && tag[0] == '/';
                std::string name = tag.substr(closing ? 1 : 0);
                name = name.substr(0, name.find_first_of(" =\t/"));
                bool handled = true;
                if (!closing && (name == "img" || name == "video" || name == "youtube" || name == "script" || name == "style")) {
                    std::string close = std::string(html ? "</" : "[/") + name + (html ? ">" : "]");
                    size_t stop = lower(source).find(close, end + 1);
                    if (stop != std::string::npos) { i = stop + close.size(); continue; }
                }
                if (name == "list" || name == "olist" || name == "ul" || name == "ol") { line(plain, 2); if (closing) { if (depth) --depth; } else { if (depth >= 16) return false; ++depth; } }
                else if (name == "*" || name == "li") {
                    line(plain, 2);
                    if (!closing) { plain.append(depth > 1 ? (depth - 1) * 2 : 0, ' '); plain += "\xe2\x80\xa2 "; }
                }
                else if (name == "br") { line(plain, !plain.empty() && plain.back() == '\n' ? 2 : 1); }
                else if (name == "p" || name == "div" || name == "tr" || name == "h1" || name == "h2" || name == "h3" || name == "h4" || name == "h5" || name == "h6") {
                    // A paragraph immediately following a list marker stays on that bullet's line.
                    bool bullet = plain.size() >= 4 && plain.compare(plain.size() - 4, 4, "\xe2\x80\xa2 ") == 0;
                    if (closing || !bullet) line(plain, 2);
                }
                else if (name == "td" || name == "th") { if (closing) plain += " | "; }
                else if (name == "b" || name == "strong" || name == "i" || name == "em" || name == "u" || name == "s" || name == "strike" || name == "url" || name == "a" || name == "quote" || name == "blockquote" || name == "code" || name == "pre" || name == "spoiler" || name == "table" || name == "span" || name == "img" || name == "hr") {}
                else handled = false;
                if (handled) { i = end + 1; continue; }
            }
        }
        char c = source[i++];
        if (c == '\r') continue;
        if (c == '\n') { line(plain, !plain.empty() && plain.back() == '\n' ? 2 : 1); continue; }
        if (c == '\t') c = ' ';
        if (c == ' ' && (plain.empty() || plain.back() == ' ' || plain.back() == '\n')) continue;
        plain += c;
    }
    plain = entities(plain);
    while (!plain.empty() && std::isspace(static_cast<unsigned char>(plain.back()))) plain.pop_back();
    result.clear();
    for (char c : plain) {
        if (c == '@') result += "@\xe2\x80\x8b";
        else { if (c == '\\' || c == '*' || c == '_' || c == '`' || c == '~' || c == '|' || c == '[' || c == ']') result += '\\'; result += c; }
    }
    if (result.empty()) result = "Read the announcement on Steam.";
    return true;
}
inline bool descriptions(const std::string &source, std::vector<std::string> &parts) {
    std::string text;
    parts.clear();
    if (!format(source, text) || text.size() > MAX_DESCRIPTION_TOTAL) return false;
    size_t start = 0;
    while (start < text.size()) {
        size_t end = std::min(start + 3500, text.size());
        if (end < text.size()) {
            while (end > start && (static_cast<unsigned char>(text[end]) & 0xc0) == 0x80) --end;
            size_t newline = text.rfind('\n', end - 1);
            if (newline != std::string::npos && newline > start) end = newline + 1;
            // Do not split an escape from its literal character.
            size_t slashes = 0;
            for (size_t j = end; j > start && text[j - 1] == '\\'; --j) ++slashes;
            if (slashes % 2) --end;
        }
        if (end <= start) return false;
        parts.push_back(text.substr(start, end - start)); start = end;
    }
    return true;
}
} // namespace patchnotes

// CDN base URL for game assets
// Set this to your GitHub Pages URL, e.g. "https://your-username.github.io/assets/"
// Leave empty ("") to load games locally for development
// NOTE: use the GitHub Pages URL (ramiis324.github.io), NOT the jsdelivr gh
// mirror — jsdelivr serves .html files as text/plain, which the game iframe
// cannot render. GitHub Pages serves them as text/html.
const CDN = "https://ramiis324.github.io/r-cdn/";
// MocVG games (gameIndex starting with "projects/") are served from their own
// repo because the main r-cdn repo is too large for GitHub Pages to deploy.
const MOCVG_CDN = "https://ramiis324.github.io/r-mocvg/";
// Selenite games (gameIndex starting with "selenite/") are served from their
// own repo for the same reason — the main r-cdn repo is too large to host.
const SELENITE_CDN = "https://ramiis324.github.io/r-selenite/";
// Sz Games catalog (gameIndex starting with "sz/") is hosted on their own
// GitHub Pages site, so we point straight at it.
const SZ_CDN = "https://sz-games.github.io/";
// Pick the host that serves a given gameIndex.
function gameCdn(gameIndex) {
    if (gameIndex.startsWith("projects/")) return MOCVG_CDN;
    if (gameIndex.startsWith("selenite/")) return SELENITE_CDN;
    if (gameIndex.startsWith("sz/")) return SZ_CDN;
    return CDN;
}
// Build the full URL for a game. gameIndex is normally a path relative to its
// host ("games/2048/index.html"), but it may also be an absolute http(s) URL
// for games we hotlink from another site.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. Entries whose gameIndex is already an absolute
// http(s) URL point at an external host and are used as-is; everything else
// is resolved against the host picked by gameCdn().
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Absolute http(s) gameIndex values (games hosted on
// another site, e.g. Polaris-Assets or a game portal) are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute game URLs (catalog entries hosted on another site, e.g. an external
// games portal) are used as-is; everything else is joined onto its CDN.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute game URLs (http:// or https://) are hosted off-site and are used
// as-is; everything else is resolved against its catalog host above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URLs (third-party hosted games) skip the CDN host entirely.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Build the full URL for a game. Absolute gameIndex values (http/https) point
// at an external host and are used as-is; everything else is served from the
// host chosen by gameCdn.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. Entries whose gameIndex is already an absolute
// http(s) URL point straight at an external host (games we mirror from
// elsewhere, e.g. Polaris) and skip the CDN pick above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Absolute URLs (games hosted on another site)
// are used as-is; everything else is resolved against its CDN host.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game entry. Most entries are paths on one of the CDNs above;
// entries that are already absolute (http/https) are third-party embeds and
// are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Resolve a gameIndex to a full URL. Entries may be absolute (https://...)
// when the game is hosted on another site; otherwise it is a path served by
// one of the CDN hosts above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Absolute http(s) URLs are third-party games that
// are not mirrored into a repo, so they are used as-is; everything else is a
// relative path served from the host picked by gameCdn().
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute gameIndex (http/https) means the game lives on another host and is
// embedded directly; relative ones are routed to a repo above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URL for a gameIndex that already points at an external host
// (entries added from other catalogs). Everything else is resolved through
// gameCdn() so the path is appended to the right Pages repo.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Final URL for a gameIndex. Absolute http(s) URLs (games hosted on another
// site) are used as-is; everything else is prefixed with its CDN host.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute game URLs (gameIndex starting with "http://"/"https://") are games
// hosted somewhere else — point the iframe straight at them instead of prefixing
// a CDN host.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URLs (external hosts) are used as-is; relative paths are routed to
// the matching CDN. Everything that turns a gameIndex into a playable URL
// should go through this.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Entries that are already absolute (games we do
// not host ourselves) are used as-is; everything else is routed to its host.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game entry. Entries that already carry a scheme (absolute
// external hosts such as "https://example.com/game/") are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. Entries whose gameIndex is already an absolute
// http(s) URL point at an external host (games we mirror from other sites),
// everything else is served from the matching CDN above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Absolute entries (an external site we embed, e.g.
// "https://...") are used as-is; everything else is routed through gameCdn().
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute game URLs (http/https) are hosted off-site and are used as-is —
// everything else is a path that gets the host chosen by gameCdn().
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URLs (gameIndex starting with "http://"/"https://") are hosted by a
// third party, so they must be used as-is instead of being prefixed.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Absolute http(s) URLs are used as-is — that is how
// games hosted on other people's servers (listed in list_games.json) are loaded.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. gameIndex is normally a path relative to its host
// (e.g. "games/2048/index.html"), but entries can also be absolute http(s)
// URLs when the game is hosted by a third party (see list_games.json).
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URLs (gameIndex starting with http/https) point straight at an
// external host, so they skip gameCdn entirely.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Absolute entries (http/https) point straight at
// the game host — used for games we link out to instead of self-hosting.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Build the final iframe URL for a gameIndex. Relative indexes are prefixed
// with the host picked by gameCdn(); absolute indexes (https://...) are third
// party embeds and are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Absolute http(s) indexes (games hosted on an
// external site, e.g. Skoolgq's Polaris-Assets pages) are used as-is; relative
// ones are resolved against the host that serves that path prefix.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Build the final URL for a gameIndex. Absolute http(s) gameIndex values point
// straight at a third-party host (no CDN prefix), relative ones are resolved
// against the host picked by gameCdn().
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Final URL for a gameIndex. Entries that are already absolute (http/https)
// point straight at an external host that we do not mirror; everything else is
// a path on one of the CDNs above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute game URLs (gameIndex starting with "http://"/"https://") are hosted
// off-site, so there is no base to prepend.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URLs (gameIndex starting with http:// or https://) are hosted on a
// third-party site, so there is no CDN prefix to add — use them as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Entries may be an absolute http(s) URL when the
// game is hosted by a third party (see list_games.json), otherwise it is a
// path that belongs on one of the CDNs above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Entries whose gameIndex is already an absolute
// http(s) URL (games we embed straight from their original host) are returned
// untouched; everything else is resolved against the right CDN above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Absolute http(s) gameIndexes are third-party
// hosted games (see list_games.json) and are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Entries whose gameIndex is already an absolute
// http(s) URL (games hosted by third parties) are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Absolute http(s) entries (games hosted on another
// site, e.g. Polaris-Assets) are used as-is; everything else is routed to the
// matching CDN above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Resolve a gameIndex to a playable URL. Entries whose gameIndex is already an
// absolute http(s) URL point at an external host (games we do not host
// ourselves) and are used verbatim instead of being prefixed with a CDN.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full playable URL for a gameIndex. Entries in list_games.json are normally
// relative paths (resolved against the right repo by gameCdn above), but some
// games are hosted on a third-party site and are stored as absolute http(s)
// URLs — those are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Build the final URL for a gameIndex. Absolute gameIndex values (external
// games, e.g. "https://example.com/game/") are used as-is; everything else
// is served from the host that owns that path prefix.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URLs (gameIndex starting with "http://"/"https://") are hosted by a
// third party (mirrors, itch, gamedistribution, ...) and are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Build the final iframe URL for a gameIndex. Absolute URLs (games we point at
// an external host instead of our own CDN repos) are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Absolute URLs (http/https) are used as-is so the
// catalog can point at games hosted on other sites; everything else is served
// from the matching CDN above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Build the final URL for a gameIndex. Entries that already carry a full
// http(s) URL are hosted outside our CDNs (third-party embeds) and are used
// as-is; everything else is resolved against the matching host above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URLs are used for games hosted on third-party sites (see the
// entries in list_games.json whose gameIndex starts with "http").
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Build the full URL for a game. Entries whose gameIndex is already absolute
// (http/https, e.g. an externally hosted Polaris game) are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. gameIndex is normally a repo-relative path (e.g.
// "games/2048/index.html") that gets prefixed with its host, but some catalog
// entries point straight at a third-party host and are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Resolve a gameIndex to a full URL. Absolute http(s) gameIndex values (games
// hosted on another site) are used as-is; everything else is prefixed with the
// matching repo CDN above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Build the URL a game actually loads from. Absolute gameIndex values (http/https)
// point straight at an external host, everything else goes through gameCdn().
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game entry. Absolute entries (https://...) are games we link
// straight at their own host instead of copying them into the CDN.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. gameIndex may be an absolute http(s) URL (games hosted
// on another site, e.g. Polaris-Assets) — those are used as-is; everything else
// is a path resolved against the right CDN above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. Entries whose gameIndex is already absolute (http/https)
// point at an external host directly instead of one of the CDN bases above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URLs (http/https) are used as-is; everything else is treated as a
// path on one of the CDNs above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URLs (http/https) are used as-is — these are games hosted on
// other sites that we embed directly instead of self-hosting.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute game URLs (gameIndex starting with "http://" or "https://") are
// already complete — they point at a host outside our own CDN repos.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URLs (gameIndex starting with http:// or https://) point straight
// at an external host, so skip the CDN prefix entirely.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Absolute targets (games we point straight at an
// external host, like the Polaris catalog) are used as-is; everything else is
// prefixed with the matching CDN.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Resolve a gameIndex to a full URL. Absolute URLs (games hosted outside our
// CDNs — "https://…/index.html") are used as-is, everything else is prefixed
// with the host picked by gameCdn().
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. Absolute http(s) entries point straight at an external
// host (games we embed from their official site), relative ones go through
// gameCdn() above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Resolve a gameIndex to a full URL. Entries that already carry a scheme are
// hosted off our CDNs (third-party embeds) and are used as-is.
function gameUrl(gameIndex) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. Entries whose gameIndex is already absolute (http/https)
// point at an external host, so they skip the CDN prefix.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Entries whose gameIndex is already absolute
// (http/https) point at a third-party host (e.g. Polaris-Assets on GitHub
// Pages) and are used as-is; everything else is resolved against its CDN.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Entries whose gameIndex is already absolute
// (http/https) point at an external host and are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute game URLs (gameIndex starting with "http://"/"https://") are hosted
// on another site, so skip the CDN host entirely.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URLs are used for games we borrow from other hosts (see
// list_games.json gameIndex starting with "http"). They are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Absolute http(s) URLs are used as-is so catalog
// entries can point at games hosted on other sites (see list_games.json).
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Final URL for a gameIndex. Absolute http(s) targets (games that live on
// another host, e.g. the Polaris catalog) are used as-is, otherwise the file
// is resolved against the repo that owns the path prefix.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. Absolute URLs (http/https) are used as-is so catalog
// entries can point at games hosted on other sites; everything else is joined
// onto the host picked by gameCdn().
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URLs are used for games we embed straight from their own host
// (e.g. https://slither.io) instead of copying the files into a repo.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute gameIndex values (http/https) are hosted outside our own CDNs —
// they are used as-is so a single catalog entry can point at any site.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Catalog entries may point straight at an external
// host (absolute http(s) URL) instead of a path on our CDNs — keep those as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. Absolute http(s) gameIndex values point straight at an
// external host (used for games we borrow instead of mirroring); everything
// else is a path served from the host picked above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute game URLs (gameIndex is a full http(s) URL) are hosted by a third
// party, so they are used as-is instead of being prefixed with a CDN host.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. gameIndex is normally a repo-relative path (routed
// through gameCdn above), but catalog entries may also point straight at an
// external host — those are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. Entries whose gameIndex is already absolute (another
// site's hosted copy) are used as-is; everything else is served from its CDN.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. Absolute gameIndex values (http/https) are third-party
// games hosted elsewhere — use them as-is instead of prefixing a CDN host.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Build the final frame URL for a game. gameIndex is normally a relative path
// on one of the CDNs above, but entries can also be absolute http(s) URLs that
// point at a third-party host (games imported from other sites) — pass those
// straight through.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Absolute http(s) URLs (games hosted on another
// site) are used as-is; everything else is joined onto its CDN base.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Final playable URL for a catalog entry. gameIndex is normally a path inside
// one of the CDNs above, but entries pulled from other sites may be absolute
// http(s) URLs, which are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute game URLs (cross-host embeds from other catalogs) are used as-is;
// everything else is resolved against the host picked by gameCdn.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. Entries whose gameIndex is already absolute
// (http/https, e.g. an external embed) are used as-is; everything else is
// prefixed with the host that serves it.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. Absolute http(s) entries (games mirrored from other
// hosts) are used as-is; everything else is served from its owning CDN.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URLs (https://...) are used by games hosted on third-party sites,
// so list_games.json entries may point straight at them instead of a path on
// one of the CDNs above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URLs (http/https) are used as-is — entries in list_games.json that
// point straight at an external host (e.g. GitHub Pages game repos) skip the
// CDN entirely. Everything else is prefixed with its host CDN.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute gameIndex values (https://...) are hosted outside our CDNs and are
// used as-is, so a single helper builds the final iframe URL for any game.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Build the final frame URL for a gameIndex. Absolute gameIndex values
// (e.g. "https://example.com/game/") are used as-is so games hosted on
// other sites can be embedded without copying their files into a CDN.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute game URLs (external hosts) are used as-is; anything else is a
// relative path on one of the CDNs above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Build the final URL for a gameIndex. Entries whose gameIndex is already an
// absolute http(s) URL point at a third-party host (games we do not mirror on
// our own CDNs) and are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute game URLs (https://... in gameIndex) are hosted off our CDNs, so
// they are used as-is instead of being prefixed with a CDN base.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. Entries whose gameIndex is already absolute (http/https)
// point at a third-party host directly instead of one of the CDNs above.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex)) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Entries that are already absolute (external hosts
// such as github.io/game CDNs) are used as-is instead of being prefixed.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Reverse proxy for multiplayer games. The site is HTTPS, so the games (and
// their WebSockets) must go through an HTTPS proxy or the browser blocks them
// as mixed content. This is the Cloudflare Worker (see proxy-worker/README.md
// for deploy steps). UPDATE THIS after deploying the worker:
//   https://rcdn-proxy.<your-subdomain>.workers.dev
const GAME_PROXY = "https://rcdn-proxy.<ACCOUNT>.workers.dev";
// Resolve a gameIndex to a full URL. Entries can be a path on one of the CDNs
// above ("games/2048/index.html") or an absolute http(s) URL to a game hosted
// on another site (the way Polaris links its external titles).
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a game. gameIndex is normally a relative path served from the
// catalog CDNs above, but entries may also be absolute http(s) URLs pointing at
// an external host (games we embed from another site).
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Full URL for a gameIndex. Entries whose gameIndex is already absolute
// (https://...) are third-party games hosted off our CDNs and are used as-is.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URLs (http/https) in gameIndex point straight at an external host
// instead of one of the CDNs above, so the entry needs no local game folder.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Final URL for a gameIndex. Absolute http(s) gameIndex values (games we
// borrow from other hosts) are used as-is; everything else is prefixed with
// the host chosen by gameCdn().
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Absolute URLs (http/https) in a gameIndex point straight at an external
// host, so they are used as-is instead of being prefixed with a CDN base.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
// Final URL for a gameIndex. Absolute http(s) gameIndexes (externally hosted
// games, e.g. Polaris-Assets on GitHub Pages) are used as-is; relative ones go
// through gameCdn() to pick the right repo.
function gameUrl(gameIndex) {
    if (/^https?:\/\//i.test(gameIndex || "")) return gameIndex;
    return gameCdn(gameIndex) + gameIndex;
}
window.gameUrl = gameUrl;
window.gameCdn = gameCdn;

// The r-cdn GitHub Pages build now fails (the repo is well past the Pages
// size limit), so the catalogue is read straight from the repo: raw first for
// freshness, then jsDelivr, then the still-deployed Pages copy as a fallback.
async function loadGameCatalog() {
    const sources = [
        "https://raw.githubusercontent.com/ramiis324/r-cdn/main/list_games.json",
        "https://cdn.jsdelivr.net/gh/ramiis324/r-cdn@main/list_games.json",
        CDN + "list_games.json"
    ];
    for (const url of sources) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 3500);
        try {
            const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
            if (res.ok) return await res.json();
        } catch (e) {} finally { clearTimeout(timer); }
    }
    return [];
}
window.loadGameCatalog = loadGameCatalog;

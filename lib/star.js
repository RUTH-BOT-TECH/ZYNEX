/**
 * lib/star.js — repo star count and star URL, for the pairing page and `.repo`.
 *
 * ★ The constraint, stated plainly
 *
 * GitHub does NOT allow starring without authentication. PUT
 * /user/starred/{owner}/{repo} answers 401 to anything unauthenticated, and the
 * official buttons.github.io widget is a link with a count, not a star action.
 * No page can star a repository on a visitor's behalf.
 *
 * What CAN be done without any setup by the user:
 *   - show the live star count so the page is not a dead link
 *   - send them straight to the repo, where GitHub's own button is one click
 *   - once they are signed in on github.com, that click needs no further login
 *
 * What would score a star automatically, and why it is not here: a GitHub App
 * with the Starring permission and an OAuth callback. That means registering an
 * App, storing a client secret, and asking every visitor to authorize it before
 * their star is recorded. The research says GitHub explicitly treats starred
 * repos as a weak signal for this reason. Not worth the secret-handling risk on
 * a bot pairing page. If it is ever wanted, the files to change are this one,
 * the /api/star route in server.js, and the button in public/index.html.
 */
const axios = require('axios');

const { REPO_URL } = require('./botInfo');

const CACHE_MS = 10 * 60_000;   // GitHub's unauthenticated limit is 60/hr per IP

let cache = { at: 0, value: null };

/** owner/repo parsed from REPO_URL, e.g. "RUTH-BOT-TECH/ZYNEX" */
function repoSlug(url = REPO_URL) {
  const m = String(url).match(/github\.com[/:]+([^/]+)\/([^/#?]+)/i);
  if (!m) return null;
  return `${m[1]}/${m[2].replace(/\.git$/i, '')}`;
}

/**
 * Live star count. Returns null rather than throwing — a page must render even
 * when the API is rate-limited, and a stale count is worse than an honest blank.
 */
async function starCount() {
  if (cache.value !== null && Date.now() - cache.at < CACHE_MS) return cache.value;

  const slug = repoSlug();
  if (!slug) return null;

  try {
    const res = await axios.get(`https://api.github.com/repos/${slug}`, {
      timeout: 8000,
      headers: {
        'User-Agent': require('./botInfo').BOT_NAME,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
      validateStatus: () => true,
    });

    if (res.status === 404) {
      console.warn(`[STAR] ${slug} answered 404 — repo renamed, private, or the URL is wrong`);
      return null;
    }
    if (res.status === 403) {
      console.warn('[STAR] rate limited by GitHub — serving no count until the window resets');
      return null;
    }
    if (res.status >= 400) {
      console.warn(`[STAR] GitHub answered HTTP ${res.status}`);
      return null;
    }

    const value = {
      slug,
      stars: Number(res.data.stargazers_count) || 0,
      forks: Number(res.data.forks_count) || 0,
      url: res.data.html_url || REPO_URL,
      fetchedAt: new Date().toISOString(),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch (e) {
    console.warn(`[STAR] could not read the count: ${e.message}`);
    return null;
  }
}

/**
 * The link to put in front of a user.
 *
 * There is no query string that pre-fills a star, so the best available
 * affordance is the repository page itself, opened in a new tab. `?tab=` and
 * `#` anchors do not change this; anything that looks like a star shortcut
 * would be a lie.
 */
function starUrl() {
  return REPO_URL;
}

module.exports = { starCount, starUrl, repoSlug, _cache: () => cache, _clear: () => { cache = { at: 0, value: null }; } };

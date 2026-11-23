/**
 * lib/engines/lookup.js — keyless public-data lookups.
 *
 *   .aqi <city>        Open-Meteo air quality (no key)
 *   .uv <city>         Open-Meteo UV index (no key)
 *   .earthquake        USGS earthquake feed (no key)
 *   .pronounce <word>  dictionaryapi.dev syllables + audio (no key)
 *
 * NOVA ships these behind its own API keys. These use the public sources
 * directly, so they cannot break when a key expires — and every failure path
 * says which upstream refused, because a silent "no data" is indistinguishable
 * from a crash.
 *
 * Deliberately NOT built here: phonetic / ffinfolike / fflike — excluded on
 * request.
 */
const axios = require('axios');

const UA = 'ZYNEX-MD/1.0 (+https://github.com/RUTH-BOT-TECH/ZYNEX)';
const TIMEOUT = 12_000;

async function get(url, opts = {}) {
  const res = await axios.get(url, {
    timeout: TIMEOUT,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) },
    validateStatus: () => true,
  });
  if (res.status >= 400) {
    throw new Error(`upstream answered HTTP ${res.status}`);
  }
  return res.data;
}

/* ── geocoding, shared by aqi/uv ────────────────────────────
 * Open-Meteo's geocoder is the same service family as the forecast API,
 * so one round trip here resolves both. */
async function geocode(place) {
  const q = String(place || '').trim();
  if (!q) throw new Error('Give me a city — e.g. `.aqi Lagos`');
  const data = await get(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`,
  );
  const hit = (data.results || [])[0];
  if (!hit) throw new Error(`I could not find "${q}". Try a bigger nearby city.`);
  return {
    name: hit.name,
    country: hit.country,
    admin: hit.admin1,
    lat: hit.latitude,
    lon: hit.longitude,
    timezone: hit.timezone,
  };
}

/* ── AQI bands, the official US EPA breakpoints ─────────────
 * Reporting a bare number is useless: 120 means nothing without "unhealthy
 * for sensitive groups". */
function aqiBand(aqi) {
  if (aqi <= 50) return { label: 'Good', emoji: '🟢', advice: 'Air quality is fine.' };
  if (aqi <= 100) return { label: 'Moderate', emoji: '🟡', advice: 'Acceptable; unusually sensitive people may notice it.' };
  if (aqi <= 150) return { label: 'Unhealthy for sensitive groups', emoji: '🟠', advice: 'Asthma and heart conditions: reduce prolonged outdoor effort.' };
  if (aqi <= 200) return { label: 'Unhealthy', emoji: '🔴', advice: 'Everyone may feel effects. Limit time outdoors.' };
  if (aqi <= 300) return { label: 'Very unhealthy', emoji: '🟣', advice: 'Health alert. Avoid outdoor exertion.' };
  return { label: 'Hazardous', emoji: '⚫', advice: 'Emergency conditions. Stay indoors.' };
}

function uvBand(uv) {
  if (uv < 3) return { label: 'Low', emoji: '🟢', advice: 'No protection needed.' };
  if (uv < 6) return { label: 'Moderate', emoji: '🟡', advice: 'Shade at midday; sunscreen if fair-skinned.' };
  if (uv < 8) return { label: 'High', emoji: '🟠', advice: 'Sunscreen, hat, and shade around noon.' };
  if (uv < 11) return { label: 'Very high', emoji: '🔴', advice: 'Avoid sun between 10am and 4pm.' };
  return { label: 'Extreme', emoji: '🟣', advice: 'Stay out of the sun. Skin can burn in minutes.' };
}

/* ── USGS earthquake feed ───────────────────────────────────
 * summary/4.5_day.geojson is the documented monthly feed of notable quakes. */
async function earthquakes(limit = 8) {
  const data = await get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson');
  const feats = (data.features || [])
    .slice()
    .sort((a, b) => (b.properties.time || 0) - (a.properties.time || 0))
    .slice(0, Math.max(1, Math.min(20, limit)));
  if (!feats.length) return { count: 0, items: [] };
  return {
    count: data.features.length,
    items: feats.map((f) => {
      const p = f.properties || {};
      const mag = p.mag;
      const place = p.place || 'unknown location';
      const when = new Date(p.time);
      const depthKm = f.geometry && f.geometry.coordinates ? f.geometry.coordinates[2] : null;
      return { mag, place, when, depthKm, url: p.url };
    }),
  };
}

/* ── pronunciation ──────────────────────────────────────────
 * dictionaryapi.dev returns phonetics with an audio URL when it has one.
 * Many words have no audio — say so rather than dropping the field. */
async function pronounce(word) {
  const w = String(word || '').trim().toLowerCase();
  if (!w) throw new Error('Which word? e.g. `.pronounce schedule`');
  if (!/^[a-z][a-z'-]{0,40}$/i.test(w)) throw new Error('That does not look like a single word.');
  const data = await get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
  const entry = Array.isArray(data) ? data[0] : null;
  if (!entry) throw new Error(`No dictionary entry for "${w}".`);
  const phonetics = entry.phonetics || [];
  const withAudio = phonetics.find((p) => p.audio);
  const text = entry.phonetic || (phonetics.find((p) => p.text) || {}).text || null;
  const meaning = (entry.meanings || [])[0];
  return {
    word: entry.word,
    phonetic: text,
    audio: withAudio ? withAudio.audio : null,
    partOfSpeech: meaning ? meaning.partOfSpeech : null,
    definition: meaning && meaning.definitions && meaning.definitions[0]
      ? meaning.definitions[0].definition
      : null,
  };
}

/* ── engine ───────────────────────────────────────────────── */
const NAMES = new Set(['aqi', 'airquality', 'uv', 'uvindex', 'earthquake', 'quakes', 'pronounce', 'say']);

module.exports = {
  id: 'lookup',
  name: 'lookup-engine',
  extraNames: [...NAMES],

  match(name) { return NAMES.has(name); },

  async execute({ command, args, argString, reply }) {
    const text = (argString || args.join(' ')).trim();

    try {
      if (command === 'aqi' || command === 'airquality') {
        const place = await geocode(text);
        const air = await get(
          `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${place.lat}&longitude=${place.lon}` +
          '&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&timezone=auto',
        );
        const c = air.current || {};
        const aqi = Math.round(c.us_aqi ?? -1);
        if (!Number.isFinite(aqi) || aqi < 0) throw new Error('Open-Meteo returned no AQI for that location.');
        const band = aqiBand(aqi);
        const where = [place.name, place.admin, place.country].filter(Boolean).join(', ');
        return reply(
          `${band.emoji} *Air quality — ${where}*\n\n` +
          `AQI: *${aqi}* — ${band.label}\n` +
          `PM2.5: ${c.pm2_5 ?? '—'} µg/m³\n` +
          `PM10: ${c.pm10 ?? '—'} µg/m³\n` +
          `Ozone: ${c.ozone ?? '—'} µg/m³\n` +
          `NO₂: ${c.nitrogen_dioxide ?? '—'} µg/m³\n\n` +
          `_${band.advice}_\n` +
          '_Source: Open-Meteo (US EPA scale)_',
        );
      }

      if (command === 'uv' || command === 'uvindex') {
        const place = await geocode(text);
        const wx = await get(
          `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
          '&current=uv_index,cloud_cover&daily=uv_index_max&timezone=auto&forecast_days=1',
        );
        const uv = wx.current ? wx.current.uv_index : null;
        if (uv === null || uv === undefined) throw new Error('Open-Meteo returned no UV index for that location.');
        const band = uvBand(uv);
        const peak = wx.daily && wx.daily.uv_index_max ? wx.daily.uv_index_max[0] : null;
        const where = [place.name, place.admin, place.country].filter(Boolean).join(', ');
        return reply(
          `${band.emoji} *UV index — ${where}*\n\n` +
          `Now: *${uv}* — ${band.label}\n` +
          (peak !== null ? `Peak today: *${peak}*\n` : '') +
          `Cloud cover: ${wx.current && wx.current.cloud_cover !== undefined ? wx.current.cloud_cover + '%' : '—'}\n\n` +
          `_${band.advice}_\n` +
          '_Source: Open-Meteo_',
        );
      }

      if (command === 'earthquake' || command === 'quakes') {
        const limit = parseInt(text, 10) || 8;
        const { count, items } = await earthquakes(limit);
        if (!items.length) {
          return reply('🌍 No magnitude 4.5+ earthquakes in the past week. Quiet week.');
        }
        const lines = items.map((q) => {
          const mag = Number(q.mag).toFixed(1);
          const ago = Math.round((Date.now() - q.when.getTime()) / 3_600_000);
          const depth = q.depthKm !== null ? `${Math.round(q.depthKm)}km deep` : '';
          return `*M${mag}* — ${q.place}\n     _${ago}h ago${depth ? ', ' + depth : ''}_`;
        });
        return reply(
          `🌍 *Recent earthquakes (M4.5+)*\n\n${lines.join('\n\n')}\n\n` +
          `_${count} this week worldwide · Source: USGS_`,
        );
      }

      if (command === 'pronounce' || command === 'say') {
        const p = await pronounce(text);
        let out =
          `🗣️ *${p.word}*\n\n` +
          (p.phonetic ? `/${p.phonetic.replace(/\//g, '')}/\n` : '') +
          (p.partOfSpeech ? `_${p.partOfSpeech}_\n` : '') +
          (p.definition ? `${p.definition}\n` : '');
        if (p.audio) {
          out += `\n🔊 Audio available — the recording is attached.`;
          const audio = await axios.get(p.audio, {
            timeout: TIMEOUT, responseType: 'arraybuffer',
            headers: { 'User-Agent': UA }, validateStatus: () => true,
          });
          if (audio.status >= 400) {
            return reply(out + `\n\n⚠️ _Audio link answered HTTP ${audio.status} — text shown above._`);
          }
          return { text: out.replace('\n\n🔊 Audio available — the recording is attached.', ''), audio: Buffer.from(audio.data) };
        }
        return reply(out + '\n_No audio recording exists for this word — text only._');
      }

      return reply(`❌ \`${command}\` is not wired in the lookup engine.`);
    } catch (e) {
      // Named upstream, never a bare "something went wrong".
      return reply(`❌ *${command} failed*\n\n${e.message}\n\n_${e.code === 'ECONNABORTED' ? 'The upstream timed out — try again.' : 'Nothing was cached, so this reflects the live service.'}_`);
    }
  },
};

module.exports._internal = { aqiBand, uvBand, geocode, earthquakes, pronounce };

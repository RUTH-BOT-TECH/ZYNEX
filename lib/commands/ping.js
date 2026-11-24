/**
 * .ping — one message, one honest number.
 *
 * ★ This used to send twice for a single command: "🏓 Pinging..." then the
 * result. That is two notifications on the user's phone for one command, and it
 * made the number meaningless — it measured the round trip of sending
 * "Pinging...", a message nobody cares about, rather than how long the user
 * actually waited.
 *
 * What we measure instead: the gap between the incoming message's own server
 * timestamp and the moment we hand the reply to the socket. That is the time
 * the user genuinely waited, end to end, and it needs no placeholder message to
 * compute. If the delta is large it gets split out, so a slow network is not
 * reported as a slow bot.
 */
module.exports = {
  name: 'ping',
  aliases: ['alive', 'speed'],
  desc: 'Check bot response time',
  category: 'main',
  async execute({ reply, botName, msg }) {
    const now = Date.now();

    const sent = msg?.key?.messageTimestamp;
    const sentMs = sent ? (typeof sent === 'number' ? sent * 1000 : Number(sent)) : null;
    // A timestamp in the future (clock skew) or absurdly old (history sync) is
    // not a latency, and printing it would be worse than printing nothing.
    const waited = sentMs && sentMs <= now && now - sentMs < 120000 ? now - sentMs : null;

    const lines = [
      '🏓 *PONG!*',
      '',
      waited != null
        ? `⚡ *Round trip:* ${waited}ms`
        : '⚡ *Reply:* sent',
      waited != null && waited > 3000 ? '_Most of that was message delivery, not the bot._' : null,
      '📡 *Status:* Online',
      `✅ *Bot:* ${botName || require('../botInfo').BOT_NAME}`,
      `⏱️ *Uptime:* ${formatUptime(process.uptime())}`,
      `🕐 *Time:* ${new Date().toLocaleTimeString()}`,
    ].filter(Boolean);

    return reply(lines.join('\n'));
  },
};

function formatUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return [d ? `${d}d` : null, h ? `${h}h` : null, `${m}m`].filter(Boolean).join(' ');
}

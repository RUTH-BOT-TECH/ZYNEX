/**
 * .restart — reconnect this bot's socket without exiting the process.
 *
 * Previously: reply "Restarting…", then `process.exit(0)`.
 *
 * On a shared pairing server that is destructive. The process hosts the web
 * panel and every paired user's socket, so exiting for one user's `.restart`
 * dropped everyone and took https://<app>/ down. And because it exited with
 * code 0, Railway's restartPolicyType "ON_FAILURE" treated it as an intentional
 * shutdown rather than a crash and did NOT restart it — the site returned 502
 * until a manual redeploy.
 *
 * Reconnecting in place gives the same "my bot just restarted" effect with no
 * outage. If a full process restart is ever genuinely needed, that is a
 * deployment action, not a chat command.
 */
module.exports = {
  name: 'restart',
  aliases: ['reboot'],
  desc: 'Reconnect your bot socket (keeps the web panel and other users online)',
  category: 'owner',
  async execute({ reply, dbSession }) {
    await reply(
      '🔄 Reconnecting your bot…\n\n' +
        '_The panel and other paired numbers stay online — this only re-establishes this session._',
    );

    try {
      const sessionManager = require('../sessionManager');
      const result = await sessionManager.restartInPlace();
      if (typeof reply === 'function') {
        // No second reply: reply() is bound to the OLD socket for this session,
        // which has just been torn down. Log it instead of throwing at the user.
        console.log(`[RESTART] ${dbSession?.phoneNumber || 'session'} reconnected (${result.reconnected} live)`);
      }
    } catch (e) {
      console.error('[RESTART] failed:', e.message);
      try {
        await reply(`❌ Could not reconnect: ${e.message}\n_Try \`.ping\` in a moment; if it stays dead, redeploy from the panel._`);
      } catch {}
    }
  },
};

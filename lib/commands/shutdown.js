/**
 * .shutdown — detach THIS bot session.
 *
 * Previously: reply "shutting down", then `process.exit(1)`.
 *
 * `process.exit` affects the whole host, so any paired user issuing `.shutdown`
 * killed the web panel and every other user's bot — and with restartPolicyType
 * ON_FAILURE it would at least come back, but only after an outage for everyone.
 * A chat command should not be able to do that. This closes the caller's own
 * socket and marks the session disconnected; the auth folder is kept so the
 * number can be resumed with `.restart` without re-pairing.
 *
 * To stop the whole service, use the Railway dashboard (or `.restart` after a
 * deploy) — deliberately not reachable from a chat message.
 */
module.exports = {
  name: 'shutdown',
  aliases: ['stop', 'off'],
  desc: 'Detach this bot session (the panel and other users stay online)',
  category: 'owner',
  async execute({ reply, dbSession }) {
    await reply(
      '🔴 Detaching this bot session.\n\n' +
        '_Your pairing is kept — send `.restart` any time, or use the panel. Other paired numbers and the website are unaffected._',
    );
    const id = dbSession?.id;
    if (!id) return;
    try {
      const sessionManager = require('../sessionManager');
      // removeSession logs out and clears creds — too destructive here.
      // Just drop the live socket; the DB row stays so it can be resumed.
      await sessionManager.stopSession(id, { keepCreds: true });
    } catch (e) {
      console.error('[SHUTDOWN] failed:', e.message);
      try {
        await reply(`❌ Could not detach: ${e.message}`);
      } catch {}
    }
  },
};

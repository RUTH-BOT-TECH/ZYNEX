/** .owner — Show owner info (every user is their own owner) */
const { OWNER_NAME, OWNER_LOCAL, REPO_URL, ownerWaLink } = require('../botInfo');
module.exports = {
  name: 'owner',
  aliases: ['creator', 'dev', 'contact', 'me'],
  desc: 'Show your bot owner info',
  category: 'info',
  async execute({ reply, botName, dbSession, pushName }) {
    const ownerNumber = dbSession?.phoneNumber || 'unknown';
    const ownerName = dbSession?.displayName || pushName || 'You';

    await reply(`╔══════════════════════════════╗
║      ${botName} - OWNER         ║
╚══════════════════════════════╝

👑 *Owner:* ${ownerName}
📱 *WhatsApp:* wa.me/${ownerNumber}
🤖 *Bot:* ${botName}
🟢 *Mode:* ${dbSession?.mode || 'public'}

┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
🛠️ *Bot made by:* ${OWNER_NAME}
📞 ${OWNER_LOCAL} · ${ownerWaLink()}
🔗 ${REPO_URL}

_You are the owner of this bot instance._
_Type ${'.'}menu to see commands_`);
  },
};

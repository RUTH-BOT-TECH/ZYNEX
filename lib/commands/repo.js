/**
 * .repo — Show the bot's GitHub repo + owner contact
 *
 * Every value comes from lib/botInfo.js. This command previously shipped
 * "YOUR-USERNAME" and "2348000000000" to users as if they were real.
 */

const { REPO_URL, OWNER_NAME, OWNER_LOCAL, ownerWaLink } = require('../botInfo');

module.exports = {
  name: 'repo',
  aliases: ['github', 'source', 'code', 'script'],
  desc: 'Show bot repository + owner contact',
  category: 'info',
  async execute({ reply, botName }) {
    await reply(
      `┏▣ ◈ *${botName} REPOSITORY* ◈
┗▣


🤖 *This Mini Bot:*
${REPO_URL}

👑 *Owner:* ${OWNER_NAME}
📱 *WhatsApp:* ${ownerWaLink()}
📞 *Number:* ${OWNER_LOCAL}
💬 *Tap the link above to chat directly*

╭═══════════════════════✦═╗
║  *Enjoy ZYNEX* 👑      ║
╚═══════════════════════✦═╝

_🌟 Star the repo if you like the bot!_
_🚀 Powered by ${botName} X ZYNEX_

\`for premium Whatsapp bot dm\``
    );
  },
};

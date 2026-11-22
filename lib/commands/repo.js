/**
 * .repo — Show the bot's GitHub repo + owner contact
 *
 * Shows the zynex URL + owner contact info.
 */

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
https://github.com/YOUR-USERNAME/zynex-md

👑 *Owner:* ZYNEX
📱 *WhatsApp:* wa.me/2348000000000
💬 

╭═══════════════════════✦═╗
║  *Enjoy ZYNEX* 👑      ║
╚═══════════════════════✦═╝

_🌟 Star the repo if you like the bot!_
_🚀 Powered by ${botName} X ZYNEX_

\`for premium Whatsapp bot dm\``
    );
  },
};

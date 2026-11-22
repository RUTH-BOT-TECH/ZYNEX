/** .joke — Random joke */

module.exports = {
  name: 'joke',
  aliases: ['haha', 'funny'],
  desc: 'Get a random joke',
  category: 'fun',
  async execute({
  reply }) {
  const axios = require('axios');
    try {
      const res = await axios.get('https://v2.jokeapi.dev/joke/Any?type=single&safe-mode', { timeout: 8000 });
      if (res.data?.joke) {
        await reply(`😂 *Joke time!*\n\n${res.data.joke}`);
      } else {
        await reply(`😂 *Joke time!*\n\n${res.data.setup}\n\n${res.data.delivery}`);
      }
    } catch {
      await reply(`😂 *Joke time!*\n\nWhy don't programmers like nature?\n\nIt has too many bugs.`);
    }
  },
};

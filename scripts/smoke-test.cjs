/**
 * Smoke-tests every command with a mocked socket.
 * Network commands hit live APIs — run from a normal machine, not behind a proxy.
 *   node scripts/smoke-test.cjs [--network]
 */
const fs = require('fs');
const path = require('path');

const OFFLINE_ONLY = !process.argv.includes('--network');

// commands that need network / special input
const NETWORK = new Set(['song','google','weather','wiki','translate','logo','tts','status','groupst','qr','url','fact','joke','quote','dare','truth','autorespond','antibot','antibug','anticall','antidelete','antilink']);
const NEEDS_ARGS = new Set(['kick','promote','demote','mute','unmute','setname','setdesc','setprefix','block','unblock','dp','pp','setbotimage','logo','tts','translate','url','wiki','weather','google','calculate','qr','play','song','link','revoke']);
const NEEDS_MEDIA = new Set(['sticker','vv','setbotimage','pp','dp']);

const results = [];
function record(name, ok, note = '') {
  results.push({ name, ok, note });
  const mark = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  if (!ok || process.argv.includes('-v')) console.log(`  ${mark} ${name}${note ? ' — ' + note : ''}`);
}

const fakeSock = () => ({
  sendMessage: async () => ({}),
  updateMediaMessage: async () => {},
  groupMetadata: async () => ({
    id: '120363000000000000@g.us', subject: 'Test', creation: 1700000000, desc: 'x',
    participants: [{ id: '2348021016309@s.whatsapp.net', admin: 'superadmin' }],
  }),
  groupParticipantsUpdate: async () => [{ status: '200' }],
  user: { id: '2348021016309:1@s.whatsapp.net', name: 'ZYNEX-MD' },
  profilePictureUrl: async () => 'https://example.com/a.jpg',
});

const fakeMsg = (text = '') => ({
  key: { remoteJid: '120363000000000000@g.us', fromMe: false, id: 'SMOKE1', participant: '2348021016309@s.whatsapp.net' },
  message: { conversation: text },
  pushName: 'ZYNEX',
  messageTimestamp: Math.floor(Date.now() / 1000),
});

const baseCtx = (args, text) => {
  const sock = fakeSock();
  const msg = fakeMsg(text);
  return {
    sock, msg, args, argString: args.join(' '),
    from: msg.key.remoteJid,
    sender: '2348021016309@s.whatsapp.net',
    senderNum: '2348021016309',
    text, body: text, isGroup: true, isOwner: true, isMe: false, prefix: '.',
    botName: 'ZYNEX-MD', ownwer: 'ZYNEXX', config: {},
    reply: async () => ({}),
    send: async () => ({}),
    react: async () => ({}),
    sendTo: async () => ({}),
    download: async () => Buffer.from('fake'),
    delay: async () => {},
    logger: { info() {}, warn() {}, error() {} },
  };
};

(async () => {
  // Some commands (shutdown, restart, disconnect) call process.exit — stub it
  // so the harness survives long enough to report.
  const realExit = process.exit.bind(process);
  const exitCalls = [];
  process.exit = ((code) => { exitCalls.push(code); }) ;

  const dir = path.join(__dirname, '..', 'lib', 'commands');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  console.log(`\n\x1b[1mZYNEX-MD — smoke test\x1b[0m  ${files.length} command files${OFFLINE_ONLY ? '  (offline mode)' : '  (incl. network)'}\n`);

  for (const f of files) {
    const name = f.replace('.js', '');
    if (OFFLINE_ONLY && NETWORK.has(name)) { record(`${name} (skipped: network)`, true); continue; }

    let cmd;
    try {
      cmd = require(path.join(dir, f));
    } catch (e) {
      record(name, false, 'LOAD FAILED: ' + e.message);
      continue;
    }
    if (!cmd?.name || typeof cmd.execute !== 'function') { record(name, false, 'missing name/execute'); continue; }

    const args = NEEDS_ARGS.has(cmd.name) ? ['test'] : [];
    const text = '.' + cmd.name + (args.length ? ' test' : '');

    try {
      await Promise.race([
        cmd.execute(baseCtx(args, text)),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 25s')), 25000)),
      ]);
      record(cmd.name, true);
    } catch (e) {
      record(cmd.name, false, e.message.slice(0, 90));
    }
  }

  // NOTE: do NOT restore process.exit here. Commands like `.shutdown` arm a
  // `setTimeout(() => process.exit(1), 2000)`; restoring the real exit lets that
  // timer fire after the report and silently turns a green run into exit 1.
  // We keep the stub installed and exit deliberately at the very end instead.
  if (exitCalls.length) console.log(`\n  (process.exit called ${exitCalls.length}x by commands: ${exitCalls.join(',')} — stubbed)`);

  const failed = results.filter((r) => !r.ok);
  const ran = results.filter((r) => !r.name.includes('skipped')).length;
  console.log(`\n\x1b[1m${results.length - failed.length}/${results.length} ok\x1b[0m  (${ran} actually run, ${results.length - ran} skipped)`);
  if (failed.length) {
    console.log('\n\x1b[31mFailures:\x1b[0m');
    failed.forEach((f) => console.log(`  • ${f.name}: ${f.note}`));
    realExit(1);
    return;
  }
  realExit(0);
})();

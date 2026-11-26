const conv = require('../lib/engines/converter');
const sharp = require('sharp');
const { execFileSync } = require('child_process');
const bin = require('ffmpeg-static');
const fs = require('fs');
const stickerMeta = require('../lib/stickerMetadata');

let IMG, VID, AUD, STICKER;
let sent = [];
function ctx(command, args = [], extra = {}) {
  return {
    command, args, from: '120363conv@g.us', sender: '2348111000001@s.whatsapp.net',
    msg: { key:{}, message:{ extendedTextMessage:{ contextInfo:{ quotedMessage: extra.quoted || { imageMessage:{} } } } } },
    prefix: '.',
    sock: { sendMessage: async (j,c) => { sent.push(c); return {}; } },
    reply: async t => { sent.push({ text: String(t) }); return {}; },
    download: async () => (extra.download || IMG),
    ...extra,
  };
}
const last = () => sent[sent.length-1] || {};
const txt  = () => String(last().caption || last().text || '');
const isPng = b => b && b.slice(0,4).toString('hex') === '89504e47';
const isWebp = b => b && b.slice(8,12).toString('ascii') === 'WEBP';
const hasAnim = b => stickerMeta.isAnimatedWebp(b);
let pass=0, fail=[];
const ok=(n,c,d='')=>{ if(c){pass++;console.log('  ✓ '+n);} else {fail.push(n+' :: '+d);console.log('  ✗ '+n+'  '+d);} };

(async () => {
  // fixtures
  IMG = await sharp({create:{width:800,height:600,channels:3,background:'#4a90d9'}}).png().toBuffer();
  STICKER = await sharp({create:{width:512,height:512,channels:4,background:{r:255,g:80,b:20,alpha:1}}}).webp({quality:80}).toBuffer();
  execFileSync(bin, ['-y','-f','lavfi','-i','testsrc=duration=2:size=320x240:rate=10','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-c:a','aac','-shortest','-pix_fmt','yuv420p','/tmp/conv.mp4'], {stdio:'ignore'});
  execFileSync(bin, ['-y','-f','lavfi','-i','sine=frequency=440:duration=2','-b:a','96k','/tmp/conv.mp3'], {stdio:'ignore'});
  VID = fs.readFileSync('/tmp/conv.mp4');
  AUD = fs.readFileSync('/tmp/conv.mp3');
  console.log(`fixtures: img ${IMG.length}b, vid ${VID.length}b, aud ${AUD.length}b\n`);

  console.log('── image transforms ──');
  for (const [cmd, args] of [['resize',['400']],['resize',['400','300']],['crop',['400','300']],['rotate',['90']],
      ['blur',[]],['sharpen',[]],['grayscale',[]],['invert',[]],['sepia',[]],['enhance',[]],['hd',[]],
      ['upscale',[]],['remini',[]],['compress',[]],['toimage',[]],['exif',[]]]) {
    sent=[]; await conv.execute(ctx(cmd,args));
    const good = cmd === 'compress' ? Boolean(last().image) : isPng(last().image);
    ok(`.${cmd} ${args.join(' ')}`.trim(), good, txt().slice(0,60));
  }

  console.log('\n── stickers & cards ──');
  sent=[]; await conv.execute(ctx('stiker'));
  ok('.stiker sends a sticker', isWebp(last().sticker));
  sent=[]; await conv.execute(ctx('ttp',['hello','world']));
  ok('.ttp sends a sticker', isWebp(last().sticker));
  sent=[]; await conv.execute(ctx('attp',['zynex']));
  ok('.attp sends a sticker', isWebp(last().sticker));
  ok('.attp is a real animated WebP', hasAnim(last().sticker) && last().isAnimated === true);
  sent=[]; await conv.execute(ctx('qc',['Stay','hungry','|','Steve','Jobs']));
  ok('.qc sends a quote card', isPng(last().image), txt().slice(0,50));
  sent=[]; await conv.execute(ctx('qc',[],{quoted:{conversation:'Hello from a replied message'}}));
  ok('.qc can quote a replied message', isPng(last().image), txt().slice(0,50));
  sent=[]; await conv.execute(ctx('quotely',['Stay','hungry','|','Steve','Jobs']));
  ok('.quotely sends a WebP quote sticker', isWebp(last().sticker));
  sent=[]; await conv.execute(ctx('emoji2png',['😂']));
  ok('.emoji2png sends a sticker', isWebp(last().sticker));
  sent=[]; await conv.execute(ctx('emojimix',['😂','🔥']));
  ok('.emojimix sends a sticker', isWebp(last().sticker), txt().slice(0,60));

  console.log('\n── media ──');
  sent=[]; await conv.execute(ctx('toaudio',[],{download:async()=>VID, quoted:{videoMessage:{}}}));
  ok('.toaudio from video', last().audio && last().audio.length > 1000, txt().slice(0,50));
  sent=[]; await conv.execute(ctx('tovn',[],{download:async()=>AUD, quoted:{audioMessage:{}}}));
  ok('.tovn sends a voice note', last().audio && last().ptt === true);
  sent=[]; await conv.execute(ctx('tovideo',[],{download:async()=>AUD, quoted:{audioMessage:{}}}));
  ok('.tovideo builds an mp4', last().video && last().video.length > 1000, txt().slice(0,60));
  sent=[]; await conv.execute(ctx('togif',[],{download:async()=>VID, quoted:{videoMessage:{}}}));
  ok('.togif builds a gif', last().video && last().gifPlayback === true, txt().slice(0,60));

  console.log('\n── pdf ──');
  sent=[]; await conv.execute(ctx('txt2pdf',['hello','zynex']));
  ok('.txt2pdf sends a document', last().document && last().document.slice(0,4).toString()==='%PDF');
  sent=[]; await conv.execute(ctx('img2pdf'));
  ok('.img2pdf sends a document', last().document && last().document.slice(0,4).toString()==='%PDF');

  console.log('\n── watermark / sticker EXIF ──');
  sent=[]; await conv.execute(ctx('wm',['ZYNEX']));
  ok('.wm draws a visible watermark', isPng(last().image));
  sent=[]; await conv.execute(ctx('swm',['MyPack','|','Me'],{quoted:{stickerMessage:{}},download:async()=>STICKER}));
  const swmSticker = (sent.find(x => x.sticker) || {}).sticker;
  const swmMeta = await stickerMeta.readStickerMetadata(swmSticker);
  ok('.swm writes real pack/author EXIF', isWebp(swmSticker) && swmMeta && swmMeta['sticker-pack-name'] === 'MyPack' && swmMeta['sticker-pack-publisher'] === 'Me', JSON.stringify(swmMeta));
  sent=[]; await conv.execute(ctx('swm',['X'],{quoted:{imageMessage:{}}}));
  ok('.swm refuses non-sticker media', /Reply to a \*sticker\*/i.test(txt()), txt().slice(0,70));

  console.log('\n── honest refusals ──');
  for (const c of ['ocr','readtext','removebg','imgbb','catbox','telegraph','doc2pdf','pdf2img']) {
    sent=[]; await conv.execute(ctx(c,['x'],{quoted:c==='pdf2img'?{documentMessage:{}}:{}}));
    ok(`.${c} explains itself`, /isn't possible|needs/i.test(txt()), txt().slice(0,70));
  }

  console.log('\n── missing-input errors ──');
  sent=[]; await conv.execute(ctx('resize',['400'],{quoted:{}}));
  ok('.resize without image explains', /Reply to an \*image\*/i.test(txt()), txt().slice(0,60));
  sent=[]; await conv.execute(ctx('resize',[],{}));
  ok('.resize without size explains', /Use \*.resize/i.test(txt()) || /Reply to/i.test(txt()));
  // a video with no audio track must get a clear message, not a generic error
  execFileSync(bin, ['-y','-f','lavfi','-i','testsrc=duration=1:size=160x120:rate=10','-pix_fmt','yuv420p','/tmp/silent.mp4'], {stdio:'ignore'});
  sent=[]; await conv.execute(ctx('toaudio',[],{download:async()=>fs.readFileSync('/tmp/silent.mp4'), quoted:{videoMessage:{}}}));
  ok('.toaudio explains a silent video', /no audio track/.test(txt()), txt().slice(0,70));

  console.log(`\n${pass}/${pass+fail.length} passed`);
  if(fail.length){console.log('\nFAILS:');fail.forEach(f=>console.log('  •',f));process.exit(1);}
})();

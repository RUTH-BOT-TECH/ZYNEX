// 1000 WhatsApp bot command names, grouped by category.
// Usage: const { commands, flat } = require('./commands')

const raw = {
  general: `menu help start ping alive runtime uptime speed info about owner donate script repo support report feedback bug request suggest rules terms privacy status stats version changelog list allmenu botinfo creator contact link invite website channel community server dashboard profile me myinfo id jid number time date today tomorrow yesterday calendar clock timezone weather quote tip fact joke`,

  admin: `kick add promote demote ban unban mute unmute warn unwarn warnings resetwarn delwarn clearwarns tagall hidetag everyone admins listadmins members listmembers online offline inactive active kickall kickinactive setname setdesc setpp delpp setrules rules welcome goodbye setwelcome setgoodbye antilink antibadword antispam antiflood antibot antifake antidelete antiviewonce antitag antimention lock unlock open close announce restrict approve reject approveall rejectall pending joinrequests revoke resetlink grouplink getlink groupinfo ginfo setlang ephemeral disappearing`,

  owner: `broadcast bc bcgroup bcpm bcall join leave block unblock blocklist ban_user unban_user addprem delprem premlist addsudo delsudo sudolist setprefix noprefix multiprefix setbotname setbotpp setbio setstatus setmenu setowner restart shutdown reboot update upgrade eval exec shell logs clearlogs clearcache cleartmp backup restore getdb resetdb getsession delsession public self private shared autoread autotyping autorecord autoreact autostatus autoviewstatus autolikestatus alwaysonline presence mode maintenance debug`,

  downloader: `ytmp3 ytmp4 play song video yta ytv ytsearch yts youtube tiktok tt ttmp3 ttmp4 tiktoksearch instagram ig igdl igstory igreel igpost igtv facebook fb fbdl twitter tw twdl x pinterest pin pindl pinsearch spotify spdl spotifysearch soundcloud scdl mediafire mf mega gdrive drive github gitdl gitclone apk apkdl apksearch playstore modapk threads snapchat reddit likee capcut telegram tele sticker_dl dailymotion vimeo twitch bilibili terabox imgur`,

  converter: `sticker s stiker toimg toimage tovideo tomp4 tomp3 toaudio tovn toptt togif tourl upload uploader catbox telegraph imgbb removebg remini hd enhance upscale blur sharpen grayscale invert sepia flip mirror rotate resize crop compress emojimix emoji2png attp ttp qc quotely swm wm take steal packname exif pdf2img img2pdf txt2pdf doc2pdf html2img screenshot ss ssweb sstab ssphone sspc ocr readtext qr qrcode readqr barcode shorturl tinyurl bitly expand base64 debase64 binary debinary hex dehex`,

  audio: `bass blown deep earrape fast fat nightcore reverse robot slow smooth tupai chipmunk echo reverb vibrato tremolo flanger phaser distort lofi vaporwave 8d audio8d volume vol boost normalize trim cut merge mix extract mute_video speed_up slow_down pitch pitchup pitchdown autotune voicechange voicemale voicefemale voicechild voicedemon voicealien voicewhisper voiceradio voicetelephone`,

  ai: `ai chatgpt gpt gpt4 gpt5 openai gemini bard bing claude llama mistral deepseek grok copilot ask chat bot assistant imagine dalle midjourney stablediffusion flux txt2img img2img aiimage aiart anime2d animeai ghibli cartoonify pixar disney3d figurine caricature aiface faceswap deepfake aivoice tts tts_en tts_fr tts_es tts_ar tts_hi tts_sw tts_pt tts_ru tts_ja tts_zh stt transcribe whisper summarize summary paraphrase rewrite grammar proofread expand_text shorten simplify explain eli5 define translate tr detectlang code codegen debugcode explaincode refactor regex sql`,

  fun: `joke dadjoke darkjoke pun riddle truth dare truthordare wyr wouldyourather neverhaveiever roast compliment insult flirt pickup pickupline lovequote quote motivation inspire proverb fact funfact catfact dogfact numberfact trivia quiz meme memes randommeme cat dog fox bird panda koala duck shiba bunny capybara horse cow pig sheep goat advice insult_gen yomama 8ball magic8 fortune horoscope zodiac lucky luckynumber ship love lovemeter match compatible crush friendzone relationship rate beauty handsome cute pretty gay lesbian simp sus drunk stupid smart genius iq`,

  games: `tictactoe ttt delttt hangman guess guessnumber guesscolor guessflag guesscountry guessanime guesssong lyrics whoami who riddlegame math mathquiz mathgame typing typingtest typeracer scramble unscramble wordle wordchain anagram family100 tebakgambar tebakkata tebaklagu tebakbendera tebakkimia tebaktebakan siapakahaku asahotak susunkata caklontong rps rockpaperscissors dice roll flip coin coinflip slot spin wheel roulette blackjack bj poker uno chess checkers connect4 minesweeper snake tetris 2048 sudoku maze trivia_hard quizbattle duel fight battle pvp rpg adventure hunt explore dungeon quest mission`,

  economy: `balance bal wallet bank deposit dep withdraw wd transfer pay give send daily weekly monthly hourly claim bonus reward work job jobs fish fishing mine mining hunt hunting farm farming harvest plant crop chop wood cook craft forge smelt rob steal heist crime gamble bet shop buy sell store market inventory inv items use equip unequip upgrade repair trade auction leaderboard lb top richest rank level xp exp levelup rankcard card profilecard badge badges achievement achievements title titles pet pets adopt feed pethouse petwalk marry divorce partner proposal family`,

  search: `google gsearch bing yahoo duckduckgo ddg wiki wikipedia wikihow urban dictionary dict define meaning synonym antonym rhyme thesaurus news headlines bbc cnn sports football soccer score fixtures standings epl laliga ucl nba nfl cricket f1 tennis movie movies imdb tv series anime manga mal anilist animeinfo mangainfo character lyrics lyric song music album artist genre playlist book books isbn author recipe food drink cocktail nutrition calories crypto coin price stock forex currency convert exchange gold oil bitcoin ethereum`,

  tools: `calc calculator math solve equation algebra derivative integral matrix graph plot unit unitconvert length weight temperature speedconv area volume currency age agecalc bmi bmr tdee calorie percent percentage discount tip split loan mortgage interest compound tax vat salary timer stopwatch countdown alarm remind reminder remindme todo note notes addnote delnote listnote memo password passgen random randomnumber uuid hash md5 sha1 sha256 encrypt decrypt encode decode urlencode urldecode jsonformat jsonminify beautify minify lorem fancytext style font textstyle bold italic mono strike underline reversetext upside zalgo bubble wide vaporize vigenere vig caesar rot13 atbash affine morse demorse bacon debacon railfence bcrypt checkpass passgen2 hashpw cipher wasted jail triggered wanted rip trash affect rainbow distracted fuse colorfy hitler shit spank bed jokeoverhead bookmarks bookmark delbookmark savemsg savedmsgs delsaved remind remindme reminder reminders delreminder todo todos addtodo donetodo deltodo aqi airquality uv uvindex earthquake quakes pronounce`,

  network: `ip ipinfo iplookup whois dns nslookup dig ping_host traceroute portscan checkport headers httpstatus sslinfo cert domain domaincheck subdomain tld url urlinfo unshorten isup down speedtest fast latency proxy vpn useragent browser device os battery cpu ram memory disk storage network uptime_server sysinfo neofetch hostinfo geoip location country countryinfo flag capital currency_country language population timezone_country airport airline flight tracking trackpackage`,

  islamic: `quran surah ayah tafsir juz qari qurandl azan adhan prayertime salah salat qibla dua dhikr tasbih hadith bukhari muslim sunnah asmaulhusna names99 islamicquote islamicdate hijri ramadan iftar sehri suhoor eid zakat sadaqah hajj umrah mecca madinah masjid mosque imam khutbah seerah prophet sahaba nasheed islamicjoke`,

  bible: `bible verse votd versedaily psalm proverbs gospel john genesis exodus matthew mark luke romans corinthians galatians ephesians philippians hebrews revelation prayer devotion sermon hymn gospelmusic christianquote church`,

  image: `wallpaper wp background bg randomimg randomphoto unsplash pexels pixabay gimage image img photo pic picture avatar pfp profilepic dp getpp getdp ppcouple couplepp ppgroup anime waifu neko husbando kawaii loli maid megumin shinobu hug kiss pat slap cuddle cry smile wave wink blush bite lick poke bonk yeet highfive handhold nom dance happy kill laugh bully smug cringe glomp`,

  textmaker: `logo logomaker neon neonlight glitch glitchtext 3dtext blackpink pornhub grafitti graffiti cloud fire flame ice snow gold goldtext silver metal chrome rainbow shadow light galaxy space matrix hacker thunder thunderlogo sand sandwriting pubg freefire ml mobilelegends cod fortnite apex valorant minecraft roblox naruto onepiece dragonball marvel avengers batman superman joker tiktoklogo youtubelogo igLogo fblogo twitterlogo discordlogo gaming esports team squad clan banner thumbnail poster flyer card cert certificate id_card idcard namecard bizcard`,

  stalk: `igstalk ttstalk twstalk ghstalk gitstalk ytstalk fbstalk tgstalk npmstalk ffstalk mlstalk pubgstalk codmstalk genshinstalk robloxstalk steamstalk spotifystalk soundcloudstalk pinstalk redditstalk telestalk wastalk waprofile checkwa wanumber waexists numinfo phoneinfo carrier countrycode`,

  group_fun: `poll vote endpoll results truth_group dare_group spin_bottle kisschat hugall couple pair matchmaker topmembers topchat topcommands activity chatstats groupstats msgcount mostactive leastactive afk back brb sleep wake goodnight goodmorning birthday setbirthday birthdays bday anniversary event events addevent delevent schedule rsvp meet meeting standup`,

  media: `play2 playlist queue skip pause resume stop loop shuffle nowplaying np lyrics2 karaoke podcast radio stations tv_live iptv stream movie_dl series_dl subtitle subs trailer cast actors director rating review watchlist favorites fav addfav delfav ringtone ringtones sfx sound sounds soundboard meme_audio jingle vn_effects voicenote vnreply viewonce readviewonce vv vv2 rvo save savestatus status_dl getstatus`,

  utility: `delete del d clear clearchat archive unarchive pin_chat unpin_chat star unstar starred forward fwd quoted reply react unreact edit editmsg copy paste cut tag tagme tagadmin tagbot mention link2 vcard contactcard sendcontact sendloc location_send shareloc map nearby places find findme lost found report_user spam_report block_report support_ticket ticket tickets faq faqs howto guide tutorial docs doc api apikey token webhook lang language setlanguage settings config preferences theme darkmode lightmode notify notifications unsubscribe subscribe optin optout`,

  nsfwsafe: `anime_sfw wholesome cute_animals aww satisfying oddlysatisfying earthporn spaceporn foodporn roomporn cityporn carporn historyporn wallpapers amoled minimal aesthetic vaporwave_img cyberpunk fantasyart sciart landscape portrait macro street architecture`,

  education: `study quizme flashcard flashcards cards learn lesson lessons course courses tutorial_dev codingtip programming js javascript python java cpp csharp php ruby go rust swift kotlin dart html css react node express django flask laravel sqlmodel git github docker linux bash cmd regexhelp cheatsheet cheat periodic element elements chem chemistry physics biology math_fact geometry trigonometry statistics probability history geography science astronomy planet planets space nasa apod iss satellite rocket eclipse moon sun stars constellation`,

  business: `invoice receipt quote_biz order orders neworder cancelorder track status_order catalog products product addproduct delproduct editproduct price prices pricelist stock_check restock customers customer addcustomer delcustomer crm lead leads followup campaign promo promotions coupon coupons voucher redeem referral refer affiliate commission payout withdrawal deposit_pay paypal stripe paystack flutterwave momo mpesa airtel mtn cashapp venmo bank_details account accounts subscription plan plans premium pro vip upgrade_plan renew expire trial`,

  security: `scan virus malware phishing checklink safelink urlscan filescan hashcheck breach pwned leakcheck passcheck strongpass twofa otp totp captcha verify verification verifyme unverify kycstatus fraud scamcheck spamcheck blocklist_check ipban reputation honeypot logs_view audit audit_log activity_log`,

  misc: `ping2 test test2 echo repeat say mimic copycat parrot spell count wordcount charcount lines reverse_words sort uniq shuffle_text random_pick choose pick decide coinpick dicepick teams team_split randomteam draw lottery raffle giveaway gstart gend greroll gwinner giveaways bingo tombola secretsanta wishlist gift gifts idea ideas name names babyname username nickname nick bio_gen caption captions hashtag hashtags emoji emojis emojiinfo symbol symbols ascii asciiart figlet banner_text bigtext smalltext tinytext cursive gothic oldenglish`,
};

const commands = {};
const seen = new Set();
for (const [cat, str] of Object.entries(raw)) {
  commands[cat] = [];
  for (const c of str.trim().split(/\s+/)) {
    const name = c.toLowerCase();
    if (!seen.has(name)) { seen.add(name); commands[cat].push(name); }
  }
}
const flat = [...seen];

module.exports = { commands, flat };

if (require.main === module) {
  for (const [cat, list] of Object.entries(commands)) console.log(`${cat}: ${list.length}`);
  console.log('TOTAL', flat.length);
}

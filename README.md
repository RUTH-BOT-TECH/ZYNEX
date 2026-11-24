<div align="center">
<img src="public/assets/readme/zynex-glow.svg" width="100%" alt="">
<img src="public/assets/readme/zynex-banner.png" width="88%" alt="ZYNEX-MD">

**A WhatsApp bot that tells the truth.**

[![Node 20+](public/assets/readme/meta-node.svg)](https://nodejs.org)
[![Baileys rc14](public/assets/readme/meta-baileys.svg)](https://github.com/WhiskeySockets/Baileys)
[![MIT](public/assets/readme/meta-license.svg)](LICENSE)
[![52 tests](public/assets/readme/meta-tests.svg)](#-by-the-numbers)

<img src="public/assets/readme/zynex-glow.svg" width="100%" alt="">
</div>

## ⚡ **Quick start**

```bash
git clone https://github.com/RUTH-BOT-TECH/ZYNEX.git && cd ZYNEX
npm install && npm start
```

Open `http://localhost:3001`, pair your number, send `.menu`. Zero config needed.
Rebrand with `BOT_NAME`, `OWNER_NUMBER`, `SITE_URL` → [.env.example](.env.example).

## 🚀 **Deploy**

<p align="center">
  <a href="https://zynex-md-production.up.railway.app"><img src="public/assets/readme/btn-pair.svg" width="245" alt="Get session ID"></a>
  <a href="DEPLOY.md"><img src="public/assets/readme/btn-docs.svg" width="245" alt="Deploy guide"></a>
  <a href="https://railway.app"><img src="public/assets/readme/btn-railway.svg" width="245" alt="Railway"></a>
  <a href="https://render.com"><img src="public/assets/readme/btn-render.svg" width="245" alt="Render"></a>
</p>

Always-on process + a volume at `/data` with `AUTH_DIR_ROOT=/data`. Railway, Render
(paid), VPS, Fly. **Not serverless** — a WhatsApp socket needs a live process.
`railway.toml` / `render.yaml` are pre-wired → [DEPLOY.md](DEPLOY.md).

## 📊 **By the numbers**

<div align="center">
<img src="public/assets/readme/stat-names.svg" width="180" alt="2,202 names">
<img src="public/assets/readme/stat-implemented.svg" width="180" alt="1,364 implemented">
<img src="public/assets/readme/stat-tests.svg" width="180" alt="52 test suites">
<img src="public/assets/readme/stat-files.svg" width="180" alt="204 command files">
</div>

**2,202 names · 1,364 implemented (61.9%) · 838 honest refusals.** `.vv` opens
view-once media (yours or anyone's), `.play` returns full tracks, and a command
that can't run says why and names one that works.

## 🖼️ **In chat**

<div align="center"><table><tr>
<td align="center"><img src="samples/c-sticker-preview.png" width="205" alt="Sticker"><br><sub><i>Sticker</i></sub></td>
<td align="center"><img src="samples/r-2048.png" width="205" alt="2048"><br><sub><i>2048</i></sub></td>
<td align="center"><img src="samples/r-ttt.png" width="205" alt="Tic-tac-toe"><br><sub><i>Tic-tac-toe</i></sub></td>
</tr></table></div>

## 📚 **Docs & verify**

[DEPLOY.md](DEPLOY.md) · [RAILWAY-NOTES.md](RAILWAY-NOTES.md) · [HEALTH.md](HEALTH.md) ·
[VV.md](VV.md) · [PLAY.md](PLAY.md) · [ENGINES.md](ENGINES.md) ·
[STRUCTURE.md](STRUCTURE.md) · [APIS.md](APIS.md) · [SECURITY.md](SECURITY.md) ·
[REPAIR.md](REPAIR.md)

`npm run test:all` → 52 suites, exit 0 · `npm run coverage` → the numbers above.

<div align="center">
<img src="public/assets/readme/zynex-status.svg" width="580" alt="Pairing site live">
<a href="https://github.com/RUTH-BOT-TECH/ZYNEX/issues"><img src="public/assets/readme/btn-issues.svg" width="235" alt="Issues"></a>
<a href="https://github.com/RUTH-BOT-TECH/ZYNEX"><img src="public/assets/readme/btn-star.svg" width="235" alt="Star"></a>
<br><sub>ZYNEX-MD © 2026 · MIT · Baileys · sharp · ffmpeg-static</sub>
<img src="public/assets/readme/zynex-glow.svg" width="100%" alt="">
</div>

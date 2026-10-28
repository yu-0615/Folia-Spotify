<p align="center">
  <img src="https://github.com/user-attachments/assets/b5d0e863-48be-497b-b0e9-4bd8d8ce9bf0" alt="Folia" width="100%" />
</p>

> [!NOTE]
> **Folia-Spotify** 是 [Folia](https://github.com/chthollyphile/folia-major)（作者 [chthollyphile](https://github.com/chthollyphile)）的 fork，按原專案的 [AGPL-3.0](LICENSE) 授權條款釋出。Folia 的設計與絕大部分程式碼都出自原作者和[貢獻者們](CONTRIBUTORS.md)，請到原專案回報原有功能的問題、幫原專案按星星。
>
> 本 fork 自 2026-10 起所做的修改：網頁版接入 Spotify（官方 Web API + PKCE 登入 + Web Playback SDK 播放，見 `src/services/onlineMusic/spotify/web/`），也能在播放頁控制面板選帳號裡的其他 Spotify 裝置（手機、電腦、音箱）來放；Spotify 網頁版的歌詞改從其他來源匹配；網易雲、QQ 音樂、酷狗、波點、汽水音樂預設只作為歌詞來源（設定「連線與整合」裡可以開啟）；沒選過平臺時從 Spotify 開始；新增 `npm run dev:web` 一次啟動網頁版和本地的網易雲、QQ、酷狗 API。逐項修改見本儲存庫的提交紀錄。

<div align="center">
<a href="https://trendshift.io/repositories/71740?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-71740" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/71740" alt="chthollyphile%2Ffolia-major | Trendshift" width="250" height="55"/></a>

# Folia

Lyrics Reimagined // 辭曲新境

繁體中文 | [English](README.en.md)

[![GitHub release](https://img.shields.io/github/v/release/yu-0615/Folia-Spotify?label=release)](https://github.com/yu-0615/Folia-Spotify/releases)
[![License](https://img.shields.io/github/license/chthollyphile/folia-major)](https://github.com/chthollyphile/folia-major/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/chthollyphile/folia-major?style=social)](https://github.com/chthollyphile/folia-major/stargazers)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/chthollyphile/folia-major)
[![Discord](https://img.shields.io/discord/1541051241822687232?logo=discord&logoColor=white&label=Join%20our%20Discord)](https://discord.gg/dMDBTHxeKd)
<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-35-orange.svg?style=flat-square)](CONTRIBUTORS.md)
<!-- ALL-CONTRIBUTORS-BADGE:END -->

[取得方式](#取得方式)
·
[Vercel 部署](https://vercel.com/new/clone?repository-url=https://github.com/yu-0615/Folia-Spotify)
·
[Spotify 說明](#spotify)
·
[使用指南](https://folia-site.cielaniska.top/guide/)
·
[技術說明](docs/technical.md)

</div>

## 專案簡介

Folia是一個以全螢幕沉浸式歌詞播放為核心的線上音樂播放器，支援網易雲、酷狗、QQ 音樂、Navidrome 和本地音樂庫，桌面端還支援波點音樂、YouTube Music、Spotify 和汽水音樂，通過智慧歌詞匹配，AI生成配色主題，以及多種全螢幕歌詞動畫為使用者提供獨特的聽歌體驗。

提供基於Electron的 windows/ macOS/ Linux 桌面端版本與基於 Node.js 的 Web 版本，支援多平臺部署。

如果希望能夠在行動裝置上使用，或在瀏覽器上體驗，可以選擇[一鍵部署到 Vercel](https://folia-site.cielaniska.top/guide/deploy-vercel) 的 Web 版本，或自行部署到其他支援 Node.js 的平臺。

## 快速下載

> [!TIP]
> - **GitHub**：[Latest Release](https://github.com/yu-0615/Folia-Spotify/releases/latest)，提供 Windows / macOS / Linux 全平臺安裝包（`Folia-Spotify`，可與原版 Folia 同時安裝）。
> - 原版 Folia 的安裝包（含網盤下載）請到[原專案的 Releases](https://github.com/chthollyphile/folia-major/releases/latest)。
>
> 更多取得方式（Web 部署、Docker、AUR、Flatpak、行動裝置）見下方 [取得方式](#取得方式)。

## Spotify

Folia-Spotify 的桌面版和網頁版都能用 Spotify，但兩邊接法不同。

### 桌面版

在「連線線上平臺」選 Spotify，瀏覽器會打開 Spotify 的授權頁，按「同意」就登入了，不用自己設定任何東西。桌面版沿用原作者的實作，走 Spotify 自家用戶端的服務：可以搜尋、播放、讀取你的歌單和收藏，有 Spotify 自己的逐行歌詞，也有電台頁和探索頁。播放需要 Spotify Premium。

播放時如果出現「此 Spotify 帳號無法播放」：這是 Spotify 不發解密金鑰給這個帳號（2024 年底後註冊的大多如此，較早的帳號也可能遇到），桌面版內建的播放器因此放不了。改成**由 Folia 控制、Spotify App 發聲**：

1. 照下面網頁版的第 1、2、4 步建立你自己的 Spotify 應用，Redirect URI 加上 `http://127.0.0.1:5590/spotify-callback.html`。
2. 打開 Spotify App（或手機、音箱上的 Spotify）。
3. 在 Folia 播放頁的控制面板點「播放裝置」，填入你的 Client ID，按「登入以選擇其他裝置」，在瀏覽器按「同意」。
4. 選 Spotify App 或其他裝置。之後 Folia 照樣選歌、控制播放、顯示同步歌詞，聲音從那台裝置發出。要改回內建播放，選「Folia 內建播放」。

### 網頁版

網頁版用的是 Spotify 官方的 Web API 和 Web Playback SDK，要用你自己註冊的 Spotify 應用登入：

1. 到 [Spotify for Developers](https://developer.spotify.com/dashboard) 建立應用，API 勾選 **Web API** 和 **Web Playback SDK**。
2. 在 **Redirect URIs** 加上 `https://<你的網域>/spotify-callback.html`。本機開發用 `http://127.0.0.1:3000/spotify-callback.html`（Spotify 不接受 `localhost`，正式網站必須是 https）。
3. 登入時，登入視窗會要你填 Client ID（只存在這台裝置上）。部署的人也可以在建置時設 `VITE_SPOTIFY_CLIENT_ID` 當預設值；回呼網址不是上面的預設值時，再設 `VITE_SPOTIFY_REDIRECT_URI`。Client ID 不是機密；**Client Secret 用不到，也不要放進來**。
4. 在應用的 **User Management** 加入要登入的帳號。開發模式的應用最多 5 個帳號，應用擁有者和使用者都需要 Premium。

本機開發時，這個指令會一次啟動網頁版，以及歌詞匹配要用的網易雲、QQ 音樂、酷狗 API（用 `node_modules` 裡的套件，不需要 Docker）：

```bash
npm run dev:web
```

然後用 `http://127.0.0.1:3000` 開啟（不要用 `localhost`，否則 Spotify 登入的回呼會對不上）。

網頁版能做的事：

- 搜尋、播放、讀取你的歌單和收藏、按讚、把歌加入或移出你的歌單、建立歌單。
- **播放裝置**：播放頁控制面板的「播放裝置」可以改在帳號裡其他 Spotify 裝置播放（手機、電腦上的 Spotify App、音箱），Folia 照樣控制播放並顯示同步歌詞。其他裝置要先打開 Spotify 才會出現在清單上。
- 歌詞自動從網易雲、QQ 音樂、酷狗、AMLL 匹配。

Spotify 對第三方應用的限制（不是 Folia 能改的）：

- 只讀得到你自己建立或參與協作的歌單裡的歌。別人的歌單，以及 Daily Mix、Discover Weekly、Release Radar 這類 Spotify 自己做的歌單都讀不到。桌面版走的是另一套服務，沒有這兩條限制。
- 沒有 Spotify 自己的歌詞，也沒有電台頁和探索頁。
- 聲音由 Spotify 自己的播放器（加密音訊）或你選的裝置發出，所以等化器、音效、視覺化和自動混音都碰不到 Spotify 的歌。
- 在這個瀏覽器裡播放需要 Widevine（Chrome、Edge、Firefox 都有）；只拿來遙控其他裝置的話不需要。

### 中國大陸的音樂平臺

網易雲、QQ 音樂、酷狗、波點、汽水音樂預設只當歌詞來源，不會出現在平臺清單裡。要像原版一樣切換、登入這些平臺，到「設定 → 連線與整合」打開「在平臺清單中顯示所有平臺」。

## 展示

![visualizer](./img/visualizer.png)

### 示範影片

https://github.com/user-attachments/assets/af806cf1-f67f-4b88-b2e7-57db507e9e81

https://github.com/user-attachments/assets/fd27f4f0-64b9-4c57-8c3b-10df767f934b

https://github.com/user-attachments/assets/704f195a-2194-434b-86e8-8f36290e5cc4

### 部分主題預覽

<table>
  <tr>
    <td width="50%">
      <img src="./img/preview-fume.png" alt="Fume 主題預覽" />
    </td>
    <td width="50%">
      <img src="./img/preview-lumi.png" alt="Lumi 主題預覽" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>浮名</strong></td>
    <td align="center"><strong>流光</strong></td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./img/preview-cad.png" alt="Cad 主題預覽" />
    </td>
    <td width="50%">
      <img src="./img/preview-pat.png" alt="Pat 主題預覽" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>心象</strong></td>
    <td align="center"><strong>雲階</strong></td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./img/preview-cappella.jpg" alt="群唱 主題預覽" />
    </td>
    <td width="50%">
      <img src="./img/preview-tilt.png" alt="Tilt 主題預覽" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>群唱</strong></td>
    <td align="center"><strong>傾訴</strong></td>
  </tr>
    <tr>
    <td width="50%">
      <img src="./img/preview-diorama.png" alt="鏡臺 主題預覽" />
    </td>
    <td width="50%">
      <img src="./img/preview-pendolo.png" alt="時計 主題預覽" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>鏡臺</strong></td>
    <td align="center"><strong>時計</strong></td>
  </tr>
</table>

不同的歌詞動畫具有不同的排版氛圍和可調引數，讓全螢幕歌詞擁有如同文字PV般的豐富視覺效果，同時又能兼顧響應式佈局，自動適配不同視窗尺寸。

## 核心能力

| 模組 | 說明 |
| --- | --- |
| 線上搜尋與播放 | 搜尋歌曲、歌手或專輯後即可播放，並自動載入相關封面與歌詞。 |
| 本地音樂支援 | 可匯入本地音訊檔案，在本地安全儲存索引資訊，不上傳檔案內容。詳細用法見 [本地音樂庫管理](docs/local-library-management.md)。 |
| 智慧歌詞匹配 | 本地歌曲可自動匹配線上歌詞與封面，也支援手動修正匹配結果。 |
| 本地歌詞檔案識別 | 自動載入同目錄同名 `.lrc`、`.vtt`、`.ttml`、`.qrc`、`.yrc`、`.krc` 歌詞檔案，或歌詞檔案內嵌 LRC 歌詞。適配 LDDC 生成的增強型逐字歌詞格式。 |
| Now Playing 接入 | 支援通過本機 [Now Playing](https://github.com/Widdit/now-playing-service/) 服務接入外部播放器的歌曲、時間軸與歌詞資訊，並驅動 Folia 的舞臺檢視與全螢幕歌詞渲染。 |
| AI 主題生成 | 基於歌曲情緒與歌詞內容生成沉浸式背景與視覺引數。 |
| 多端體驗 | 提供 Web 部署方式，同時支援桌面端打包分發。 |
| 模組系統（實驗性） | 桌面版可通過 Folium 模組新增歌詞動畫、背景、播放頁圖層、命令等，並從 [模組市場](https://folium-compound.cielaniska.top) 安裝官方認證的模組。詳見 [模組系統](#模組系統folium-v1x)。 |

## 取得方式

桌面版內建前後端執行環境，適合希望即裝即用的使用者。

### 一鍵部署

如果你希望快速上線 Web 版本，請閱讀 [Vercel 一鍵部署指南](https://folia-site.cielaniska.top/guide/deploy-vercel) 來建立專案

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yu-0615/Folia-Spotify) 

專案也支援一鍵部署到 Cloudflare，請參考 Vercel 的部署教程進行相應調整。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yu-0615/Folia-Spotify)

Vercel 與 Cloudflare 上的 QQ 音樂不再需要額外部署一個常駐 API 例項：把 `VITE_QQ_API_BASE` 填成 `/api/qq`，再配一個 `QQ_SESSION_SECRET`（服務端金鑰，**不加 `VITE_` 字首**）即可。這種形態支援微信掃碼和手機 QQ 掃碼登入（手機 QQ 掃碼要 qq-music-api 3.3.3 或更高版本），且播放前必須先登入；Cloudflare 上可以再繫結一個 Durable Object，讓 QQ 掃碼改走長連線，並多一個 QQ 音樂 App 掃碼。完整步驟、平臺差異和排錯方法見 [QQ 音樂部署指南](docs/qq-music-deployment.md)。

自託管使用者可以使用 [Docker Compose 全棧部署](deploy/docker/README.md)。本地音樂目錄存取依賴可信 HTTPS 安全上下文，部署文件包含 NAS 反向代理和證書要求。

### 直接下載

- **Windows / macOS / Linux**: Folia-Spotify 的安裝包請前往 [Releases 頁面](https://github.com/yu-0615/Folia-Spotify/releases/latest) 下載。macOS 版沒有簽名，第一次開啟若提示「已損壞」，見[這份說明](docs/desktop/macos-app-damaged.md)。
- **原版 Folia**：AUR 的 [folia-major-bin](https://aur.archlinux.org/packages/folia-major-bin)、社群的 [Flatpak](https://flatpark.org/apps/top.izuna.foliamajor/) 都是原版，不含本 fork 的修改。
- **Android**: 社群第三方移植版見下方 [行動裝置](#行動裝置)。

Linux 包、Wayland / Hyprland 遙控窗和桌面端細節見 [技術與開發說明](docs/technical.md)。

### 行動裝置

| 方式 | 說明 |
| --- | --- |
| **PWA（推薦）** | 部署 Web 版本或自託管版本後，在 Chrome for Android / iOS Safari 中將網頁新增到主螢幕，即可作為 PWA 應用使用。 |
| **社群移植版（Android）** | [maimai993/folia-sonnet](https://github.com/maimai993/folia-sonnet) · [whycfawa/folia-android](https://github.com/whycfawa/folia-android) |
| **自行打包（Android）** | 有一定技術基礎的使用者可以用 Capacitor 將 Web 版本打包為可安裝的 APK，參考示範儲存庫 [chthollyphile/folia-sonnet](https://github.com/chthollyphile/folia-sonnet)。 |

> [!NOTE]
> 社群移植版均為第三方專案，由社群自發維護，功能會與官方 PC 版存在差異。使用中遇到問題請回報到對應的社群儲存庫。

## 文件與開發

更完整的使用說明請存取 [Folia Guide](https://folia-site.cielaniska.top/guide/)。

部署、環境變數、本地開發、Stage API、常用指令碼和技術棧見 [技術與開發說明](docs/technical.md)。

## 模組系統（Folium v1.x）

> [!NOTE]
> 模組系統是實驗性功能，僅桌面版可用，預設關閉，需要在「設定 → 模組 → 模組系統」中開啟。

Folium 是 Folia 的模組平臺。模組可以新增新的歌詞動畫模式和背景型別、在播放頁上疊加內容、給進度條加按鈕和標記、註冊命令與設定分割槽、在歌詞顯示前改寫歌詞，也可以通過 Node 入口呼叫 ffmpeg 等本地能力。模組以可信程式碼執行，每個模組在啟用前都要在原生視窗中確認，檔案變化後需要重新確認。

- **模組市場**：[folium-compound.cielaniska.top](https://folium-compound.cielaniska.top) 提供官方模組和經過審查的社群模組，下載 zip 後拖進模組面板即可安裝。
- **官方認證**：市場裡的模組都帶有 Folium 簽名，安裝後顯示「官方認證」；只通過安全審查的先行測試模組顯示「先行測試」；沒有簽名的第三方模組顯示「未驗證」，同樣可以使用。
- **開發與貢獻**：[模組開發與貢獻指南](docs/folium/contributing.md)，從寫第一個模組、本地除錯，到提交到模組市場、審查與簽名、釋出更新。
- **API 參考**：[Folium API 參考](docs/folium/api.md)，由契約檔案生成的完整介面文件，按登錄檔、上下文、事件、服務等分類查詢。
- **平臺規範**：[Folium 規範](mods/README.md)，包括清單欄位、權限、登錄檔語義、事件、安全模型與版本策略。
- **示範模組**：儲存庫的 [`mods/`](mods/) 目錄，覆蓋歌詞動畫、調參、進度條、播放頁圖層與透明影片匯出。

## Sync Server

Folia 提供了可選的官方同步服務端 `sync-server`，用於在多個裝置之間同步外觀設定與 AI 主題庫。服務端由使用者自行託管，適合希望跨裝置同步配色主題的使用者。

支援以下部署方式：

- **Cloudflare Workers / D1**：免伺服器運維的 Serverless 部署，推薦使用。
  [![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chthollyphile/folia-major/tree/main/sync-server)
- **Docker**：映象與 Compose 入口見 [Docker 部署目錄](deploy/docker/README.md)。
- **Node.js 自託管**：使用 SQLite，適合本地或不方便使用 Docker 的環境。

詳細的環境變數、Token 設定與部署步驟請參閱 [Sync-Server 部署指南](https://folia-site.cielaniska.top/guide/deploy-sync)。部署完成後，在 Folia 的「設定 → 連線與整合」中填寫服務端位址和 `SYNC_TOKEN` 即可啟用同步。

## 本地音樂與匹配說明

Folia 會讀取音訊檔案後設資料、同目錄歌詞和封面，並可通過網易雲、QQ 音樂或酷狗音樂補全歌曲資訊。自動匹配按網易雲、QQ、酷狗依次回退；匹配不準確時，可以手動選擇候選、恢復首次匯入的本地資訊，或進一步合併、拆分藝術家與專輯實體。

完整的匯入、重掃、匹配、實體編輯、歌單、快取和故障排查說明見 [本地音樂庫管理](docs/local-library-management.md)。

## Community

加入discord社群，共同交流，獲得幫助

[![Discord](https://img.shields.io/discord/1541051241822687232?logo=discord&logoColor=white&label=Join%20our%20Discord)](https://discord.gg/dMDBTHxeKd)

## 貢獻者

感謝所有為本專案進行 Issue 提交、Bug 報告、想法建議、測試與程式碼編寫的貢獻者，均依據 all-contributors 規範進行統計

由於清單過長，貢獻紀錄請見 [貢獻者名單](CONTRIBUTORS.md)。

## 法律與免責宣告

本專案在 AI 的廣泛協助下開發，因此仍可能存在細微或不易察覺的問題。若給你帶來不便，敬請理解。

本專案主要用於展示播放動效、介面設計與相關工程實現。應用中涉及的線上音樂流媒體、歌詞、專輯封面及其他內容，其版權均歸對應權利人所有。

本儲存庫及其原始碼僅供個人學習、技術交流與非營利測試使用。請勿將其用於商業盈利用途。若因對線上資源的傳播、加工或再分發而引發版權糾紛或其他責任，均由使用者自行承擔，專案開發者不承擔相關責任。

請始終尊重數字版權，並在條件允許時通過官方平臺支援正版音樂。

## 致謝

特別感謝以下專案和資源：

- [chenmozhijin/LDDC](https://github.com/chenmozhijin/LDDC)
- [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)
- [chenglou/pretext](https://github.com/chenglou/pretext)
- [MakcRe/KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)
- [paper-design/shaders](https://github.com/paper-design/shaders)
- [yakult-green-tea/qq-music-api](https://github.com/yakult-green-tea/qq-music-api)

本專案接入了 [Apple Music-like Lyrics TTML 逐詞歌詞庫](https://github.com/amll-dev/amll-ttml-db) 以提供高品質的歌詞檔案，感謝此歌詞庫的作者和貢獻者們。

## 授權條款

本專案基於 `AGPL-3.0` 授權條款開源。

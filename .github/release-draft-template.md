> [!NOTE]
> Folia-Spotify 是 [Folia](https://github.com/chthollyphile/folia-major)（作者 [chthollyphile](https://github.com/chthollyphile)）的 fork，沿用 AGPL-3.0。原有功能的問題請到原專案回報。
> 這一版以原版 v0.7.23 為基礎。

## 這一版的內容

<!-- 發佈前在這裡填這一版的修改 -->

## 重點

- **接入 Spotify**：用官方 Web API + PKCE 登入，Client ID 在登入時填寫。歌曲在你自己的 Spotify App 裡播放（iPhone、Mac……），Folia 負責顯示歌詞、控制播放，並同步 Spotify 的播放佇列。
- **YouTube Music 改進**：繁中介面、探索頁的「心情與曲風」、登入可以「重新開啟瀏覽器」。
- **繁中優先**：介面、README、發佈說明都改為繁體中文，另外新增「簡轉繁」歌詞模組。

## 下載說明

- Windows：下載 `Folia-Spotify-Setup-{{VERSION}}.exe`
- macOS：
  - Apple Silicon：下載 `Folia-Spotify-{{VERSION}}-arm64.dmg`
  - Intel Mac：下載 `Folia-Spotify-{{VERSION}}-x64.dmg`
  - 如果開啟時提示「應用已損壞」，這通常是目前的 macOS 安裝檔未簽名 / 未 notarize 導致的 Gatekeeper 攔截，不是安裝檔本身損壞。解決方法見[這份說明]({{MACOS_UNSIGNED_HELP_URL}})
- Linux：
  - Debian / Ubuntu：下載 `folia-major-{{VERSION}}-linux-amd64.deb`
  - Fedora / openSUSE：下載 `folia-major-{{VERSION}}-linux-x86_64.rpm`
  - 其他發行版：下載 `folia-major-{{VERSION}}-linux-x64.tar.gz`
  - ARM64（樹莓派等 aarch64 裝置）：依發行版下載 `folia-major-{{VERSION}}-linux-arm64.deb` / `folia-major-{{VERSION}}-linux-aarch64.rpm` / `folia-major-{{VERSION}}-linux-arm64.tar.gz`
- iPhone：部署方式見 [Folia-Spotify-on-iPhone](https://github.com/yu-0615/Folia-Spotify-on-iPhone)

Folia-Spotify 與原版 Folia 是兩個獨立的 App（`Folia-Spotify.app`，設定分開儲存），可以同時安裝；自動更新只從本儲存庫的 GitHub Releases 取得。

## 版本號

Folia-Spotify 的版本號是「原版版本 + 兩位序號」：例如 `0.7.2301` 代表以原版 v0.7.23 為基礎的第 1 版，之後依序是 0.7.2302、0.7.2303…。

## 與原版 Folia 的不同

### Spotify
- 接入 Spotify（官方 Web API + PKCE 登入），Client ID 在登入時填寫。
- Spotify 的歌一律在你自己的 Spotify App 裡播放（iPhone、Mac……），Folia 跟著顯示歌詞、控制播放，播放頁控制面板顯示正在播放的裝置。
- 在 Spotify App 裡放的歌，Folia 也會跟著放，並帶上 Spotify 那邊的播放佇列（最多 50 首，接近尾端時自動補下一批）；從這份佇列裡點歌，會在那份歌單裡開始播放。
- 歌單頁放上 Spotify 的 Daily Mix 1–6。
- 桌面版探索頁先顯示「為你推薦」的清單與單曲。
- Spotify 網頁版的歌詞從其他來源自動匹配。
- 使用 Spotify 播放的歌曲無法使用等化器（聲音由 Spotify App 發出），如需調整請在 Spotify App 內變更。

### 書庫與介面
- 書庫新增「單曲」頁籤（排在最前），Spotify 的單曲從探索頁搬到這裡。
- 網易雲、QQ 音樂、酷狗、波點、汽水音樂預設只作為歌詞來源（設定「連線與整合」裡可以開啟），沒選過平臺時從 Spotify 開始。
- 介面與 README 改為繁體中文為主；補上越南語的 Spotify 相關文案。

### YouTube Music
- 登入可以「重新開啟瀏覽器」；繁中介面下頁面以繁中讀取；探索頁新增「心情與曲風」。

### 模組
- 新增「簡轉繁」模組，把簡體歌詞與翻譯轉成繁體。
- 每個模組可以設定「檔案改了也不用重新確認」。

### 開發
- 新增 `npm run dev:web`，一次啟動網頁版和本機的網易雲、QQ、酷狗 API。
- 新增 `npm run build:mac`，在本機 Mac 打包出該架構的 `.app`。

逐項修改見本儲存庫的[提交紀錄](https://github.com/yu-0615/Folia-Spotify/commits/main)。

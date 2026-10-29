> [!NOTE]
> Folia-Spotify 是 [Folia](https://github.com/chthollyphile/folia-major)（作者 [chthollyphile](https://github.com/chthollyphile)）的 fork，沿用 AGPL-3.0。原有功能的問題請到原專案回報。
> 這一版以原版 v{{UPSTREAM_VERSION}} 為基礎。

## 這一版的內容

<!-- 這一版的修改 -->

**同步原版**
<!-- 沒有就刪掉這段 -->

## 重點

- **接入 Spotify**：歌在你自己的 Spotify App 裡播放（iPhone、Mac……），Folia 顯示歌詞、控制播放，並同步 Spotify 的播放佇列。
- **YouTube Music 改進**：繁中介面、探索頁的「心情與曲風」、登入可以「重新開啟瀏覽器」。
- **繁中優先**：介面改為繁體中文為主，另外新增「簡轉繁」歌詞模組。

## 下載

- Windows：`Folia-Spotify-Setup-{{VERSION}}.exe`
- macOS：Apple Silicon 用 `Folia-Spotify-{{VERSION}}-arm64.dmg`，Intel 用 `Folia-Spotify-{{VERSION}}-x64.dmg`
  - 開啟時提示「應用已損壞」，是因為安裝檔沒有簽名，不是檔案壞了。解決方法見[這份說明]({{MACOS_UNSIGNED_HELP_URL}})
  - 裝過 0.7.2303 以後的版本，App 會自己更新（「設定 → 通用」）。App 要放在「應用程式」資料夾裡，直接從 dmg 開啟只會提醒、不會自己更新。
  - 更新後如果 macOS 問「Folia-Spotify 想使用鑰匙圈裡的資料」，按「永遠允許」。這是因為安裝檔沒有簽名，每一版在系統看來都像新的 App。
- Linux：
  - Debian / Ubuntu：`Folia-Spotify-{{VERSION}}-linux-amd64.deb`
  - Fedora / openSUSE：`Folia-Spotify-{{VERSION}}-linux-x86_64.rpm`
  - 其他發行版：`Folia-Spotify-{{VERSION}}-linux-x64.tar.gz`
  - ARM64：`Folia-Spotify-{{VERSION}}-linux-arm64.deb` / `-linux-aarch64.rpm` / `-linux-arm64.tar.gz`
- iPhone：見 [Folia-Spotify-on-iPhone](https://github.com/yu-0615/Folia-Spotify-on-iPhone)

Folia-Spotify 和原版 Folia 是兩個獨立的 App，設定分開儲存；自動更新只從本儲存庫取得。

版本號是「原版版本 + 兩位序號」：`{{VERSION}}` 代表以原版 v{{UPSTREAM_VERSION}} 為基礎。

<details>
<summary><b>與原版 Folia 的差異</b></summary>

### Spotify
- 接入 Spotify（官方 Web API + PKCE 登入），Client ID 在登入時填寫。
- 歌一律在你自己的 Spotify App 裡播放，Folia 跟著顯示歌詞、控制播放，控制面板顯示正在播放的裝置。
- 在 Spotify App 裡放的歌，Folia 也會跟著放，並帶上 Spotify 的播放佇列（最多 50 首，接近尾端時自動補下一批）。
- 歌單頁放上 Spotify 的 Daily Mix 1–6；桌面版探索頁先顯示「為你推薦」。
- 網頁版的歌詞從其他來源自動匹配。
- Spotify 的歌不能用等化器（聲音由 Spotify App 發出）。

### 書庫與介面
- 書庫新增「單曲」頁籤（排在最前）。
- 網易雲、QQ 音樂、酷狗、波點、汽水音樂預設只作為歌詞來源（「設定 → 連線與整合」可以開啟）；沒選過平臺時從 Spotify 開始。
- 補上越南語的 Spotify 相關文案。

### YouTube Music
- 登入可以「重新開啟瀏覽器」；繁中介面下頁面以繁中讀取；探索頁新增「心情與曲風」。

### 模組
- 新增「簡轉繁」模組；每個模組可以設定「檔案改了也不用重新確認」。

### 開發
- `npm run dev:web`：一次啟動網頁版和本機的網易雲、QQ、酷狗 API。
- `npm run build:mac`：在本機 Mac 打包出該架構的 `.app`。

</details>

逐項修改見[提交紀錄](https://github.com/yu-0615/Folia-Spotify/commits/main)。

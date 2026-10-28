> [!NOTE]
> Folia-Spotify 是 [Folia](https://github.com/chthollyphile/folia-major)（作者 [chthollyphile](https://github.com/chthollyphile)）的 fork，沿用 AGPL-3.0。原有功能的問題請到原專案回報。

## 下載說明

- Windows：下載 `Folia-Spotify-Setup-<version>.exe`
- macOS：
  - Apple Silicon：下載 `Folia-Spotify-<version>-arm64.dmg`
  - Intel Mac：下載 `Folia-Spotify-<version>-x64.dmg`
  - 如果開啟時提示「應用已損壞」，這通常是目前的 macOS 安裝檔未簽名 / 未 notarize 導致的 Gatekeeper 攔截，不是安裝檔本身損壞。解決方法見[這份說明]({{MACOS_UNSIGNED_HELP_URL}})
- Linux：
  - Debian / Ubuntu：下載 `folia-major-<version>-linux-amd64.deb`
  - Fedora / openSUSE：下載 `folia-major-<version>-linux-x86_64.rpm`
  - 其他發行版：下載 `folia-major-<version>-linux-x64.tar.gz`
  - ARM64（樹莓派等 aarch64 裝置）：依發行版下載 `folia-major-<version>-linux-arm64.deb` / `folia-major-<version>-linux-aarch64.rpm` / `folia-major-<version>-linux-arm64.tar.gz`

Folia-Spotify 與原版 Folia 是兩個獨立的 App（`Folia-Spotify.app`，設定分開儲存），可以同時安裝；自動更新只從本儲存庫取得。

## 與原版 Folia 的不同

- 網頁版接入 Spotify（官方 Web API + PKCE 登入 + Web Playback SDK），也能在播放頁控制面板選帳號裡的其他 Spotify 裝置（手機、電腦、音箱）來播放。
- Spotify 網頁版的歌詞從其他來源自動匹配。
- 網易雲、QQ 音樂、酷狗、波點、汽水音樂預設只作為歌詞來源（設定「連線與整合」裡可以開啟），沒選過平臺時從 Spotify 開始。
- Spotify 歌曲的等化器會說明它無法作用（聲音由 Spotify 自己的播放器或別的裝置發出）。
- 新增 `npm run dev:web`，一次啟動網頁版和本機的網易雲、QQ、酷狗 API。

逐項修改見本儲存庫的提交紀錄。

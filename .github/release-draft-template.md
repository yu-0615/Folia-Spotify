> [!NOTE]
> Folia-Spotify 是 [Folia](https://github.com/chthollyphile/folia-major)（作者 [chthollyphile](https://github.com/chthollyphile)）的 fork，沿用 AGPL-3.0。原有功能的问题请到原项目反馈。

## 下载说明

- Windows：下载 `Folia-Spotify-Setup-<version>.exe`
- macOS：
  - Apple Silicon：下载 `Folia-Spotify-<version>-arm64.dmg`
  - Intel Mac：下载 `Folia-Spotify-<version>-x64.dmg`
  - 如果打开时提示“应用已损坏”，这通常是当前 macOS 包未签名 / 未 notarize 导致的 Gatekeeper 拦截，不是安装包本身损坏。解决方法见[这份说明]({{MACOS_UNSIGNED_HELP_URL}})
- Linux：
  - Debian / Ubuntu：下载 `folia-major-<version>-linux-amd64.deb`
  - Fedora / openSUSE：下载 `folia-major-<version>-linux-x86_64.rpm`
  - 其他发行版：下载 `folia-major-<version>-linux-x64.tar.gz`
  - ARM64（树莓派等 aarch64 设备）：按发行版下载 `folia-major-<version>-linux-arm64.deb` / `folia-major-<version>-linux-aarch64.rpm` / `folia-major-<version>-linux-arm64.tar.gz`

Folia-Spotify 与原版 Folia 是两个独立的应用（`Folia-Spotify.app`，设置分开保存），可以同时安装；自动更新只从本仓库获取。

## 与原版 Folia 的不同

- 网页版接入 Spotify（官方 Web API + PKCE 登录 + Web Playback SDK），也能在播放页控制面板选账号里的其他 Spotify 设备（手机、电脑、音箱）来放。
- Spotify 网页版的歌词从其他来源自动匹配。
- 网易云、QQ 音乐、酷狗、波点、汽水音乐默认只作为歌词来源（设置「连接与集成」里可以打开），没选过平台时从 Spotify 开始。
- Spotify 歌曲的均衡器会说明它够不着（声音由 Spotify 自己的播放器或别的设备发出）。
- 新增 `npm run dev:web`，一次启动网页版和本地的网易云、QQ、酷狗 API。

逐项修改见本仓库的提交记录。

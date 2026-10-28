<p align="center">
  <img src="https://github.com/user-attachments/assets/b5d0e863-48be-497b-b0e9-4bd8d8ce9bf0" alt="Folia" width="100%" />
</p>

> [!NOTE]
> **Folia-Spotify** is a fork of [Folia](https://github.com/chthollyphile/folia-major) by [chthollyphile](https://github.com/chthollyphile), released under the original project's [AGPL-3.0](LICENSE) license. Folia's design and nearly all of its code are the work of the original author and [its contributors](CONTRIBUTORS.md); please report issues with the original features to, and star, the original project.
>
> Changes made in this fork since 2026-10: Spotify in the web version (official Web API, PKCE sign-in and Web Playback SDK playback, see `src/services/onlineMusic/spotify/web/`), which can also play on the account's other Spotify devices (a phone, a computer, a speaker) chosen in the player's controls; lyrics for Spotify songs on the web matched from other sources; NetEase Cloud Music, QQ Music, Kugou, Bodian and Qishui serve as lyric sources only by default (they can be turned back on under Settings → Connections); listeners who have not chosen a platform start on Spotify; `npm run dev:web` starts the web version together with local NetEase, QQ and Kugou APIs. See this repository's commit history for each change.

<div align="center">
<a href="https://trendshift.io/repositories/71740?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-71740" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/71740" alt="chthollyphile%2Ffolia-major | Trendshift" width="250" height="55"/></a>

# Folia

Lyrics Reimagined // 辞曲新境

[繁體中文](README.md) | English

[![GitHub release](https://img.shields.io/github/v/release/yu-0615/Folia-Spotify?label=release)](https://github.com/yu-0615/Folia-Spotify/releases)
[![License](https://img.shields.io/github/license/chthollyphile/folia-major)](https://github.com/chthollyphile/folia-major/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/chthollyphile/folia-major?style=social)](https://github.com/chthollyphile/folia-major/stargazers)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/chthollyphile/folia-major)
[![Discord](https://img.shields.io/discord/1541051241822687232?logo=discord&logoColor=white&label=Join%20our%20Discord)](https://discord.gg/dMDBTHxeKd)
[![All Contributors](https://img.shields.io/badge/all_contributors-35-orange.svg?style=flat-square)](CONTRIBUTORS.md)

[Get Folia](#get-folia)
·
[Deploy to Vercel](https://vercel.com/new/clone?repository-url=https://github.com/yu-0615/Folia-Spotify)
·
[Spotify](#spotify)
·
[User Guide](https://folia-site.cielaniska.top/guide/)
·
[Technical Notes](docs/technical.md)

</div>

## About

Folia is an online music player built around full-screen, immersive lyrics. It supports NetEase Cloud Music, Kugou, QQ Music, Navidrome, and local music libraries; the desktop app also supports Bodian Music, YouTube Music, Spotify, and Qishui Music. Smart lyric matching, AI-generated color themes, and a range of full-screen lyric animations make listening feel different.

Folia ships as an Electron desktop app for Windows, macOS, and Linux, and as a Node.js web app you can deploy to many platforms.

To use Folia on a phone or in a browser, [deploy the web app to Vercel in one click](https://folia-site.cielaniska.top/guide/deploy-vercel), or deploy it yourself to any platform that runs Node.js.

## Quick download

> [!TIP]
> - **GitHub**: [Latest Release](https://github.com/yu-0615/Folia-Spotify/releases/latest) has Folia-Spotify installers for Windows, macOS, and Linux (it installs beside the original Folia).
> - The original Folia's installers, cloud-drive downloads included, are on [the original project's Releases](https://github.com/chthollyphile/folia-major/releases/latest).
>
> For other options (web deployment, Docker, AUR, Flatpak, mobile), see [Get Folia](#get-folia) below.

## Spotify

Folia-Spotify plays Spotify in both the desktop app and the web version, each in its own way.

### Desktop

Choose Spotify under "Connect a streaming service"; your browser opens Spotify's consent page, and agreeing signs you in. Nothing to set up. The desktop app keeps the original author's implementation through the services of Spotify's own client: search, playback, your playlists and library, Spotify's own line-timed lyrics, and the radio and explore pages. Playback needs Spotify Premium.

If playback says this Spotify account cannot play here, Spotify gives the account no audio key (most accounts created since late 2024, and some older ones), so the app's own player cannot play them. Have **Folia control and the Spotify app sound** instead:

1. Create your own Spotify app as in steps 1, 2 and 4 of the web version below, with the Redirect URI `http://127.0.0.1:5590/spotify-callback.html`.
2. Open the Spotify app (or Spotify on a phone or a speaker).
3. In the player's controls, open "Playing on", enter your Client ID, choose "Sign in to choose another device", and agree in your browser.
4. Choose the Spotify app or another device. Folia keeps choosing songs, controlling playback and showing synced lyrics, and the sound comes from that device. "Folia's own player" switches back.

### Web version

The web version uses Spotify's official Web API and Web Playback SDK, signed in through a Spotify app you register:

1. Create an app on [Spotify for Developers](https://developer.spotify.com/dashboard) with **Web API** and **Web Playback SDK** checked.
2. Under **Redirect URIs**, add `https://<your domain>/spotify-callback.html`. For local development, `http://127.0.0.1:3000/spotify-callback.html` (Spotify does not accept `localhost`; a public site must use https).
3. The sign-in window asks for the Client ID (kept on that device only). A deployment can also build with `VITE_SPOTIFY_CLIENT_ID` as the default; set `VITE_SPOTIFY_REDIRECT_URI` only when the redirect differs from the default. The Client ID is not a secret; **the Client Secret is not used, so leave it out**.
4. Add the accounts that will sign in under the app's **User Management**. An app in development mode lets in at most 5 accounts, and the owner and the users need Premium.

For local development, this starts the web version together with the NetEase, QQ Music and Kugou APIs that lyric matching uses (from `node_modules`, no Docker):

```bash
npm run dev:web
```

Then open `http://127.0.0.1:3000` (not `localhost`, or the Spotify sign-in redirect will not match).

What the web version does:

- Search, playback, your playlists and library, likes, adding songs to and removing them from your playlists, creating playlists.
- **Playing on another device**: "Playing on" in the player's controls moves playback to another Spotify device of your account (a phone, the Spotify app on a computer, a speaker), which Folia keeps controlling, with synced lyrics. A device shows up once Spotify is open on it.
- Lyrics are matched from NetEase, QQ Music, Kugou and AMLL.

Limits Spotify sets for third-party apps (not something Folia can change):

- Only the songs of playlists you made or collaborate on can be read. Other people's playlists, and Spotify's own ones such as Daily Mix, Discover Weekly and Release Radar, cannot. The desktop app goes through other services without these limits.
- No Spotify lyrics, radio or explore page.
- The sound comes from Spotify's own player (protected audio) or the device you chose, so the equalizer, effects, visualizer and automix cannot reach Spotify songs.
- Playing in this browser needs Widevine (Chrome, Edge and Firefox have it); only controlling another device does not.

### Platforms in mainland China

NetEase Cloud Music, QQ Music, Kugou, Bodian and Qishui serve as lyric sources only by default and stay out of the platform list. To switch to and sign in to them as in the original, turn on "Show every platform in the platform list" under Settings → Connections.

## Showcase

![visualizer](./img/visualizer.png)

### Demo videos

https://github.com/user-attachments/assets/af806cf1-f67f-4b88-b2e7-57db507e9e81

https://github.com/user-attachments/assets/fd27f4f0-64b9-4c57-8c3b-10df767f934b

https://github.com/user-attachments/assets/704f195a-2194-434b-86e8-8f36290e5cc4

### Selected styles

<table>
  <tr>
    <td width="50%">
      <img src="./img/preview-fume.png" alt="Fume preview" />
    </td>
    <td width="50%">
      <img src="./img/preview-lumi.png" alt="Luminous preview" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Fume</strong></td>
    <td align="center"><strong>Luminous</strong></td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./img/preview-cad.png" alt="Mindscape preview" />
    </td>
    <td width="50%">
      <img src="./img/preview-pat.png" alt="Partita preview" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Mindscape</strong></td>
    <td align="center"><strong>Partita</strong></td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./img/preview-cappella.jpg" alt="Cappella preview" />
    </td>
    <td width="50%">
      <img src="./img/preview-tilt.png" alt="Tilt preview" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Cappella</strong></td>
    <td align="center"><strong>Tilt</strong></td>
  </tr>
    <tr>
    <td width="50%">
      <img src="./img/preview-diorama.png" alt="Diorama preview" />
    </td>
    <td width="50%">
      <img src="./img/preview-pendolo.png" alt="Pendolo preview" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>Diorama</strong></td>
    <td align="center"><strong>Pendolo</strong></td>
  </tr>
</table>

Each lyric animation has its own typography, mood, and tunable parameters, giving full-screen lyrics the richness of a lyric video while staying responsive to any window size.

## Features

| Feature | Description |
| --- | --- |
| Online search and playback | Search for songs, artists, or albums and play them; covers and lyrics load automatically. |
| Local music | Import local audio files. Folia stores the index locally and never uploads file contents. See [Local Library Management](docs/local-library-management.md) (Chinese). |
| Smart lyric matching | Local songs are matched to online lyrics and covers automatically; you can correct matches by hand. |
| Local lyric files | Loads `.lrc`, `.vtt`, `.ttml`, `.qrc`, `.yrc`, and `.krc` files with the same name in the same folder, as well as embedded LRC lyrics. Supports the enhanced word-by-word formats produced by LDDC. |
| Now Playing integration | Connects to a local [Now Playing](https://github.com/Widdit/now-playing-service/) service to take song, timeline, and lyric data from external players and drive Folia's stage view and full-screen lyrics. |
| AI themes | Generates immersive backgrounds and visual parameters from a song's mood and lyrics. |
| Multi-platform | Deploy as a web app or install the packaged desktop app. |
| Mods (experimental) | On desktop, Folium mods can add lyric animations, backgrounds, player-page layers, commands, and more. Install officially verified mods from the [mod market](https://folium-compound.cielaniska.top). See [Mods](#mods-folium-v1x). |

## Get Folia

The desktop app bundles both frontend and backend, so it works right after install.

### One-click deployment

To put the web app online quickly, follow the [Vercel deployment guide](https://folia-site.cielaniska.top/guide/deploy-vercel).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yu-0615/Folia-Spotify)

Folia also deploys to Cloudflare in one click; adapt the Vercel guide accordingly.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yu-0615/Folia-Spotify)

On Vercel and Cloudflare, QQ Music no longer needs a separate, always-on API instance: set `VITE_QQ_API_BASE` to `/api/qq` and add a `QQ_SESSION_SECRET` (a server-side secret, **without the `VITE_` prefix**). This setup supports login by scanning a QR code with WeChat or mobile QQ (mobile QQ requires qq-music-api 3.3.3 or later), and you must log in before playback. On Cloudflare you can also bind a Durable Object so QQ QR login uses a long-lived connection and gains QR login with the QQ Music app. For full steps, platform differences, and troubleshooting, see the [QQ Music deployment guide](docs/qq-music-deployment.md) (Chinese).

Self-hosters can use the [Docker Compose full-stack deployment](deploy/docker/README.md). Access to local music folders requires a trusted HTTPS secure context; the deployment docs cover NAS reverse proxies and certificate requirements.

### Direct download

- **Windows / macOS / Linux**: Download Folia-Spotify from the [Releases page](https://github.com/yu-0615/Folia-Spotify/releases/latest). The macOS build is unsigned; if macOS says it is damaged on first launch, see [this note](docs/desktop/macos-app-damaged.md) (Chinese).
- **The original Folia**: [folia-major-bin](https://aur.archlinux.org/packages/folia-major-bin) on the AUR and the community [Flatpak](https://flatpark.org/apps/top.izuna.foliamajor/) are the original, without this fork's changes.
- **Android / iPhone**: Third-party community ports and the iPhone deployment are listed under [Mobile](#mobile) below.

For Linux packages, the Wayland / Hyprland remote control window, and other desktop details, see [Technical Notes](docs/technical.md) (Chinese).

### Mobile

| Option | Details |
| --- | --- |
| **PWA (recommended)** | Deploy the web or self-hosted version, then add it to your home screen from Chrome for Android or iOS Safari to use it as a PWA. |
| **iPhone deployment** | [yu-0615/Folia-on-iPhone](https://github.com/yu-0615/Folia-on-iPhone): the Folia web version deployed to Vercel and added to the home screen from Safari on iPhone. See that repository for how to deploy it. |
| **Community ports (Android)** | [maimai993/folia-sonnet](https://github.com/maimai993/folia-sonnet) · [whycfawa/folia-android](https://github.com/whycfawa/folia-android) |
| **Build it yourself (Android)** | If you are comfortable with the tooling, package the web version as an installable APK with Capacitor. See the example repository [chthollyphile/folia-sonnet](https://github.com/chthollyphile/folia-sonnet). |

> [!NOTE]
> Community ports are third-party projects maintained independently by the community, and their features differ from the official desktop version. Please report any issues to the corresponding repository.

## Documentation and development

For the full user guide, visit [Folia Guide](https://folia-site.cielaniska.top/guide/).

Deployment, environment variables, local development, the Stage API, common scripts, and the tech stack are covered in [Technical Notes](docs/technical.md) (Chinese).

Before contributing, read the [Contributing Guide](CONTRIBUTING.en.md).

## Mods (Folium v1.x)

> [!NOTE]
> Mods are experimental, available in the desktop app only, and off by default. Turn them on in **Settings → Mods → Mod system**.

Folium is Folia's mod platform. Mods can add lyric animation modes and background types, overlay content on the player page, add buttons and markers to the progress bar, register commands and settings sections, rewrite lyrics before they are displayed, and use native capabilities such as ffmpeg through a Node entry point. Mods run as trusted code: you confirm each mod in a native window before it is enabled, and confirm again after its files change.

- **Mod market**: [folium-compound.cielaniska.top](https://folium-compound.cielaniska.top) hosts official mods and reviewed community mods. Download the zip and drag it into the Mods panel to install.
- **Verification**: Every mod in the market carries a Folium signature and shows as **Verified** after install. Early-access mods that passed only the security review show as **Preview**. Third-party mods without a signature show as **Unverified** and still work.
- **Developing and contributing**: The [mod development and contribution guide](docs/folium/contributing.md) walks from your first mod and local debugging through submitting to the market, review and signing, and publishing updates.
- **API reference**: The [Folium API reference](docs/folium/api.md) is generated from the contract file and organized by registries, contexts, events, and services.
- **Platform spec**: The [Folium spec](mods/README.md) covers manifest fields, permissions, registry semantics, events, the security model, and versioning.
- **Example mods**: The repository's [`mods/`](mods/) folder covers lyric animations, tuning, the progress bar, player-page layers, and transparent video export.

## Sync Server

Folia offers an optional official sync server, `sync-server`, that syncs appearance settings and the AI theme library across devices. You host it yourself; it suits anyone who wants their color themes on every device.

Deployment options:

- **Cloudflare Workers / D1**: Serverless, no servers to maintain. Recommended.
  [![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chthollyphile/folia-major/tree/main/sync-server)
- **Docker**: See the [Docker deployment folder](deploy/docker/README.md) for the image and Compose setup.
- **Self-hosted Node.js**: Uses SQLite; suits local machines or environments where Docker is inconvenient.

For environment variables, token setup, and deployment steps, see the [Sync Server deployment guide](https://folia-site.cielaniska.top/guide/deploy-sync). Once deployed, enter the server URL and `SYNC_TOKEN` in **Settings → Connections** to turn on sync.

## Local music and matching

Folia reads audio metadata plus lyrics and covers from the same folder, and can fill in song details from NetEase Cloud Music, QQ Music, or Kugou. Automatic matching tries NetEase, then QQ, then Kugou. When a match is wrong, you can pick another candidate, restore the local data from the first import, or merge and split artist and album entries.

For importing, rescanning, matching, entry editing, playlists, caching, and troubleshooting, see [Local Library Management](docs/local-library-management.md) (Chinese).

## Community

Join the Discord to chat and get help.

[![Discord](https://img.shields.io/discord/1541051241822687232?logo=discord&logoColor=white&label=Join%20our%20Discord)](https://discord.gg/dMDBTHxeKd)

## Contributors

Thanks to everyone who has filed issues, reported bugs, suggested ideas, tested, or written code. Contributions are tracked under the all-contributors specification.

The list is long, so see [Contributors](CONTRIBUTORS.md).

## Legal and disclaimer

This project was developed with extensive AI assistance and may still contain subtle or hard-to-spot problems. We apologize for any inconvenience.

The project mainly showcases playback animation, interface design, and the engineering behind them. Copyright in the online streams, lyrics, album art, and other content shown in the app belongs to the respective rights holders.

This repository and its source code are for personal study, technical exchange, and non-profit testing only. Do not use them for commercial purposes. Users bear sole responsibility for any copyright dispute or other liability arising from distributing, modifying, or redistributing online resources; the developers accept no liability.

Please respect digital rights and support licensed music through official platforms whenever you can.

## Acknowledgements

Special thanks to these projects and resources:

- [chenmozhijin/LDDC](https://github.com/chenmozhijin/LDDC)
- [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)
- [chenglou/pretext](https://github.com/chenglou/pretext)
- [MakcRe/KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)
- [paper-design/shaders](https://github.com/paper-design/shaders)
- [yakult-green-tea/qq-music-api](https://github.com/yakult-green-tea/qq-music-api)

Folia uses the [Apple Music-like Lyrics TTML word-by-word lyrics database](https://github.com/amll-dev/amll-ttml-db) for high-quality lyric files. Thanks to its authors and contributors.

## License

Folia is open source under the `AGPL-3.0` license.

# macOS 提示：`Folia-Spotify.app` 顯示「應用已損壞」或「無法驗證」

如果你從 GitHub Releases 下載桌面版後，macOS 彈出「`Folia-Spotify.app` 已損壞，無法開啟。你應該將它移到廢紙簍」，或者「Apple 無法驗證 `Folia-Spotify.app` 是否包含惡意軟體」，通常不是安裝檔真的壞了，而是因為目前釋出的 macOS 版本沒有 Apple Developer ID 簽名和 notarization。

從瀏覽器下載的檔案會帶上 `com.apple.quarantine`（下載隔離）屬性。macOS Gatekeeper 只檢查帶這個屬性的應用，未簽名或未公證的應用會被攔截，簽名不完整時提示文案會顯示成「已損壞」。

## 使用前先確認

- 只從本儲存庫的 Releases 頁面下載對應版本的 macOS 安裝檔，例如 `Folia-Spotify-0.1.0-arm64.dmg`
- 先把 `Folia-Spotify.app` 從 dmg 視窗拖到 `Applications`，不要直接在 dmg 掛載盤裡執行
- 如果下載過程中中斷過，先重新下載一次再試

## 方案一：移除下載隔離屬性（推薦）

在終端機執行：

```bash
xattr -dr com.apple.quarantine /Applications/Folia-Spotify.app
```

如果你的應用不在 `Applications`，把路徑改成實際位置，例如：

```bash
xattr -dr com.apple.quarantine ~/Downloads/Folia-Spotify.app
```

執行後從 `Applications` 重新開啟應用即可。這個方法對「已損壞」和「無法驗證」兩種提示都有效。

macOS 版目前不支援應用內自動更新。每次從 Releases 下載新版本覆蓋安裝後，新的 `Folia-Spotify.app` 會重新帶上下載隔離屬性，需要再執行一次上面的命令。

## 方案二：在「隱私與安全性」裡允許

只適用於提示「無法驗證」、而不是「已損壞」的情況。Apple 晶片（M 系列）的 Mac 上通常提示的是「已損壞」，請直接使用方案一。

1. 先雙擊開啟一次 `Folia-Spotify.app`，在彈窗裡點「完成」
2. 開啟「系統設定」
3. 進入「隱私與安全性」
4. 滾動到頁面底部
5. 找到關於 `Folia-Spotify.app` 被阻止的提示，點選「仍要開啟」

然後再回到 `Applications` 啟動一次。

提示「已損壞」時這裡通常不會出現「仍要開啟」，請使用方案一。

> macOS 15 及更新版本已經取消了「按住 `Control` 點選應用 → 開啟」的繞過方式，這一步不再有效。

## 如果還是打不開

- 刪除目前 `Folia-Spotify.app` 和已下載的 `dmg`，重新從 Releases 下載
- 確認你執行的是拖曳後的 `Folia-Spotify.app`，不是 dmg 裡的臨時掛載版本
- 執行完方案一後，確認是重新從 `Applications` 啟動，而不是點之前殘留的彈窗
- 帶上終端機輸出和「控制台」(Console.app) 裡 `syspolicyd` / `amfid` 的相關報錯提交 issue

`spctl --assess -vv /Applications/Folia-Spotify.app` 對未簽名應用總是顯示 rejected，這是預期結果，不代表方案一沒有生效。

## 為什麼現在會這樣

目前釋出流程會正常打出 macOS 安裝檔，但還沒有接入 Apple Developer ID 簽名和 notarization。只要沒有這一步，macOS 就會在首次開啟時攔截應用，並把簽名不完整的應用提示為「已損壞」。

給安裝檔補一個本地臨時簽名（ad-hoc）可以讓提示變成「無法驗證」，但沒有 Apple 開發者身份的簽名每個版本都不一樣，鑰匙圈會在每次更新後要求重新輸入密碼才能讀取已儲存的登入資訊，所以在接入 Developer ID 之前不會這樣做。

如果後續接入簽名與 notarization，這個提示可以隨之移除。

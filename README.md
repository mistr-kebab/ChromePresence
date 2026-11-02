# Chrome Presence

Show your current Chrome activity as **Discord Rich Presence** – for example:

> **Playing Chrome**  
> An exciting video – YouTube  
> youtube.com  
> for 12:34

Everything runs locally on your computer. The extension sends the finished
activity through Chrome Native Messaging to a small Node.js host, and the host
connects directly to the Discord desktop app over its local IPC socket. There
is **no developer server**, no telemetry, and no Discord bot login.

## Requirements

- Chrome or a compatible Chromium browser, version 116 or newer
  (e.g. Chromium, Brave, Edge, Vivaldi)
- [Node.js](https://nodejs.org/) 18 or newer
- The **Discord desktop app** (the web version does not support local RPC)
- Windows 10/11, Linux, or macOS
- Your own Discord application (free; only the Application ID is needed)

The project has no npm dependencies. `npm install` is not required.

## Installation

### 1. Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the `ChromePresence` folder (the folder
   containing `manifest.json`).
4. Thanks to the fixed key in `manifest.json`, the extension ID is always
   `mfojmeangbphbdldmkohijbachjonlhp`. The installer enters exactly this ID.

> After changing project files, click the reload arrow for the extension on
> `chrome://extensions`.

### 2. Install the native host

From the project folder:

**Linux / macOS**

```bash
./host/install.sh
```

**Windows** (Command Prompt or PowerShell)

```bat
.\host\install.cmd
```

On Linux and macOS the installer detects existing browser configuration folders
and writes `app.chromepresence.host.json` into each browser's
`NativeMessagingHosts` folder. It also generates the `host/run-host.sh` wrapper
containing the absolute path to the current Node.js executable.

On Windows the installer writes
`%LOCALAPPDATA%\ChromePresence\app.chromepresence.host.json` and registers that
manifest in the current user's registry for Chrome, Chromium, Brave, Edge,
Vivaldi, Opera, Opera GX, and Arc. It also generates `host\run-host.cmd`, which
launches Node.js. Administrator rights are not required.

You can also use npm on any platform:

```bash
npm run install-host -- --dry-run
npm run install-host -- --help
```

Useful variants:

```bash
# Linux / macOS
./host/install.sh --dry-run       # show what would happen, write nothing
./host/install.sh --all           # include known browser folders that don't exist yet
./host/install.sh --target="$HOME/.config/google-chrome"

# Windows
.\host\install.cmd --dry-run
.\host\install.cmd --target=HKCU\Software\Google\Chrome\NativeMessagingHosts
```

`--target` can be repeated and limits the installation to the given target.
On Linux and macOS it is a browser configuration folder (or a
`NativeMessagingHosts` folder itself); this is also useful for isolated test
profiles. On Windows it is a registry key. `HKCU` is assumed when the hive is
omitted, and the host name is appended when the key ends with
`NativeMessagingHosts`.

After installing:

1. Reload the extension at `chrome://extensions`.
2. If the connection still fails, quit Chrome completely and start it again.
3. Run `npm run doctor` to see what is missing.

> **Updated Node.js?** The wrapper stores the absolute Node path. Run the
> installer again after a Node update. This is especially important for
> version-specific paths managed by nvm.

### 3. Create a Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications)
   and click **New Application**.
2. Choose a name. This name will appear in Discord – for example, **Chrome**,
   so Discord displays “Playing Chrome”.
3. Under **General Information**, copy the **Application ID**
   (16–22 digits).
4. Open the extension settings and enter the ID under
   **Discord Application ID**. Settings save automatically.
5. Click **Restart connection**.

A bot token, OAuth, or inviting a bot is **not** required. The Application ID
is not a secret.

### 4. Optional: upload an image

The extension works without an image. To use the included Chrome icon:

1. Upload `assets/discord-asset.png` in the Developer Portal under
   **Rich Presence → Art Assets**.
2. Name the asset `chrome`.
3. In the extension settings, set **Large image – asset key** to `chrome` and
   the tooltip to something like `Google Chrome`.

Discord may take a moment to make new assets available. If the asset key is
wrong or not available yet, Discord won't show the image; the text lines still
work.

By default, the extension uses the website icon shown in the tab as the large
image, so you don't need to upload anything just to see a site icon.

## Check Discord settings

For activity to be visible:

- The Discord desktop app must be running.
- Under **Settings → Activity Privacy** (or **Activity Status**), sharing
  your current activity must be enabled.
- Your Discord status must not be **Invisible**.
- Discord in the browser does not support local Rich Presence. Use the desktop
  client.

## Configure the display

| Setting | Effect |
| --- | --- |
| **Activity type** | Playing, Listening, Watching, or Competing |
| **First line** | Tab title or domain only |
| **Second line** | Domain, domain + path, or full URL |
| **Elapsed time** | Shows “for …”; starts when you switch to a page |
| **Website icon** | Uses the tab's site icon, loaded through Google (on by default) |
| **Large/small image** | Asset keys from your Discord application |
| **Only when Chrome is focused** | Hides presence when Chrome is not focused |
| **Idle detection** | Hides presence after X minutes without input; `0` disables it |
| **Don't share incognito tabs** | Recommended; incognito windows are never sent |
| **Excluded domains** | One domain per line; subdomains are included automatically |

Settings are stored in `chrome.storage.sync`. If you use Chrome Sync, they may
be synchronized with your Google account, depending on your Chrome settings.
The Application ID and exclusion list would then also be available on other
devices.

### Privacy quick start

For a more discreet profile:

- **First line:** Domain only
- **Second line:** Domain only
- **Elapsed time:** off
- **Website icon:** off (this prevents domains from being sent to Google)
- **Only when Chrome is focused:** on
- **Don't share incognito tabs:** on
- Add sensitive domains to the exclusion list

See [PRIVACY.md](PRIVACY.md) for details.

## How it works

```text
Active tab
    │  chrome.tabs / chrome.idle
    ▼
Chrome extension (MV3)
    │  Native Messaging (stdio, length-prefixed JSON)
    ▼
host/host.cjs  ──  local Discord IPC socket  ──▶  Discord desktop app
```

- The extension watches the active tab, window focus, and idle state.
- It builds the finished Discord activity and sends **only that** to the host.
- The host connects to Discord's Unix socket or named pipe, sends
  `SET_ACTIVITY`, and keeps the latest activity in memory.
- Updates are throttled so Discord is not flooded. The newest activity wins.
- If the connection drops, the extension and host try to reconnect
  automatically.

The host supports the usual Discord socket paths on Linux and macOS, including
Flatpak and Snap paths. On Windows it connects to Discord's
`discord-ipc-0` to `discord-ipc-9` named pipes.

## Permissions

| Permission | Purpose |
| --- | --- |
| `tabs` | Read the active tab's title and URL |
| `storage` | Store settings and the latest runtime state |
| `idle` | Detect idle time |
| `nativeMessaging` | Talk to the local host |
| `alarms` | Wake the service worker periodically and check the connection |

There are **no content scripts**, no access to page contents, no
web-accessible resources, and no network access from the extension. The one
optional external request comes from the website-icon feature: Discord loads
the favicon from Google, which sends the visited domain to Google. It is on by
default and can be turned off in the settings.

## Diagnostics and tests

```bash
npm test          # unit and integration tests, including a fake Discord socket
npm run doctor    # installation and environment diagnostics
```

`npm run doctor` checks:

- Node.js version and the extension ID
- host files and whether the wrapper is executable
- whether the host starts and responds
- installed native messaging manifests and their `allowed_origins`
- whether a Discord IPC socket can be found

For a custom test profile:

```bash
node host/doctor.mjs --target=/path/to/profile
```

## Security

Please report vulnerabilities privately through the **Security** tab of the
GitHub repository (**Report a vulnerability**). Do not open a public issue.
See [SECURITY.md](SECURITY.md) for scope and expectations.

The extension has no third-party runtime dependencies. CI runs the test suite
and `npm audit`; GitHub Dependabot, secret scanning, and CodeQL are enabled for
the repository.

## Troubleshooting

### “Native host unreachable”

1. Run `npm run doctor` and read its output.
2. Make sure the installer ran for **the browser you use**:
   - Linux/macOS: `./host/install.sh --target=<browser-profile-folder>`
   - Windows: `.\host\install.cmd --target=<registry-key>`
3. Reload the extension at `chrome://extensions`; if necessary, quit and
   restart Chrome.
4. Check the generated wrapper and the Node path stored inside it:
   - Linux/macOS: `host/run-host.sh`
   - Windows: `host\run-host.cmd`
5. On Windows, verify the registry entry and that the manifest file it points
   to exists:

   ```bat
   reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\app.chromepresence.host" /ve
   ```

6. Chrome installed through Snap or Flatpak may block the local host. A native
   Chrome installation is the most reliable option.

### “Discord unreachable”

- Start the Discord desktop app, not just Discord in a browser.
- Quit Discord completely and start it again.
- Check whether the socket exists:
  - Windows: the `\\?\pipe\discord-ipc-0` named pipe (the host also tries
    `discord-ipc-1` to `discord-ipc-9`)
  - normal: `$XDG_RUNTIME_DIR/discord-ipc-0` or `/tmp/discord-ipc-0`
  - Flatpak: `$XDG_RUNTIME_DIR/app/com.discordapp.Discord/discord-ipc-0`
- With Discord in a Flatpak sandbox, the socket must be reachable by the host.
  If it isn't, a native Discord installation usually helps.

### “Discord reported an error” / code 4000

The Application ID is usually wrong or the Discord application has been
deleted. Copy the ID again from the Developer Portal (digits only, no spaces)
and restart the connection.

### No activity in Discord

- Be on a normal `http://` or `https://` page. Internal pages such as
  `chrome://extensions` are not shared.
- Check whether the domain is in the exclusion list.
- Check whether presence is paused or idle detection has triggered.
- Keep activity sharing enabled in Discord and don't use Invisible status.
- The extension settings show a preview and the connection status. If it says
  “Connected” but Discord shows nothing, the issue is usually Discord's privacy
  settings or your status.

### Image missing

The asset key and asset name must match exactly (including case). Restart
Discord after uploading and give it some time. If you don't upload an asset,
leave the field empty. The default website icon is independent of the large
image asset key.

### Extension ID changed

The ID is tied to the `key` in `manifest.json`. Don't remove or change it. If
you do, run the installer again so `allowed_origins` matches. The ID is shown in
the extension settings and by `npm run doctor`.

## Uninstall

1. Remove the extension at `chrome://extensions`.
2. Remove the host manifests or registry entries:

   ```bash
   # Linux / macOS
   ./host/install.sh --uninstall

   # Windows
   .\host\install.cmd --uninstall
   ```

   If you installed with `--target`, pass the same target again:

   ```bash
   ./host/install.sh --uninstall --target="$HOME/.config/google-chrome"
   .\host\install.cmd --uninstall --target=HKCU\Software\Google\Chrome\NativeMessagingHosts
   ```

3. Optionally delete the project folder. This also removes the generated
   `host/run-host.sh` or `host/run-host.cmd` wrapper.

## Platform notes

- **Linux:** The installer covers Chrome, Chromium, Brave, Edge, Vivaldi,
  Opera, and common Flatpak/Snap paths.
- **macOS:** The usual folders under `~/Library/Application Support` are
  detected.
- **Windows:** The installer registers the native messaging manifest in each
  browser's `HKCU\...\NativeMessagingHosts\app.chromepresence.host` key for
  Chrome, Chromium, Brave, Edge, Vivaldi, Opera, Opera GX, and Arc. It uses a
  `host\run-host.cmd` wrapper because Chrome starts non-executable hosts through
  `cmd.exe`; `cmd.exe` must be available. `npm run doctor` lists every registry
  entry it finds.
- **Flatpak/Snap:** Native messaging and access to the Discord socket may be
  restricted by the sandbox. `npm run doctor` shows whether the manifest and
  socket are found.

## Project layout

```text
manifest.json              Manifest V3, fixed extension key
src/
  background.js            Tab, focus, idle, and host logic
  shared/                  Settings, domains, activity builder, storage
  options/                 Setup and settings page
  popup/                   Quick access and status
  ui/theme.css             Shared light/dark design
host/
  host.cjs                 Native messaging bridge
  lib/discord-rpc.cjs      Discord IPC client, socket discovery, reconnect
  lib/native-messaging.cjs Length-prefixed native messages
  lib/registry.mjs         Windows registry helper
  lib/targets.mjs          Browser paths, registry keys, extension ID
  lib/wrapper.mjs          Wrapper generation for .sh and .cmd
  install.mjs              Installer/uninstaller
  install.sh               Launcher for Linux and macOS
  install.cmd              Launcher for Windows
  doctor.mjs               Diagnostics
  doctor.cmd               Diagnostics launcher for Windows
  run-host.sh              Wrapper generated on Linux and macOS
  run-host.cmd             Wrapper generated on Windows
tests/                     Node test runner, including a fake Discord
assets/                    Discord asset for optional upload
icons/                     Extension icons
```

## License and trademarks

Chrome Presence is released under the [MIT License](LICENSE).

Chrome and Discord are trademarks of their respective owners. This project is
not affiliated with Google or Discord.

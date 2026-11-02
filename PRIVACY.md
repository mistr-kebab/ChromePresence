# Privacy

Last updated: October 31, 2026 · Version 1.0.0

Chrome Presence is a local browser extension with a local Node.js host. There
is no developer server, no user account, no telemetry, and no analytics. The
extension does not send data to the developer.

## Summary

- The extension reads the active tab, window focus, and idle state.
- It builds a Discord activity locally.
- That activity is sent through Chrome Native Messaging to the host on the
  same computer, and from there to the Discord desktop app over a local IPC
  socket.
- Settings are stored in Chrome storage. The latest runtime state is stored in
  `chrome.storage.session` for the current browser session.
- By default, the website icon shown in the tab is used as the Discord image.
  Discord loads it through Google, which discloses the visited domain to
  Google. You can turn this off at any time.
- No content scripts run and no page content is read.

## Data processed

### 1. Active browser activity

With the `tabs` permission, the extension reads the active tab's:

- title
- URL (domain and path)
- tab and window IDs
- incognito flag
- time of the page change
- whether Chrome is focused
- idle state (active, idle, locked) via `idle`

This information is processed only on your device. The host does **not**
receive the raw URL or raw tab title; it receives the finished activity, which
contains only the lines that would be visible in Discord.

### 2. Settings

Settings are stored under the key `settings` in `chrome.storage.sync`:

- enabled/disabled state
- Discord Application ID
- activity type and displayed lines
- elapsed-time, website-icon, and image options
- focus, idle, and incognito behavior
- excluded domains

If Chrome Sync is enabled, Chrome may synchronize these settings with your
Google account. That is outside this extension's control and subject to
Google's privacy terms. You can disable synchronization in Chrome's settings.

The Application ID is public and is not used for authentication.

### 3. Runtime state

To restore state after a service worker restart, the extension stores the
following under `runtime` in `chrome.storage.session`:

- tab ID
- last URL
- window ID
- page start time
- focus and idle state

`chrome.storage.session` is accessible only to the extension and is cleared
when the browser closes or the extension is reloaded. It is not a persistent
history.

### 4. Discord activity

Over the local Discord IPC socket, the host sends only the finished activity to
the Discord desktop app, for example:

- activity type
- visible first and second lines
- optional start time
- optional asset keys and tooltips
- optional external website-icon URL

Discord processes and stores this data according to its own rules. It may be
visible to friends if your Discord status allows it. The extension cannot
control what Discord does with the activity or how long Discord retains it.
See the [Discord Privacy Policy](https://discord.com/privacy).

## What is not processed

- No page content, form input, passwords, or cookies.
- No content scripts and no DOM access to websites.
- No browsing-history database and no persistent history.
- No Discord bot tokens, OAuth tokens, or Discord credentials.
- No analytics, advertising, or crash telemetry.
- No transfer to a developer server.
- No automatic network requests by the extension. The website-icon feature
  only gives Discord a URL that Discord itself fetches (see below).

## Native messaging and the host

The extension communicates with the local host through Chrome's
`nativeMessaging` API. The host is a Node.js process on your computer. It keeps
the latest activity only in memory and does not write it to a file. When the
host exits or the connection closes, the activity is not persisted.

Chrome only allows access to the host from the extension ID listed in the
`allowed_origins` field of the native messaging manifest. If you change the
extension ID or install the host for a different profile, run the installer
again.

The host connects only to the local Discord IPC socket. It does not connect to
Discord servers on the internet and does not require Discord credentials.

## Website icon (favicon)

By default, **Use website icon** is enabled. Discord displays the site's tab
icon as the large image. The extension builds a URL following this pattern:

```text
https://www.google.com/s2/favicons?domain=<domain>&sz=128
```

and passes it to Discord as `large_image`. Discord then fetches the image from
Google. This sends the visited domain to Google. The extension itself does not
fetch the URL.

You can use your own HTTPS URL template containing `{domain}` instead of
Google. The privacy policy of that provider then applies. If you don't want
domains sent to a third party, turn off **Use website icon** in the extension
settings.

## Recipients and international transfers

The only recipients are:

1. the local host on your computer,
2. the Discord desktop app (and, through it, Discord's servers),
3. with the website-icon feature enabled: Google or the image provider you
   configured.

Discord and Google may process data outside your country or outside the
EU/EEA. Those providers are not acting on behalf of the developer of this
extension; their own privacy policies apply.

## Retention and deletion

| Data | Location | Retention |
| --- | --- | --- |
| Settings | `chrome.storage.sync` | until changed, uninstalled, or browser data is cleared |
| Runtime state | `chrome.storage.session` | until the browser session ends or the extension is reloaded |
| Latest activity | Host process memory | until the host exits |
| Discord activity | Discord | according to Discord's policies |

To delete data:

1. Remove the extension at `chrome://extensions`. This clears the extension's
   storage areas.
2. Remove the host manifests with `./host/install.sh --uninstall` on Linux or
   macOS, or `.\host\install.cmd --uninstall` on Windows.
3. Optionally delete the project folder.
4. If Chrome Sync is enabled, it may take a moment for the settings to be
   removed from the synced copy. You can also manage sync data in your Google
   account.

Uninstalling the extension does not automatically remove an activity already
sent to Discord. It usually disappears when the connection closes; final
display and deletion are controlled by Discord.

## Your controls

You can always:

- pause presence with the switch in the popup or settings,
- exclude individual domains and their subdomains,
- limit the display to the domain,
- disable elapsed time and images,
- hide incognito tabs,
- hide presence when Chrome is unfocused or idle,
- delete the Application ID and stop the Discord connection,
- turn off the website-icon feature.

When a domain is excluded, the extension does not build an activity for that
page and sends no presence. The extension can still read the tab so it can
check the exclusion; that information does not leave the browser process.

## Security

- The host runs with your user permissions and requires Node.js.
- The native messaging manifest restricts the host to the fixed extension ID.
- The host processes only messages from the extension and does not write
  activity data to disk.
- No dynamic scripts are loaded from the network.
- The extension has no host permissions for websites.

As with any locally installed software, only install this project from a
source you trust and review changes to `host/` and `src/` before running them.
The host is a normal Node.js program without a sandbox.

## Debug logging

If you start the host with `CHROME_PRESENCE_DEBUG=1`, it writes diagnostic
messages to stderr, such as the Discord connection status and the visible first
activity line. The extension does not store this output. Start the host without
that variable if you don't want diagnostic output. The installer does not set
the variable.

## Changes

This policy describes version 1.0.0. It will be updated in the project if the
data processing changes.

## Contact

This project is run locally and has no developer server. For questions, bug
reports, or privacy concerns, use the channel through which you received the
project (for example, its repository or direct contact).

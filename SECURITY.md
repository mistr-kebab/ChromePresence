# Security policy

## Supported versions

Security fixes are provided for the latest 1.x release.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private vulnerability reporting:

1. Open the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue and, if possible, include reproduction steps and the
   affected files.

You can expect an initial response on a best-effort basis. This is a local
hobby project without a bug bounty program.

## Scope

In scope:

- the Chrome extension in `src/`
- the native messaging host in `host/`
- the installer and wrapper generation
- security-relevant documentation in `README.md` and `PRIVACY.md`

Generally out of scope:

- vulnerabilities in Chrome, Discord, Node.js, or the operating system
- attacks that already require code execution as the same local user
- social engineering and denial-of-service against your own machine
- missing hardening that does not cross a trust boundary

## Security model

The extension sends only the finished Discord activity to a local Node.js
host. The host connects to the Discord desktop client over its local IPC
socket. There is no developer server and no telemetry. The native messaging
manifest restricts host access to the extension ID listed in
`allowed_origins`.

Please read [PRIVACY.md](PRIVACY.md) for the data flow and available privacy
controls.

## Safe installation

Only install the host from a source you trust. The host runs with your user
permissions and is not sandboxed. Review changes to `src/` and `host/` before
running them. Run `npm test` and `npm run doctor` after updating.

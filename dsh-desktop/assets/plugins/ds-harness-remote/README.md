<p align="center">

  <img src="docs/logo.svg" alt="DeepSeek Harness Remote" width="600">
</p>

<p align="center">
  <strong>English</strong>
  &nbsp;·&nbsp;
  <a href="README.zh.md">中文</a>
  &nbsp;·&nbsp;
  <a href="docs/README.md">Documentation</a>
  &nbsp;·&nbsp;
  <a href="https://dsh.r2049.cn/app">Web</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/ds-harness-remote/releases/latest">Android</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/ds-harness-remote/issues/20">iOS</a>
</p>

<p align="center">
  <a href="apps/server/README.md">Self-hosting</a>
  &nbsp;·&nbsp;
  <a href="https://www.npmjs.com/package/ds-harness-remote">npm</a>
  &nbsp;·&nbsp;
  <a href="https://dshfind.com/zh/plugins/liguobao/ds-harness-remote?ref=badge"><img src="https://dshfind.com/api/badge/liguobao/ds-harness-remote?metric=downloads&amp;lang=zh" alt="dshfind downloads" width="137" height="20" align="absmiddle"></a>
</p>

## Connect once. Ready whenever you are.

Continue using your DeepSeek Harness instance from a phone, computer, or browser. Return to the same Harness session from whichever device is with you.

Harness keeps running on your work computer, with the same workspaces, tools, and project setup.

DS Harness Remote is simply another window into that environment.

The DeepSeek Harness desktop edition is supported. Install the latest release:

`ds-harness-remote@0.5.2`

## Features

- Access your local Harness instance remotely from the web, a PC, or a mobile device: DSH first, with Codex, Cursor, and Antigravity support too.
- Use the native DeepSeek Harness interface without a separate desktop conversation UI.
- Create workspaces, configure models, and switch conversation models with the same smooth workflow as local use.
- Support DeepSeek Harness Desktop, ready to use after installation.
- Run a terminal-only [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) profile as a Host.
- No public listening port or public IP is required on the Harness Host. Connect from anywhere with internet access over a bidirectional end-to-end encrypted channel.
- Prefer P2P connections, use TURN relay nodes worldwide, and fall back to Server Relay when needed.
- Access workspace files, read-only previews, remote terminals, and authorized local development-service previews through the native Harness sidebar.

## Install

### DeepSeek Harness Desktop support

Open **Extensions / Plugin management** in DeepSeek Harness Desktop, choose installation
from npm, and enter this package:

`ds-harness-remote@0.5.2`

Restart Desktop afterward. Its official `dsh` launcher can also install the pinned package
with `dsh plugin --profile desktop add -w ds-harness-remote@0.5.2`.

### dsh-TUI Host

For terminal Host setup with [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI), see the
[dsh-TUI Remote guide](docs/dsh-tui.md).

### Command-line installation

Add the exact package version through DSH's plugin manager for the `web` profile:

```sh
dsh plugin --profile web add -w ds-harness-remote@0.5.2
```

Restart DeepSeek Harness after installation.

For CLI installation, use `dsh plugin` to install the npm package into the selected profile
and add its bundle configuration layer.

### Plugin installation scripts

The scripts use your existing Harness command to install or update only Remote.
Run as your normal user. They preserve your DSH installation and do not create a service.

macOS / Linux:

```sh
curl -fsSL https://dsh.r2049.cn/app/install.sh | bash
```

### Android client

Download the latest APK from [GitHub Releases](https://github.com/liguobao/ds-harness-remote/releases/latest), sign in to the same account, and select a Host and workspace to continue your conversation.

### iOS client

- [Join the beta](https://github.com/liguobao/ds-harness-remote/issues/20)

## Quick start

1. Open **Remote** from the Harness sidebar.
2. Sign in with a GitHub or Zhihu QR code, or use your account and password.
3. The Host starts with control of the current computer enabled. Remote terminal access is also enabled by default; you can turn it off in the detailed Remote settings.
4. On another device, open the DeepSeek Harness desktop edition, Remote Web, or the Android client and sign in to the same account.
5. Select the online Host, then choose an existing workspace or browse remote directories to open one.

By default, Remote uses this project's hosted Server at [https://dsh.r2049.cn](https://dsh.r2049.cn).

For self-hosting, use the repository's [minimal Server](apps/server/README.md); its Web page shows device status only.

## Screenshots

### Desktop

The current computer starts with **Allow control of this device** enabled and is available as a Host. Remote terminal access is also enabled by default and can be turned off in the Host's detailed Remote settings.

On another computer, select an online Host and open one of its workspaces.

<p align="center">
  <img src="docs/images/host-list.png" alt="Remote workspace picker listing online Hosts" width="900">
</p>

The workspace opens in the native Harness interface, with the active Host and encrypted
connection status shown in the header.

<p align="center">
  <img src="docs/images/remote.png" alt="A Harness conversation running through an encrypted remote connection" width="900">
</p>

### Android

Use text or image prompts, switch models, and access supported workspace files and terminals. See the [Android guide](apps/android/README.md) for details.

<p align="center">
  <img src="docs/images/mobile-list.jpg" alt="Android client listing online and offline computers" width="30%">
  <img src="docs/images/image-msg.jpg" alt="Sending an image prompt from the Android client" width="30%">
  <img src="docs/images/image-result.jpg" alt="Viewing the image response in the Android client" width="30%">
</p>

## How it works

```text
DSH Desktop / Remote Web / Android
  ↔ authenticated, end-to-end encrypted channel
Remote Plugin on the Host
  ↔ supported Harness or optional Codex workspace support
Harness sessions/workspaces or Codex projects
```

The Harness Host does not need a public listening port. You can connect from anywhere with internet access.

Remote communicates over a bidirectional end-to-end encrypted channel and switches the client to the selected Host's native Harness API.

The original workspace, tools, and permission flow remain on that computer.

Every settings namespace currently registered by the Host can also be configured remotely through the official Harness settings API.

Credential values remain write-only, and Host-local document/open actions are never exposed.

## Experimental ACP workspaces

The Host runs local AI backends and forwards prompts, streamed replies and approvals through the encrypted Remote channel.

Desktop and Android project their workspaces and sessions into the existing interface in memory, without writing them to Harness storage.

Supported backends:

- **Cursor** — connected through the CLI's ACP interface.
- **Antigravity (AGY)** — its stream-json CLI is adapted to the ACP gateway.
- **Codex** — connected through its independent App Server interface, with the same workspace entry.

Setup and adapter development: [Agent workspace integration guide](docs/acp-integration.md).

## End-to-end encryption

Harness business traffic is encrypted on the Client and decrypted only by the selected Host using
the fixed `Noise_IK_25519_ChaChaPoly_SHA256` suite. Account membership and locally pinned device
identity keys must both authorize a connection. The service can route connections and observe
network metadata, but it cannot read session messages, prompts, tool output, workspace paths, or
remote file contents. See [End-to-end encryption](docs/end-to-end-encryption.md) for the handshake,
key lifecycle, visible metadata, replay protection, and security limits.

## Network and transport

The Host opens outbound connections only; it does not listen on a public port or require router
port forwarding. Remote negotiates `LAN -> P2P -> TURN -> Relay`, falling back to the encrypted
WebSocket Relay when WebRTC is unavailable or cannot connect. Every path carries the same Noise
ciphertext and keeps the same Host/Client identity boundary. See [Network and transport](docs/network.md)
for the topology, control and data planes, NAT behavior, fallback, reconnect semantics, and current
validation status.

## Security

- Session traffic is end-to-end encrypted. The service relays ciphertext without storing session plaintext or device private keys.
- Server membership and the Host's locally pinned peer identity must both authorize a connection.
- Interactive terminals use the Host-local `terminal.enabled` switch (on by default). They run as the Host user, independently of Agent approvals. General tool RPC and remote desktop remain unavailable.
- The workspace picker lists folders only and returns bounded, read-only directory metadata.
- Remote file preview cannot write, delete, upload, execute, or open a path in an external application.
- Codex Remote / Agent ACP is optional, can be disabled, and follows the same encrypted Host permission boundary as the rest of Remote.
- Removing a device revokes its credentials, membership, and active Remote connections.

## Documentation

- [Plugin guide](packages/plugin/README.md)
- [dsh-TUI Remote guide](docs/dsh-tui.md)
- [Codex Remote technical notes](docs/codex-remote.md)
- [ACP Remote / Agent adapter notes](docs/acp-remote.md)
- [Documentation index](docs/README.md)
- [End-to-end encryption](docs/end-to-end-encryption.md)
- [Network and transport](docs/network.md)
- [Remote Protocol](docs/protocol.md)
- [Development status and roadmap](docs/TODO.md)
- [Changelog](docs/CHANGELOG.md)
- [Privacy policy](docs/PRIVACY.md)
- Remote compatibility details are maintained in [the compatibility guide](docs/compatibility.md).

## Links

- Friendly link: [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) — Remote integration is available; see the [dsh-TUI Remote guide](docs/dsh-tui.md).
- Friendly link: [LINUX DO](https://linux.do/)
- Friendly link: [Cyber Liu Kanshan](https://kanshan.r2049.cn/)

## Star History

<a href="https://www.star-history.com/?repos=liguobao%2Fds-harness-remote&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=liguobao/ds-harness-remote&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=liguobao/ds-harness-remote&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=liguobao/ds-harness-remote&type=date&legend=top-left" />
 </picture>
</a>

## Project status and trademarks

This is an independent community project and is not an official DeepSeek product.
DeepSeek and related names and marks belong to their respective owners.

## License

[MIT](packages/plugin/LICENSE)

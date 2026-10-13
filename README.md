# MrHaydenn's Minecraft Launcher (MML)

The account server is a separate **Haydenn Accounts** project deployed on your Windows server.
MML signs into accounts.mrhaydenn.us with an existing Haydenn Accounts username and password.
Minecraft accounts are connected separately through Microsoft.

A Windows-first Minecraft modpack workspace. **Working title · 0.6.0 instance and game-launch preview.**

An original charcoal, olive, and amber interface with a familiar launcher structure: discovery, your library, and profile creation.

## What works

- Live Modrinth API v2 discovery for modpacks, mods, resource packs, and shaders.
- Debounced search, loader and Minecraft version filters, sorting, and pagination.
- Project details, recent releases, and links to the original Modrinth project.
- Install mods, resource packs and shaders into chosen instances, with compatible version selection, explicit warnings and required dependencies.
- Install `.mrpack` packs into separate instances with verified downloads and client overrides.
- Review installed content and reverse dependencies.
- Multiple Minecraft accounts through Microsoft device-code sign-in and encrypted credentials.
- Default Vanilla instance automatically tracks the latest release.
- Persistent local library, explicit loading/error/empty states, and native window controls.
- Windows x64 installer and CI build configuration.

**MML can now install and launch Minecraft on Windows x64.** First play installs the matching Mojang Java runtime, game files, libraries, assets and loader. A verified Minecraft Java account is required. Pack export remains future work. Browsing public Modrinth content does not require an API key.

## Develop on Windows

Install Node.js 24+ and pnpm 11, then:

```powershell
pnpm install
pnpm start
```

Other commands:

```powershell
pnpm test       # Backend validation, concurrency, storage integrity, API error handling
pnpm test:live  # Real Modrinth search, details, releases, and game versions
pnpm preview    # UI preview at http://127.0.0.1:4173
pnpm pack       # Unpacked Windows application in release/win-unpacked
pnpm dist       # Windows x64 NSIS installer in release/
```

The installer is unsigned during development. No signing certificate is configured. Updates are available in Settings after installation. The browser preview uses a separate `.preview-data` library. Account sign-in is available in the desktop application.


## Structure

- `src/`: dependency-free renderer, styles, and original CSS block landscape.
- `electron/main.cjs`: Windows shell and narrowly scoped IPC endpoints.
- `electron/preload.cjs`: isolated renderer bridge.
- `electron/modrinth.cjs`: API client, validated facets, identifiable user agent, request timeout, rate-limit errors.
- `electron/library.cjs`: serialized, atomic local profile writes. Unreadable data is preserved.
- `tests/`: Node built-in test runner. No credentials or live API needed for unit tests.

Desktop profiles are stored under Electron's Windows user data directory, normally `%APPDATA%/mml/library/profiles.json`. Use **Settings & about → Open profile storage** for the actual location. Removing an instance from the library removes its profile metadata.

## Next milestones

1. Refine discovery, library layouts, typography, and profile editing with user feedback.
2. Install `.mrpack` files with validated paths, hashes, and download progress.
3. Microsoft authentication, Minecraft ownership verification, Java/loader management, and game launch.
4. Pack composition, compatibility checks, updates, and `.mrpack` export.

## References

- [Modrinth API overview](https://docs.modrinth.com/api/)
- [Search API and facets](https://docs.modrinth.com/api/operations/searchprojects/)
- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security/)

MML is independent of Modrinth, Mojang, and Microsoft. Project names, icons, and screenshots loaded from Modrinth belong to their respective creators. No Modrinth app source code or branding assets are included.

## Install and update

Download the EXE from the latest Stable GitHub release, run it, and start MML from its desktop shortcut or Start menu entry. The installed application checks for updates on startup. Open the bottom-left Settings gear to check again, download an update with progress, and restart to install. Downloads are checked against the published SHA-512 checksum. Local profiles and encrypted account sessions remain in your Windows app data directory.

**Stable** is selected by default and reads only GitHub’s latest published stable release. **Experimental** is opt-in and reads the latest successfully built push to `main`; failed or unfinished builds are never offered. Returning to Stable can replace a newer experimental build with the latest stable release. Normal pushes publish only the experimental prerelease; changing `release-request.json` to match the package version explicitly requests a stable release.

`pnpm test:updates` exercises the actual updater against both published feeds and verifies installer downloads without installing them. Source-development and browser-preview runs do not install updates.
## Minecraft accounts and content

Open Accounts from the bottom-left Minecraft button. Enter MML's approved public Microsoft client ID in the registration section, or set `MML_MICROSOFT_CLIENT_ID`. Packaged distributions can set `microsoftClientId` in package.json. Never enter a client secret. Sign-in checks Xbox authentication and Minecraft Java ownership and encrypts refresh tokens using Electron safeStorage. Live sign-in requires approved Minecraft/Xbox access.

Popular discovery uses total downloads because Modrinth does not expose weekly rankings. Mods, resource packs and shaders use list rows; modpacks keep large cards. Downloads are hash-verified and staged before replacing instances. Unsupported and optional client pack files are skipped. Unsupported download hosts fail with an explanation.

`pnpm test:install` verifies a real mod with dependencies and a full pack in disposable storage.

## Playing and managing instances

Click a square instance tile to open its Content, Settings and Logs page. Play installs game components on first use; later launches reuse verified cached files. Vanilla, Fabric, Quilt, Forge and NeoForge installations use the instance's Minecraft version and pinned loader version when present. Settings allow changing maximum memory, sharing options.txt and servers.dat across opted-in instances, and disabling update tracking for the original modpack. Shared settings are pulled before play and saved when the game exits; mods and worlds remain separate. Stop the game before modifying its content. Keep MML open while playing to retain launch status, logs and settings synchronization.

Mod toggles rename tracked JAR files with a .disabled suffix and retain dependency metadata. Minecraft's active skin face appears next to the player in the sidebar. Microsoft device codes are copied to the clipboard before the browser opens.

The pinned XMCL dependencies include two narrow published-package fixes under patches/: the unzip entry point and the installer's missing private utility import. pnpm applies these through pnpm-workspace.yaml on every clean install.

Add content from an instance opens Mods, Resource packs and Shaders scoped to that instance. Compatible installs go straight into it. Linked pack content is grouped above additional content and cannot be toggled independently. Sync now and Play match it to the latest release for the same Minecraft version and loader. Additional content and edited configuration files are preserved; conflicting additional dependencies stop the update. Unlink in instance Settings to manage pack mods yourself. MMSM integration is removed for now; Haydenn Accounts sign-in remains.

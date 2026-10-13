# MrHaydenn's Minecraft Launcher (MML)

The account server is a separate **Haydenn Accounts** project deployed on your Windows server.
MML signs into accounts.mrhaydenn.us with an existing Haydenn Accounts username and password.
Minecraft accounts are connected separately through Microsoft.

A Windows-first Minecraft modpack workspace. **Working title · 0.8.0 instance and game-launch preview.**

An original charcoal and grey interface with bright green highlights with a familiar launcher structure: discovery, your library, and profile creation.

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

Download the EXE from the latest Stable GitHub release, run it, and start MML from its desktop shortcut or Start menu entry. The installed application checks for and downloads updates on startup. Open the bottom-left Settings gear to check again, view download progress and restart to install. Downloads are checked against the published SHA-512 checksum. Local profiles and encrypted account sessions remain in your Windows app data directory.

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

Add content from an instance opens Mods, Resource packs and Shaders scoped to that instance. Linked pack content is grouped above additional content. It is checked on opening an instance and every five minutes while viewing it, with cached checks to limit API requests. Updates are offered explicitly, including newer Minecraft/loader versions; switching versions asks for confirmation when additional content is installed or game components change. Additional content files remain unchanged. Conflicting dependencies or file overlaps stop the update. Play verifies the installed pack rather than automatically upgrading it.

Pack mods can be disabled while linked. An unchanged mod version retains its enabled state; replacement versions may be enabled again. Mods included as bundled JARs are also tracked. Compatible release updates for additional mods, resource packs and shaders have their own update buttons. Mod compatibility still needs verification after a pack changes Minecraft or its loader.

Library opens on startup, including without Haydenn Accounts sign-in. Archive keeps an instance and its files under Archived at the bottom; Restore brings it back. Tiles use a consistent 240-pixel square. Instance Settings supports a local custom image and resetting to the pack/default icon.

## Skins and capes

Skin editor below Library saves a separate local PNG library for each connected Minecraft UUID. Upload 64 × 64 or legacy 64 × 32 skins, select classic/slim arms, or create a new skin. The simple texture editor supports pencil, eraser, eyedropper, pixel grid, undo and redo. A bundled skinview3d viewer provides a rotating, draggable 3D preview with zoom and owned-cape preview. Skins are not synchronized through Haydenn Accounts.

Apply sends the saved PNG to Minecraft Services using the selected account’s internal session. It changes the actual Minecraft Java skin, not just the launcher preview. Owned capes are retrieved from the authenticated profile and can be selected or hidden. The launcher never accepts arbitrary cape uploads. Rejoining a server or restarting Minecraft may be needed to see the change. Skin and cape mutations require a valid Minecraft session and can be rejected or rate-limited by Minecraft.

## Seamless Windows updates

Updates download and verify in the background for the selected channel. Restart to update appears in the title bar when ready and uses silent installation, then reopens MML. Closing MML also installs a downloaded update for the next launch. New installations are per-user and do not offer all-users or elevated installation. A legacy all-users installation or Windows security policy can still require approval during migration; first installation remains unsigned. MML 0.6 and older use their existing interactive update flow once to obtain this version.

## Skin selector and compact workspace

MML 0.8 uses a 76-pixel icon rail with accessible names, hover labels and shortcuts for active library instances. Archived instances stay in Library and do not take up the rail. The Minecraft account and Haydenn account controls remain separate at the bottom; the Settings icon tooltip includes the app version. Discover starts directly with content tabs and search, retaining a compact target label when adding content to an instance.

The skin selector shows a large draggable player preview and a full-body saved-skin grid. Add skin supports file selection or drag and drop. Full-body thumbnails share a single temporary WebGL renderer and are cached, so a large library does not require a graphics context for every tile. Edit opens a modal with texture replacement, wide/slim arms and thumbnail choices for owned capes. The pixel editor is expandable inside the modal. Cancelling discards the draft; Save skin stores it locally. A saved cape preference is applied together with the skin when Apply to Minecraft is clicked, and unavailable cape selections are rejected before changing the skin. An applied marker is shown when the saved appearance matches the current Minecraft profile.

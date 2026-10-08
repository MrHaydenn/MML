# MrHaydenn's Minecraft Launcher (MML)

A Windows-first Minecraft modpack workspace. **Working title · 0.1.1 UI preview.**

An original charcoal, olive, and amber interface with a familiar launcher structure: discovery, your library, and profile creation.

## What works

- Live Modrinth API v2 discovery for modpacks, mods, resource packs, and shaders.
- Debounced search, loader and Minecraft version filters, sorting, and pagination.
- Project details, recent releases, and links to the original Modrinth project.
- Create and remove local planning profiles, including profiles inspired by a Modrinth pack.
- Persistent local library, explicit loading/error/empty states, and native window controls.
- Windows x64 installer and CI build configuration.
- **Host Server** sidebar tab opens [MMSM](https://mmsm.mrhaydenn.us/) inside the Windows launcher, with reload and an external-browser fallback.

**This milestone does not install modpacks or launch Minecraft.** Profiles are planning records, not installed instances. Microsoft authentication, Java management, loader installation, `.mrpack` import/export, content downloads and game launch are future milestones. Browsing public Modrinth content does not require an API key.

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
pnpm test:hosting # Real Electron MMSM view, isolation, and tab visibility
pnpm preview    # UI preview at http://127.0.0.1:4173
pnpm pack       # Unpacked Windows application in release/win-unpacked
pnpm dist       # Windows x64 NSIS installer in release/
```

The installer is unsigned during development. No certificate or automatic update service is configured. The browser preview uses a separate `.preview-data` library. Its Host Server tab opens MMSM in a browser tab; the desktop app embeds it.

MMSM uses an isolated Electron `WebContentsView` with its own persistent browser session. The page has no launcher preload bridge or Node access. The launcher loads only the MMSM origin in the embedded view; other HTTP(S) links open in the system browser. Loading failures provide retry and browser fallback controls. Site response headers remain intact, including its iframe restrictions.

## Structure

- `src/`: dependency-free renderer, styles, and original CSS block landscape.
- `electron/main.cjs`: Windows shell and narrowly scoped IPC endpoints.
- `electron/preload.cjs`: isolated renderer bridge.
- `electron/modrinth.cjs`: API client, validated facets, identifiable user agent, request timeout, rate-limit errors.
- `electron/library.cjs`: serialized, atomic local profile writes. Unreadable data is preserved.
- `tests/`: Node built-in test runner. No credentials or live API needed for unit tests.

Desktop profiles are stored under Electron's Windows user data directory, normally `%APPDATA%/mml/library/profiles.json`. Use **Settings & about → Open profile storage** for the actual location. Removing a planning profile only removes its metadata; MML does not manage game files yet.

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

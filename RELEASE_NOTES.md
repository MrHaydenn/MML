# MML 0.5.0

MML can now launch Minecraft on Windows. Play automatically installs the matching Mojang Java runtime, game files, libraries, assets and instance loader, then launches using the selected verified Minecraft account. Vanilla, Fabric, Forge, NeoForge and Quilt are supported.

- Square library tiles with the instance image in the top-left and Play/Stop controls.
- A dedicated instance page with content search and filters, mod toggles, account selection, settings and launch logs.
- Per-instance name and memory settings, shared game options and saved servers, and an option to detach from original modpack update notifications.
- Minecraft skin faces beside the prominent sidebar account; a grass block when signed out, with a smaller Haydenn Accounts entry.
- Microsoft sign-in codes are copied before the browser opens.

Validation: 41 automated tests passed. Real authenticated Fabric Minecraft launches reached rendering/audio initialization on both Minecraft 1.21.1 / Java 21 and Minecraft 26.3 / Java 25. Real Forge, NeoForge and Quilt first-play preparations passed. The real Electron UI confirmed square tiles and rendered the instance page.

Download and run MML-Setup-0.5.0.exe. First play downloads game components and can take several minutes. Keep MML open while playing for launch logs and settings synchronization; shared options are saved when the game exits. Existing instances and accounts are retained. The development installer is unsigned.

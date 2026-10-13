# MML 0.4.1

MML now includes its approved Microsoft application ID for Minecraft sign-in, so users no longer need to enter it manually. The account screen shows progress through Microsoft authorization, Xbox authentication, Minecraft sign-in, Java ownership and player-profile lookup. Errors identify the failing service and HTTP status without exposing credentials.

Validation: the real sign-in flow completed successfully with HTTP 200 from Microsoft, Xbox, Minecraft login, Java ownership and player profile; Windows-encrypted account persistence passed. The diagnostic used disposable storage and removed its temporary account afterward. Automated tests cover sign-in, cancellation and safe error handling.

Download and run MML-Setup-0.4.1.exe, then retry Sign in with Microsoft from Minecraft Accounts. Existing accounts and instances are preserved. The development installer is unsigned. Java setup and game launching remain future work.

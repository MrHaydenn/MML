# MML 0.9.1

Gallery images now expand into a large, aspect-preserving viewer instead of staying at thumbnail size. Navigate project galleries and instance screenshots with left/right buttons or keyboard arrows.

- Centered the Minecraft sidebar face and added a yellow warning when the active session is expired or needs sign-in.
- Play checks Minecraft authentication first, refreshes valid sessions automatically, and opens Microsoft sign-in if an account is missing or its refresh credentials were rejected. The selected instance resumes after successful sign-in; cancellation does not launch it. Temporary service failures preserve the account and show an error.
- Softened the Windows font style and enlarged small labels and controls across project, instance and settings pages.
- Replaced text Back arrows with centered SVG icons and reduced the project Back row and header spacing.
- Widened the skin texture editor’s live preview and enabled right-drag panning. Left drag rotates, wheel zooms, and Reset recenters the preview.

Validation: 68 automated tests, live gallery image/navigation checks, avatar centering, native right-mouse preview panning and minimum-window editor checks, Windows EXE packaging and updater-feed verification.

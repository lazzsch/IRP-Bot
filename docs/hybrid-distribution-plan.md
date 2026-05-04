# IRP Bot V3 - Hybrid Distribution Plan

This plan helps ship fast for non-technical users while the Chrome Web Store review is still in progress.

## Goal

Deliver 3 channels in parallel:

1. Chrome Extension (Unlisted on Chrome Web Store).
2. Userscript Lite (Tampermonkey fallback).
3. Simple installation page for non-technical users.

## 30-Minute Execution Plan

### Minute 0-10: Store package (Unlisted)

1. Zip the extension folder (without local temp files).
2. Upload to Chrome Web Store dashboard.
3. Set visibility to `Unlisted`.
4. Fill required metadata and privacy fields.
5. Submit for review.

Output: private install link for later sharing.

### Minute 10-20: Userscript Lite fallback

1. Publish `userscript/IRP-Bot-Lite.user.js` in GitHub.
2. Share raw GitHub URL for one-click Tampermonkey install.
3. Use this route while Store review is pending.

Output: immediate fallback for users who cannot wait.

### Minute 20-30: User-friendly guide

1. Publish `docs/install-guide.html` (GitHub Pages or direct file sharing).
2. Keep steps visual and short.
3. Include troubleshooting and known limitations.

Output: onboarding page for beginners.

## Distribution Strategy

### Primary channel

- Chrome Web Store (Unlisted), share only direct link.

### Fast fallback channel

- Tampermonkey + Userscript Lite.

### Upgrade path

- As soon as the extension is approved, recommend users migrate from Lite to extension.

## Support Script

When a user asks "how do I install?":

1. Send installation page URL.
2. If Store link is approved, share Store first.
3. If pending, share Userscript Lite instructions.
4. Ask user to confirm they are on:
   - `https://portal.irishimmigration.ie/en/reschedule_appointment/`

## Known Tradeoffs

- Userscript Lite is a fallback: fewer guarantees than the full extension.
- Chrome Store path is safer for beginners, but requires review time.
- Host permissions are required for the full extension automation on the IRP domain.


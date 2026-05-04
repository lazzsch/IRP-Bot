# IRP Bot V3

Chrome extension to help monitor and reschedule IRP appointments on the Ireland portal.

## Why this project exists

Trying to find an earlier appointment manually is stressful and exhausting.
You need to keep checking the page for long periods, refresh flows, and react fast when a slot appears.

I went through that pain, built this system to help myself, and decided to share it with anyone facing the same problem.

## What it does

- Runs only on `reschedule_appointment` pages.
- Opens a guided setup wizard on first use.
- Lets you choose language (`en`, `pt`, `es`).
- Lets you define search minimum date (floor).
- Lets you define already booked date (current target date on the portal).
- Searches for earlier dates inside your configured window.
- Can automatically select an available time.
- Can automatically continue on review page.
- Can automatically finish appointment flow.
- Shows a side status panel with current phase.
- Shows search context (month/day/time).
- Shows last console lines.
- Plays a repeated sound alert when a better date is found.

## How it works (high level)

1. You open `https://portal.irishimmigration.ie/.../reschedule_appointment/`.
2. The setup wizard asks for language, minimum date, booked date, and automation options.
3. After start, the bot navigates intro -> location -> date calendar.
4. It scans months and days in your allowed range.
5. From `minimumDate` up to `bookedDate - 1 day`.
6. If it finds a valid earlier date, it selects it.
7. If enabled, it continues with time selection, review, and finish steps.
8. After a successful earlier date, the bot updates the booked date reference and can continue searching for an even earlier slot.

## Install (Developer Mode)

1. Download or clone this repository.
2. Open `chrome://extensions/`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select this project folder: `C:\Users\walmo\Downloads\irp-bot-v3`.

## Quick usage

1. Open the IRP reschedule page.
2. The portal must be in English to run correctly.
3. If you open `reschedule_appointment` in another portal language (example `pt-BR`), the setup wizard will show a warning and provide a button to open `https://portal.irishimmigration.ie/en/appointments/`.
4. From there, continue in the English flow.
5. Complete the initial wizard.
6. Choose whether each automation should run automatically.
7. Click `Yes, Start` to begin.
8. Watch live progress in the side panel.

## Project structure

- `content.js`: main automation runtime and on-page UI logic.
- `content.css`: styles for side panel and setup wizard.
- `popup.html` + `popup.js` + `popup.css`: extension popup dashboard.
- `shared/irp-common.js`: shared date/language helpers.
- `shared/irp-config.js`: defaults and shared config shape.
- `shared/content-i18n.js`: content-script translations.
- `shared/popup-texts.js`: popup translations.
- `manifest.json`: Chrome extension manifest (MV3).

## Notes

- Some console warnings come from the target portal itself or third-party scripts loaded by it.
- This extension does not control server-side availability. It only automates client-side checking and actions.

## Bug reports

If you find any bug, please do not hesitate to report it.

Please include:

- What happened.
- What you expected.
- Current URL/page step.
- Your settings (language, minimum date, booked date, automation toggles).
- Console logs from the side panel.
- Screenshot or screen recording if possible.

This helps reproduce and fix issues much faster.

# OMR Practice

Scan printed MCQ answer keys with your phone camera, take timed OMR-style practice exams, and track your progress. Runs fully in the browser — no server, no sign-up. All data stays on your device.

## Features

- **Answer-key scanner** — finds the answer table in the photo, corrects perspective and tilt, reads every cell, and uses the table layout to fix misread question numbers. Sideways photos are rotated automatically. Unclear answers are highlighted for checking.
- **Precise crop tool** — four draggable corners and edges with a magnifier; auto-detects the table.
- **Exams** — countdown timer with pause, warning vibration, question navigator, mark-for-review, auto-save and resume.
- **Scoring** — negative marking, per-section scores, time spent per question.
- **Review** — mistakes, skipped and flagged filters; retake only the questions you got wrong; share the result as an image.
- **History** — score trend chart and every attempt saved.
- English / বাংলা, light / dark theme, installable, works offline after the first load.

## Project structure

```
index.html        app shell
css/style.css     design system
js/app.js         screens, navigation, exam logic
js/scanner.js     image processing + OCR (Tesseract.js)
js/cropper.js     4-corner crop tool
js/i18n.js        English and Bangla text
js/store.js       localStorage persistence
js/icons.js       SVG icons
sw.js             offline cache
manifest.json     install as app
icons/            app icons
```

## Run locally

Any static file server works, e.g. `python -m http.server 8000`, then open http://localhost:8000.
(Opening `index.html` directly from disk will not work because the app uses JavaScript modules.)

## Deploy on GitHub Pages

1. Upload all files and folders to a public repository (keep the folder structure).
2. Settings → Pages → Source: *Deploy from a branch* → Branch `main`, folder `/ (root)` → Save.
3. Open `https://<username>.github.io/<repo>/` on your phone and choose **Add to Home screen**.

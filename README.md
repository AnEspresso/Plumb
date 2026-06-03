# Plumb

**True to the build.**

A beautiful, local-first Progressive Web App (PWA) built for residential builders and their trade partners to manage construction projects with clarity and speed.

![Plumb Screenshot](https://via.placeholder.com/800x500/1B1916/F2EEE6?text=Plumb+Screenshot)  
*(Replace with actual screenshots once hosted)*

## ✨ Features

### For Builders & Superintendents
- **Daily Log** — Photo-first field entries with automatic date & area tagging
- **Photo Record** — Visual timeline organized by day
- **Open Items** — Flagged issues with status tracking
- **Selections & Upcharges** — Full upgrade/credit ledger with buyer sign-off workflow
- **Build Progress** — Stage tracking, permits, inspections, and subcontractor readiness
- **Multi-site Portfolio** — Overview dashboard with progress and open item metrics
- **Documents** — Centralized permit, contract, and selection references

### For Subcontractors
- Dedicated restricted view showing only their scope of work
- Site readiness notifications
- Ability to post updates and close their own items

### Technical Highlights
- **Fully offline capable** — Works with no internet
- **IndexedDB + localStorage** persistence (photos + metadata)
- **Beautiful, native-feeling UI** with warm architectural design system
- **Role-based access** (Builder vs Subcontractor)
- **Developer workbench** built-in for testing and data inspection
- Single-file PWA — no build step required

## 🚀 Try It Now

1. Download `index.html`
2. Open it in any modern browser (Chrome/Edge/Safari recommended)
3. Tap **"Add to Home Screen"** for the full app experience

**Live Demo** (once deployed):  
`https://yourusername.github.io/plumb`

## Tech Stack

- **HTML5 + CSS3 + Vanilla JavaScript** (no frameworks)
- **IndexedDB** for photo storage
- **localStorage** for project metadata
- **Progressive Web App** (installable, offline-first)
- Responsive design (mobile-first with desktop rail support)

## Project Status

**Phase 0 – Local-First Prototype** (Current)

This is a fully functional standalone prototype with a clean "backend seam" — all write operations go through the `Data.*` layer. It is production-ready for single-user or small-team use.

**Next Phases** (planned):
- Phase 1: Real-time sync with Firebase/Firestore
- Phase 2: Multi-user permissions & notifications
- Phase 3: Email parsing for permit & inspection updates
- Phase 4: Mobile camera optimizations + service worker enhancements

## Copyright

© 2026 Peter Gottschalk. All rights reserved.

Plumb is a personal project and is not affiliated with any company. The name "Plumb" and the visual identity are copyrighted.

## License

This project is licensed under the [MIT License](LICENSE) — you are free to use, modify, and distribute the code for personal, educational, or commercial purposes, **with proper attribution**.

---

**Made with care for the building trade.**

# Postage Calculator for Postcrossing

[![Live Demo](https://img.shields.io/badge/Live_Demo-qamoe.cyou-C62828?style=flat-square&logo=googlechrome&logoColor=white)](https://qamoe.cyou/Postage-Calculator-for-Postcrossing/)
[![Postcrossing](https://img.shields.io/badge/Postcrossing-Postcard_Tool-1976D2?style=flat-square)](https://www.postcrossing.com/)
[![Hongkong Post](https://img.shields.io/badge/Hongkong_Post-2026_Tariffs_(HK%24)-C62828?style=flat-square)](#tariff-summary)
[![China Post](https://img.shields.io/badge/China_Post-Official_Tariffs_(RMB_¥)-00693E?style=flat-square)](#tariff-summary)
[![Material Design 1](https://img.shields.io/badge/Design-Material_Design_1.0-00796B?style=flat-square&logo=materialdesign)](https://m1.material.io/)
[![PWA Offline](https://img.shields.io/badge/PWA-Offline_Ready-FFA000?style=flat-square)](https://qamoe.cyou/Postage-Calculator-for-Postcrossing/)
[![License: MIT](https://img.shields.io/badge/License-MIT-546E7A?style=flat-square)](https://opensource.org/licenses/MIT)

> **Batch Postcard Postage Calculator & Stamp Combinator for Postcrossing Enthusiasts**  
> Calculate multi-destination postcard rates (`Surface Mail`, `SAL`, `Air Mail`, and `Registered Mail`), parse batch Postcrossing IDs (`DE-1234567 US-8901234`), and generate optimal stamp combinations for **Hongkong Post (`HK$`, effective 13 April 2026)** and **China Post (`RMB ¥`)**. Built with zero dependencies in strict adherence to the **Google Material Design 1.0 (2014)** specification.

🔗 **Live Application:** [https://qamoe.cyou/Postage-Calculator-for-Postcrossing/](https://qamoe.cyou/Postage-Calculator-for-Postcrossing/)

---

## Key Features

### 1. Dual Postal Operator Master Switch (`Hongkong Post` & `China Post`)
- **Hongkong Post (`HK$`)**: Complete 2026 tariff dataset effective **13 April 2026**, covering over 240 global destinations mapped to accurate Surface Mail and Air Mail postal zones (`Local`, `Chinese Mainland / Macao / Taiwan`, `Zone 1`, `Zone 2`, and `Zone 3`), including destination-specific service availability (such as Surface Mail or Air Mail suspensions).
- **China Post (`RMB ¥`)**: Official international and regional postcard tariffs covering **Domestic**, **Hong Kong / Macao / Taiwan**, and **International** destinations across **Surface Mail**, **Surface Air Lifted (SAL)**, and **Air Mail**, plus Registered Mail fees.
- **Adaptive Postal Theme**: Switching operators in the default palette automatically transitions between **Pillar Box Crimson** (Hongkong Post `#C62828`) and **China Post Green** (`#00693E`).

### 2. Postcrossing ID Smart Paste & Space-Separated Sync
- Paste or type single or multiple Postcrossing IDs directly into the search bar (e.g., `DE-1234567 US-8901234 TW-112233`).
- Recognized IDs remain in the search input separated by spaces—add new IDs or delete existing IDs in the input box and the destination list updates in real time without duplicate counting.

### 3. Batch Multi-Destination Calculation
- Add multiple destinations at once and adjust quantities (`-` / `+` or direct numeric input).
- Switch shipping method (`Surface Mail`, `SAL`, `Air Mail`) and toggle **Registered Mail** individually per destination or in batch across all rows.
- Automatic fallback and warning badges when a selected service is unavailable for a specific destination.

### 4. Stamp Combinator & Old Stamp Top-Up Helper
- **Hongkong Post (`HK$`)**: Recommends minimal-piece combinations using standard Definitive Stamps (`$1.40`, `$2.20`, `$2.80`, `$3.70`, `$4.00`, `$5.00`, `$5.50`, `$10.00`, etc.) and includes an interactive **Old Stamp Top-Up Calculator** (`$2.00` – `$5.50` legacy stamps vs. 2026 new rates).
- **China Post (`RMB ¥`)**: Provides exact-match (`¥0.00` overpayment) combinations using standard regular stamps (`80 fen`, `1.20 yuan`, `2.00 yuan`, `3.00 yuan`, `4.20 yuan`, `5.00 yuan`) alongside popular `1.20 + 0.80 yuan` commemorative pairs.

### 5. Cross-Operator Rate Comparison Bar
- Real-time total comparison inside the Summary Card between **Hongkong Post (`HK$`)** and **China Post (`RMB ¥`)** for your exact destination list, complete with one-tap operator switching.

### 6. Multi-Step Undo & Persistent State
- **Multi-Step Undo (`up to 30 steps`)**: Undo deletions, clears, or batch changes via the toolbar Undo button, Material Design Snackbar action, or `Ctrl+Z` / `Cmd+Z`.
- **Auto-Save & Shareable Links**: Automatically persists your list in `localStorage` and generates shareable URLs (`?op=hkpost&list=DE:2:air:0,US:1:air:1`) for one-click sharing.

### 7. Practical Postcrossing Mailing Reminders
- **`PAR AVION` / `BY AIR MAIL` Sticker Prompt**: Automatically displayed when sending via Air Mail or SAL.
- **China Post Destination Annotation**: Displays the required Chinese destination name annotation for outbound international postcards from Mainland China.
- **Registered Mail Counter Notice**: Reminds senders about the `R`-series barcode label space and counter posting requirement whenever Registration is enabled.

### 8. Authentic Material Design 1.0 UI & PWA Support
- Authentic **Material Design 1.0** elevation shadows (`2dp`–`24dp`), radial ink ripples, cubic-bezier `(0.4, 0.0, 0.2, 1)` motion choreography, and responsive mobile bottom-sheet dialogs.
- **16 Curated Color Palettes** with **Light / Dark / Follow System** appearance modes.
- **3 Interface Languages**: Traditional Chinese (`繁體中文`), Simplified Chinese (`简体中文`), and English (`English`).
- **Offline PWA Support**: Service Worker caching and dynamic theme-tinted SVG favicon.

---

## Tariff Summary

### Hongkong Post — Postcards (Effective 13 April 2026)

| Zone / Destination | Surface Mail | Air Mail | Registration Fee |
| :--- | :---: | :---: | :---: |
| **Local (Hong Kong)** | `HK$ 2.80` | — | `+ HK$ 15.50` |
| **Chinese Mainland, Macao & Taiwan** | `HK$ 3.50` | `HK$ 4.50` | `+ HK$ 15.50` |
| **Zone 1 (Asia & neighbouring regions)** | `HK$ 4.20` | `HK$ 5.00` | `+ HK$ 15.50` |
| **Zone 2 (Europe, Americas, Australia, etc.)**| `HK$ 5.00` | `HK$ 5.50` | `+ HK$ 15.50` |
| **Zone 3 (Sub-Saharan Africa, Latin America, etc.)** | `HK$ 5.00` | `HK$ 6.00` | `+ HK$ 15.50` |

*Official References:*
- [Hongkong Post — Postage Rates Leaflet (Effective 13 April 2026, PDF)](https://www.hongkongpost.hk/filemanager/common/postage_rate_2026/pos15_s_2604_chi.pdf)
- [Hongkong Post — Postal Guide Appendix: Overseas Zoning Table (PDF)](https://www.hongkongpost.hk/filemanager/common/guide/declare/appendix/appendices_c.pdf)

### China Post — Postcards (Current Official Tariff)

| Zone / Destination | Surface Mail | SAL | Air Mail | Registration Fee |
| :--- | :---: | :---: | :---: | :---: |
| **Domestic (Chinese Mainland)** | `¥ 0.80` | — | — | `+ ¥ 3.00` |
| **Hong Kong, Macao & Taiwan** | `¥ 1.50` | — | `¥ 3.50` | `+ ¥ 16.00` |
| **International (All Overseas Countries)** | `¥ 3.00` | `¥ 4.50` | `¥ 5.00` | `+ ¥ 16.00` |

*Official Reference:*
- [China Post — Official Domestic & International Letter-Post Tariff Schedule](https://www.chinapost.com.cn/html1/folder/181312/8251-1.htm)

---

## Project Structure

```text
.
├── index.html      # App shell, SEO/OpenGraph metadata, dialogs, and Material Design 1 layout
├── styles.css      # Material Design 1 elevation, typography, ripple, dark mode, and mobile rules
├── data.js         # 240+ destinations dataset, tariff tables, stamp denominations, and i18n strings
├── app.js          # Calculator engine, Postcrossing ID parser, stamp combinator, undo stack, and URL state
├── manifest.json   # Progressive Web App (PWA) manifest
├── sw.js           # Offline-first Service Worker
├── package.json    # Project metadata and search keywords
├── robots.txt      # Search engine crawler directives
├── sitemap.xml     # XML sitemap for search indexing
└── README.md       # Documentation
```

---

## Local Usage

No build tools, bundlers, or external dependencies are required.

1. Clone the repository:
   ```bash
   git clone https://github.com/cqhhy2001/Postage-Calculator-for-Postcrossing.git
   ```
2. Open `index.html` directly in any modern browser, or serve locally:
   ```bash
   npx serve .
   ```

---

## Topics & Search Keywords

`postcrossing` · `postage-calculator` · `postcard` · `hongkong-post` · `china-post` · `stamp-calculator` · `stamp-combinator` · `philately` · `postal-rates` · `snail-mail` · `air-mail` · `surface-mail` · `registered-mail` · `material-design` · `pwa`

---

## License

Released under the [MIT License](https://opensource.org/licenses/MIT).

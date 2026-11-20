# Rekod Pemeriksaan Premis

Apps web (PWA) untuk pemeriksaan premis. Snap sijil SSM dan lesen PBT, teks dibaca terus dalam telefon (Tesseract.js, tiada pelayan), status SSM dikira (AKTIF / EXPIRED / EXPIRED (MUST RENEW)), dan laporan dijana dalam PDF atau Excel.

- Rekod disimpan dalam telefon (IndexedDB). Muat turun Excel sebagai salinan.
- Boleh dipasang ke skrin utama dan digunakan tanpa internet selepas dibuka kali pertama.
- `parse.js` mengandungi peraturan membaca medan dari teks OCR.
- Pustaka dalam `vendor/` (lihat `vendor/VERSIONS.txt`): tesseract.js 5.1.1 (Apache-2.0), jsPDF 2.5.1 (MIT), jspdf-autotable 3.8.2 (MIT), SheetJS 0.18.5 (Apache-2.0), data bahasa `eng` (Apache-2.0).

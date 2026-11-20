(() => {
"use strict";
const $ = id => document.getElementById(id);
const P_F = ["p_nama","p_pemilik","p_ssm","p_kp","p_tamat","p_tel","p_alamat","p_lesen","p_lesen_tamat","p_catatan"];
const BULAN = ["Januari","Februari","Mac","April","Mei","Jun","Julai","Ogos","September","Oktober","November","Disember"];
let inspections = [], current = null, premises = [];
let editingPrem = null, photos = { ssm: null, pbt: null }, reading = 0, lastField = null;

// ---------------- IndexedDB ----------------
const DB_NAME = "rekod-pemeriksaan";
let dbp = null;
function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("pemeriksaan", { keyPath: "id" });
      const p = d.createObjectStore("premis", { keyPath: "id" });
      p.createIndex("inspId", "inspId");
      d.createObjectStore("gambar", { keyPath: "id" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await openDb();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    let out; const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const dbAll = store => tx(store, "readonly", s => s.getAll());
const dbPut = (store, v) => tx(store, "readwrite", s => s.put(v));
const dbGet = (store, k) => tx(store, "readonly", s => s.get(k));
const dbDel = (store, k) => tx(store, "readwrite", s => s.delete(k));
const dbByInsp = id => tx("premis", "readonly", s => s.index("inspId").getAll(id));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------------- helpers ----------------
function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 2600); }
function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function fmtDate(s) { if (!s) return "-"; const [y, m, d] = s.split("-"); return d ? `${d}/${m}/${y}` : s; }
function longDate(s) { if (!s) return "-"; const [y, m, d] = s.split("-"); return `${+d} ${BULAN[+m - 1]} ${y}`; }
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function addMonths(s, n) { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10); }
function statusOf(p, ref) {
  if (!p.p_tamat) return "NONE";
  ref = ref || today();
  if (p.p_tamat >= ref) return "AKTIF";
  return addMonths(p.p_tamat, 12) < ref ? "RENEW" : "EXPIRED";
}
const STATUS_TXT = { AKTIF: "AKTIF", EXPIRED: "EXPIRED", RENEW: "EXPIRED (MUST RENEW)", NONE: "TIADA TARIKH" };
const namaCol = p => [p.p_nama, p.p_pemilik].filter(Boolean).join(" / ") || "(tiada nama)";
const noCol = p => [p.p_ssm, p.p_kp].filter(Boolean).join(" / ") || "-";
function busy(btn, on, label) { if (on) { btn._t = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> ' + label; } else { btn.disabled = false; btn.textContent = btn._t; } }

// ---------------- navigation ----------------
function go(v) {
  ["home", "head", "insp", "prem"].forEach(x => $("v-" + x).hidden = x !== v);
  const bar = $("bar-in"); bar.innerHTML = "";
  const add = (txt, cls, fn) => { const b = document.createElement("button"); b.className = "btn " + cls; b.textContent = txt; b.onclick = () => fn(b); bar.appendChild(b); };
  $("bar").hidden = v === "home";
  if (v === "head") add("Simpan & teruskan", "primary", saveHead);
  if (v === "insp") { add("PDF", "", b => exportPdf(b, false)); add("Excel", "", exportXlsx); add("+ Premis", "primary", () => openPrem(null)); }
  if (v === "prem") { add("Simpan", "", b => savePrem(b, false)); add("Simpan & seterusnya", "primary", b => savePrem(b, true)); }
  window.scrollTo({ top: 0 });
}
document.querySelectorAll("[data-go=home]").forEach(b => b.onclick = () => { current = null; loadHome(); go("home"); });

// ---------------- home ----------------
async function loadHome() {
  inspections = (await dbAll("pemeriksaan")).sort((a, b) => (b.tarikh || "").localeCompare(a.tarikh || "") || b.createdAt - a.createdAt);
  const all = await dbAll("premis");
  const cnt = {}; all.forEach(p => cnt[p.inspId] = (cnt[p.inspId] || 0) + 1);
  const list = $("h-list"); list.querySelectorAll(".card").forEach(n => n.remove());
  $("h-empty").hidden = inspections.length > 0;
  inspections.forEach(i => {
    const b = document.createElement("button"); b.className = "card";
    b.innerHTML = `<div class="top"><span class="name">${esc(i.kawasan || "(tiada kawasan)")}</span><span class="meta">${cnt[i.id] || 0} premis</span></div>
      <div class="meta">${esc(longDate(i.tarikh))} · ${esc(i.pegawai || "-")}</div>`;
    b.onclick = () => openInsp(i.id);
    list.appendChild(b);
  });
}
$("h-new").onclick = () => openHead(null);

// ---------------- head ----------------
function pembRow(v = "") {
  const r = document.createElement("div"); r.className = "r";
  r.innerHTML = `<input class="pemb-in" placeholder="Nama pembantu"><button class="btn ghost" type="button" aria-label="Buang">✕</button>`;
  r.querySelector("input").value = v;
  r.querySelector("button").onclick = () => r.remove();
  $("hd_pemb").appendChild(r);
}
$("hd_pemb_add").onclick = () => pembRow("");
let headEditing = null;
function openHead(insp) {
  headEditing = insp;
  $("hd-title").textContent = insp ? "Ubah maklumat pemeriksaan" : "Pemeriksaan baru";
  $("hd_tarikh").value = insp?.tarikh || today();
  $("hd_pegawai").value = insp?.pegawai ?? (lsGet("rpp_pegawai") || "");
  $("hd_kawasan").value = insp?.kawasan || "";
  $("hd_pemb").innerHTML = "";
  let pb = insp?.pembantu; if (!pb) { try { pb = JSON.parse(lsGet("rpp_pembantu") || "[]"); } catch (e) { pb = []; } }
  (pb.length ? pb : [""]).forEach(pembRow);
  $("hd-status").textContent = "";
  go("head");
}
async function saveHead() {
  const data = { tarikh: $("hd_tarikh").value, pegawai: $("hd_pegawai").value.trim(), kawasan: $("hd_kawasan").value.trim(),
    pembantu: [...document.querySelectorAll(".pemb-in")].map(i => i.value.trim()).filter(Boolean) };
  if (!data.tarikh || !data.kawasan) { $("hd-status").className = "status err"; $("hd-status").textContent = "Isi tarikh dan alamat kawasan."; return; }
  lsSet("rpp_pegawai", data.pegawai); lsSet("rpp_pembantu", JSON.stringify(data.pembantu));
  const rec = headEditing ? { ...headEditing, ...data } : { id: uid(), ...data, createdAt: Date.now() };
  await dbPut("pemeriksaan", rec);
  openInsp(rec.id);
}

// ---------------- inspection ----------------
async function openInsp(id) {
  current = await dbGet("pemeriksaan", id);
  await loadPremises();
  renderInspHead();
  go("insp");
}
async function loadPremises() { premises = (await dbByInsp(current.id)).sort((a, b) => a.createdAt - b.createdAt); renderPremList(); }
function renderInspHead() {
  const c = current;
  $("in-title").textContent = c.kawasan || "Pemeriksaan";
  const rows = [["Tarikh pemeriksaan", longDate(c.tarikh)], ["Pegawai pemeriksa", c.pegawai || "-"], ["Pembantu pemeriksa", (c.pembantu || []).join(", ") || "-"], ["Alamat kawasan", c.kawasan || "-"]];
  $("in-hdr").innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
}
function renderPremList() {
  const list = $("in-list"); list.querySelectorAll(".card").forEach(n => n.remove());
  $("in-empty").hidden = premises.length > 0;
  $("in-count").textContent = premises.length ? `(${premises.length})` : "";
  const cnt = { AKTIF: 0, EXPIRED: 0, RENEW: 0, NONE: 0 };
  premises.forEach((p, i) => {
    const st = statusOf(p, current.tarikh); cnt[st]++;
    const b = document.createElement("button"); b.className = "card";
    b.innerHTML = `<div class="top"><span class="name"><span class="bil">${i + 1}.</span> ${esc(namaCol(p))}</span><span class="pill ${st}">${STATUS_TXT[st]}</span></div>
      <div class="meta mono">${esc(noCol(p))}</div>
      <div class="meta">${p.p_tamat ? "SSM sah sehingga " + esc(fmtDate(p.p_tamat)) : "Tarikh tamat SSM belum diisi"}${p.p_tel ? " · Tel " + esc(p.p_tel) : ""}</div>`;
    b.onclick = () => openPrem(p);
    list.appendChild(b);
  });
  $("in-sum").innerHTML = premises.length ? `<span class="pill AKTIF">${cnt.AKTIF} AKTIF</span><span class="pill EXPIRED">${cnt.EXPIRED} EXPIRED</span>${cnt.RENEW ? `<span class="pill RENEW">${cnt.RENEW} MUST RENEW</span>` : ""}${cnt.NONE ? `<span class="pill NONE">${cnt.NONE} TIADA TARIKH</span>` : ""}` : "";
}
$("in-edit").onclick = () => openHead(current);
$("in-del").onclick = () => $("in-del-c").hidden = false;
$("in-del-no").onclick = () => $("in-del-c").hidden = true;
$("in-del-yes").onclick = async () => {
  for (const p of premises) { await dbDel("premis", p.id); for (const g of Object.values(p.photos || {})) await dbDel("gambar", g); }
  await dbDel("pemeriksaan", current.id);
  $("in-del-c").hidden = true; current = null; await loadHome(); go("home"); toast("Pemeriksaan dipadam");
};

// ---------------- premise form ----------------
function setField(f, v, mark) { const el = $(f); el.value = v == null ? "" : String(v); el.classList.toggle("filled", !!mark && !!el.value); }
function showThumb(k) { const p = photos[k], img = $("thumb-" + k); img.hidden = !p; if (p) img.src = p.url; $("doc-" + k).classList.toggle("has", !!p); }
async function openPrem(p) {
  editingPrem = p;
  P_F.forEach(f => setField(f, p?.[f]));
  for (const k of ["ssm", "pbt"]) { if (photos[k]?.url) URL.revokeObjectURL(photos[k].url); photos[k] = null; }
  showThumb("ssm"); showThumb("pbt");
  document.querySelectorAll("#v-prem input[type=file]").forEach(i => i.value = "");
  $("pr-title").textContent = p ? `Premis ${premises.indexOf(p) + 1}` : `Premis ${premises.length + 1}`;
  $("pr-read").className = "status"; $("pr-read").textContent = "";
  $("pr-status").textContent = ""; $("pr-delrow").hidden = !p; $("pr-del-c").hidden = true;
  $("pr-ocr").hidden = true; $("pr-lines").innerHTML = ""; $("pr-prog").hidden = true;
  setTarget(null);
  renderBanner(); go("prem");
}
$("pr-back").onclick = () => go("insp");
function renderBanner() {
  const t = $("p_tamat").value, st = statusOf({ p_tamat: t }, current?.tarikh);
  const msg = st === "AKTIF" ? `SSM AKTIF<small>Sah sehingga ${longDate(t)}</small>`
    : st === "EXPIRED" ? `SSM EXPIRED<small>Tamat pada ${longDate(t)}</small>`
    : st === "RENEW" ? `SSM EXPIRED (MUST RENEW)<small>Tamat lebih 12 bulan, pada ${longDate(t)}</small>`
    : `Status SSM belum diketahui<small>Snap sijil SSM atau isi tarikh tamat</small>`;
  let html = `<div class="banner ${st}">${msg}</div>`;
  const lt = $("p_lesen_tamat").value;
  if (lt && lt < (current?.tarikh || today())) html += `<div class="chip" style="margin-top:8px">Lesen PBT tamat tempoh pada ${esc(longDate(lt))}</div>`;
  $("pr-banner").innerHTML = html;
}
function setTarget(f) { if (lastField) $(lastField).classList.remove("target"); lastField = f; if (f) $(f).classList.add("target"); }
P_F.forEach(f => {
  $(f).addEventListener("input", () => { $(f).classList.remove("filled"); renderBanner(); });
  $(f).addEventListener("focus", () => setTarget(f));
});

// tap OCR line -> fill last focused field
$("pr-lines").addEventListener("click", e => {
  const b = e.target.closest(".ln"); if (!b) return;
  if (!lastField) { toast("Tekan satu kotak maklumat dahulu"); return; }
  let v = b.textContent;
  const el = $(lastField);
  if (el.type === "date") { const d = Parse.dateFrom(v); if (!d) { toast("Tiada tarikh dalam baris ini"); return; } v = d; }
  else if (lastField === "p_ssm") v = Parse.oldSsm(v.toUpperCase()) || Parse.newSsm(v) || v;
  else if (lastField === "p_kp") { const m = v.replace(/[\s-]/g, "").match(/\d{12}/); if (m) v = m[0]; }
  else if (el.tagName === "TEXTAREA" && el.value && lastField === "p_alamat") v = el.value + ", " + v;
  setField(lastField, v, true); renderBanner();
  toast("Diisi");
});

// ---------------- images ----------------
async function loadImage(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (bmp) return { src: bmp, w: bmp.width, h: bmp.height };
  const img = new Image(); img.src = URL.createObjectURL(file); await img.decode();
  return { src: img, w: img.naturalWidth, h: img.naturalHeight };
}
function drawTo(im, maxSide, gray) {
  const s = Math.min(1, maxSide / Math.max(im.w, im.h));
  const c = document.createElement("canvas"); c.width = Math.round(im.w * s); c.height = Math.round(im.h * s);
  const x = c.getContext("2d");
  if (gray) x.filter = "grayscale(1) contrast(1.25)";
  x.drawImage(im.src, 0, 0, c.width, c.height);
  return c;
}
async function pick(kind, file) {
  if (!file) return;
  reading++;
  $("pr-read").className = "status"; $("pr-read").innerHTML = '<span class="spin"></span> Memproses gambar…';
  let im;
  try { im = await loadImage(file); } catch (e) { $("pr-read").className = "status err"; $("pr-read").textContent = "Gambar tidak dapat dibuka."; return; }
  finally { reading--; }
  const keep = drawTo(im, 600, false);
  const blob = await new Promise(r => keep.toBlob(r, "image/jpeg", 0.6));
  if (photos[kind]?.url) URL.revokeObjectURL(photos[kind].url);
  photos[kind] = { blob, url: URL.createObjectURL(blob), saved: false, id: photos[kind]?.id };
  showThumb(kind);
  readPhoto(kind, drawTo(im, 2200, true));
}
["ssm", "pbt"].forEach(k => { $("in-" + k).onchange = e => pick(k, e.target.files[0]); $("in-" + k + "-g").onchange = e => pick(k, e.target.files[0]); });

// ---------------- OCR ----------------
let workerP = null, progressCb = null;
function getWorker() {
  if (workerP) return workerP;
  workerP = Tesseract.createWorker("eng", 1, {
    workerPath: "vendor/worker.min.js", corePath: "vendor/core", langPath: "vendor/lang", gzip: true,
    logger: m => progressCb && progressCb(m),
  }).catch(e => { workerP = null; throw e; });
  return workerP;
}
function fillIfEmpty(f, v, force) { if (v == null || v === "") return; if (force || !$(f).value.trim()) setField(f, v, true); }
async function readPhoto(kind, canvas) {
  const st = $("pr-read"), bar = $("pr-prog"), fill = bar.querySelector("i");
  st.className = "status"; reading++;
  bar.hidden = false; fill.style.width = "3%";
  st.innerHTML = `<span class="spin"></span> Membaca ${kind === "ssm" ? "sijil SSM" : "lesen PBT"}…`;
  progressCb = m => {
    if (m.status === "recognizing text") fill.style.width = Math.round(10 + m.progress * 90) + "%";
    else if (/loading|initializ/.test(m.status)) { st.innerHTML = `<span class="spin"></span> Menyediakan pembaca teks (kali pertama sahaja)…`; fill.style.width = Math.round(3 + (m.progress || 0) * 7) + "%"; }
  };
  try {
    const w = await getWorker();
    st.innerHTML = `<span class="spin"></span> Membaca ${kind === "ssm" ? "sijil SSM" : "lesen PBT"}…`;
    const { data } = await w.recognize(canvas);
    const text = data.text || "";
    showLines(text);
    const type = Parse.detect(text);
    const notes = [];
    if (type && type !== kind) notes.push(kind === "ssm" ? "Gambar ini nampak macam lesen PBT, bukan sijil SSM." : "Gambar ini nampak macam sijil SSM, bukan lesen PBT.");
    if (kind === "ssm") {
      const v = Parse.parseSsm(text);
      fillIfEmpty("p_nama", v.nama, true);
      fillIfEmpty("p_ssm", v.no_lama || v.no_baru, true);
      fillIfEmpty("p_tamat", v.tamat, true);
      fillIfEmpty("p_alamat", v.alamat, true);
      if (!v.tamat) notes.push("Tarikh tamat tidak dijumpai.");
      if (!v.nama) notes.push("Nama tidak dijumpai.");
    } else {
      const v = Parse.parsePbt(text);
      fillIfEmpty("p_pemilik", v.pemilik, true); fillIfEmpty("p_kp", v.kp, true);
      fillIfEmpty("p_nama", v.nama_syarikat); fillIfEmpty("p_ssm", v.no_lama || v.no_baru);
      fillIfEmpty("p_lesen", v.no_lesen, true); fillIfEmpty("p_lesen_tamat", v.tamat, true); fillIfEmpty("p_alamat", v.alamat);
    }
    const filled = document.querySelectorAll("#v-prem .filled").length;
    st.textContent = (filled ? "Siap. Kotak hijau diisi dari gambar, sila semak. " : "Teks sukar dibaca. ")
      + notes.join(" ") + (filled < 3 ? " Gunakan senarai teks di bawah untuk isi, atau snap semula lebih dekat tanpa pantulan cahaya." : "");
  } catch (e) {
    console.error(e);
    st.className = "status err";
    st.textContent = "Gagal membaca gambar. Pastikan internet ada untuk kali pertama, kemudian cuba lagi.";
  } finally { reading--; progressCb = null; bar.hidden = true; renderBanner(); }
}
function showLines(text) {
  const lines = text.split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(l => l.replace(/[^A-Za-z0-9]/g, "").length >= 3);
  $("pr-lines").innerHTML = lines.map(l => `<button type="button" class="ln">${esc(l)}</button>`).join("");
  $("pr-ocr").hidden = !lines.length;
}

// ---------------- save premise ----------------
async function savePrem(btn, next) {
  const st = $("pr-status"); st.className = "status";
  if (reading) { st.textContent = "Tunggu bacaan gambar selesai."; return; }
  const data = {}; P_F.forEach(f => data[f] = $(f).value.trim());
  if (!data.p_nama && !data.p_pemilik) { st.className = "status err"; st.textContent = "Isi nama perniagaan atau nama pemilik."; return; }
  busy(btn, true, "Menyimpan…");
  try {
    // Gambar tidak disimpan: hanya digunakan untuk membaca teks, kemudian dibuang.
    const rec = { ...(editingPrem || { id: uid(), inspId: current.id, createdAt: Date.now() }), ...data, photos: {}, updatedAt: Date.now() };
    await dbPut("premis", rec);
    await loadPremises();
    busy(btn, false); toast("Premis disimpan");
    if (next) openPrem(null); else go("insp");
  } catch (e) { busy(btn, false); st.className = "status err"; st.textContent = "Gagal simpan: " + (e.message || "ruang storan mungkin penuh"); }
}
$("pr-del").onclick = () => $("pr-del-c").hidden = false;
$("pr-del-no").onclick = () => $("pr-del-c").hidden = true;
$("pr-del-yes").onclick = async () => {
  await dbDel("premis", editingPrem.id);
  for (const g of Object.values(editingPrem.photos || {})) await dbDel("gambar", g);
  await loadPremises(); toast("Premis dipadam"); go("insp");
};

// ---------------- exports ----------------
const libs = {};
function loadScript(src) {
  if (libs[src]) return libs[src];
  libs[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => { delete libs[src]; rej(new Error("load " + src)); }; document.head.appendChild(s); });
  return libs[src];
}
function fileBase() { return "Pemeriksaan_" + (current.kawasan || "kawasan").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40) + "_" + (current.tarikh || today()); }
function rows() { return premises.map((p, i) => { const st = statusOf(p, current.tarikh); return [i + 1, namaCol(p), noCol(p), p.p_tel || "", st === "NONE" ? "" : STATUS_TXT[st]]; }); }
function download(blob, name) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
async function buildPdf() {
  await loadScript("vendor/jspdf.umd.min.js"); await loadScript("vendor/jspdf.plugin.autotable.min.js");
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  const M = 14; let y = 16;
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text("LAPORAN PEMERIKSAAN PREMIS", 105, y, { align: "center" }); y += 8;
  const hdr = [["TARIKH PEMERIKSAAN:", longDate(current.tarikh)], ["PEGAWAI PEMERIKSA:", current.pegawai || "-"]];
  (current.pembantu?.length ? current.pembantu : ["-"]).forEach((n, i) => hdr.push([i === 0 ? "PEMBANTU PEMERIKSA:" : "", n]));
  hdr.push(["ALAMAT KAWASAN:", current.kawasan || "-"]);
  doc.autoTable({ startY: y, body: hdr, theme: "grid", margin: { left: M, right: M }, styles: { fontSize: 9.5, cellPadding: 1.8, textColor: 20, lineColor: 150, lineWidth: .2 },
    columnStyles: { 0: { cellWidth: 55, fillColor: [226, 228, 226] } } });
  y = doc.lastAutoTable.finalY + 6;
  doc.autoTable({ startY: y, head: [["BIL", "NAMA PERNIAGAAN / NAMA PEMILIK", "NO. PENDAFTARAN PERNIAGAAN / NO KAD PENGENALAN PEMILIK", "NO. TELEFON", "STATUS PERNIAGAAN"]],
    body: rows(), theme: "grid", margin: { left: M, right: M },
    styles: { fontSize: 8.5, cellPadding: 1.6, textColor: 20, lineColor: 150, lineWidth: .2, valign: "middle" },
    headStyles: { fillColor: [226, 228, 226], textColor: 20, fontStyle: "bold", halign: "center" },
    columnStyles: { 0: { cellWidth: 11, halign: "center" }, 1: { cellWidth: 58 }, 2: { cellWidth: 52, halign: "center" }, 3: { cellWidth: 26, halign: "center" }, 4: { halign: "center" } },
    didParseCell: d => { if (d.section === "body" && d.column.index === 4 && String(d.cell.raw).startsWith("EXPIRED")) { d.cell.styles.textColor = [179, 38, 30]; d.cell.styles.fontStyle = "bold"; } } });
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(120);
    doc.text(`${current.kawasan || ""} · ${longDate(current.tarikh)} · Muka ${i}/${n}`, 105, 290, { align: "center" }); }
  return doc.output("blob");
}
async function exportPdf(btn, share) {
  if (!premises.length) { toast("Belum ada premis."); return; }
  busy(btn, true, "PDF…");
  try {
    const blob = await buildPdf(), name = fileBase() + ".pdf";
    if (share) {
      const f = new File([blob], name, { type: "application/pdf" });
      try { await navigator.share({ files: [f], title: name }); } catch (e) { if (e.name !== "AbortError") download(blob, name); }
    } else download(blob, name);
  } catch (e) { console.error(e); toast("Gagal jana PDF"); }
  finally { busy(btn, false); }
}
async function exportXlsx(btn) {
  if (!premises.length) { toast("Belum ada premis."); return; }
  busy(btn, true, "Excel…");
  try {
    await loadScript("vendor/xlsx.full.min.js");
    const aoa = [], merges = [];
    const head = (label, val) => { const r = aoa.length; aoa.push([label, "", val, "", ""]); merges.push({ s: { r, c: 0 }, e: { r, c: 1 } }, { s: { r, c: 2 }, e: { r, c: 4 } }); };
    head("TARIKH PEMERIKSAAN:", longDate(current.tarikh)); aoa.push([]);
    head("PEGAWAI PEMERIKSA:", current.pegawai || ""); aoa.push([]);
    (current.pembantu?.length ? current.pembantu : [""]).forEach((n, i) => head(i === 0 ? "PEMBANTU PEMERIKSA:" : "", n)); aoa.push([]);
    head("ALAMAT KAWASAN:", current.kawasan || ""); aoa.push([]);
    aoa.push(["BIL", "NAMA PERNIAGAAN / NAMA PEMILIK", "NO. PENDAFTARAN PERNIAGAAN/ NO KAD PENGENALAN PEMILIK", "NO. TELEFON", "STATUS PERNIAGAAN"]);
    rows().forEach(r => aoa.push(r));
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!merges"] = merges;
    ws["!cols"] = [{ wch: 6 }, { wch: 42 }, { wch: 40 }, { wch: 16 }, { wch: 22 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Pemeriksaan");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileBase() + ".xlsx");
  } catch (e) { console.error(e); toast("Gagal jana Excel"); }
  finally { busy(btn, false); }
}
if (navigator.canShare && navigator.canShare({ files: [new File(["x"], "x.pdf", { type: "application/pdf" })] })) {
  $("in-share").hidden = false; $("in-share").onclick = e => exportPdf(e.currentTarget, true);
}

// ---------------- install / offline ----------------
let deferred = null;
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; $("install").hidden = false; $("install-btn").hidden = false; });
$("install-btn").onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; $("install").hidden = true; };
if (!standalone && /iPhone|iPad/.test(navigator.userAgent)) { $("install").hidden = false; $("install-txt").textContent = "Untuk pasang: tekan butang Kongsi di Safari, kemudian \"Add to Home Screen\"."; }
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

// Buang gambar lama yang pernah disimpan oleh versi terdahulu
tx("gambar", "readwrite", s => s.clear()).catch(() => {});
loadHome().then(() => go("home")).catch(e => { $("h-empty").textContent = "Storan telefon tidak dapat dibuka: " + e.message; });
// Muat pembaca teks awal-awal supaya snap pertama lebih cepat
setTimeout(() => { getWorker().catch(() => {}); }, 1500);
})();

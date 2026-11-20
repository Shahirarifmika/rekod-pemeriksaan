// Penghurai teks OCR untuk sijil SSM dan lesen PBT.
// Fungsi tulen: terima teks OCR, pulangkan medan. Boleh diuji dalam Node.
(function (root) {
  const BULAN = {
    JANUARI: 1, JAN: 1, JANUARY: 1, FEBRUARI: 2, FEB: 2, FEBRUARY: 2, MAC: 3, MAR: 3, MARCH: 3,
    APRIL: 4, APR: 4, MEI: 5, MAY: 5, JUN: 6, JUNE: 6, JULAI: 7, JUL: 7, JULY: 7,
    OGOS: 8, OGO: 8, AUG: 8, AUGUST: 8, SEPTEMBER: 9, SEP: 9, SEPT: 9,
    OKTOBER: 10, OKT: 10, OCT: 10, OCTOBER: 10, NOVEMBER: 11, NOV: 11, DISEMBER: 12, DIS: 12, DEC: 12, DECEMBER: 12,
  };
  const pad = n => String(n).padStart(2, "0");
  const iso = (d, m, y) => {
    d = +d; m = +m; y = +y;
    if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1950 && y <= 2100)) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  };
  // Betulkan huruf yang tersalah baca dalam nombor
  const digits = s => s.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/[S]/g, "5").replace(/[B]/g, "8");
  const clean = s => (s || "").replace(/[“”"©®~_|{}\[\]«»]/g, " ").replace(/\s+/g, " ").replace(/^[^A-Za-z0-9(]+/, "").replace(/[^A-Za-z0-9).&]+$/, "").trim();

  function monthNum(w) {
    w = (w || "").toUpperCase().replace(/[^A-Z]/g, "");
    if (BULAN[w]) return BULAN[w];
    // padanan longgar: 3 huruf pertama
    for (const k of Object.keys(BULAN)) if (k.length >= 3 && w.startsWith(k.slice(0, 3))) return BULAN[k];
    return null;
  }
  function dateFrom(s) {
    if (!s) return null;
    let m = s.match(/(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4})/);
    if (m) return iso(m[1], m[2], m[3]);
    m = s.match(/(\d{1,2})\s+([A-Za-z]{3,10})\s*,?\s*(\d{4})/);
    if (m) { const mo = monthNum(m[2]); if (mo) return iso(m[1], mo, m[3]); }
    return null;
  }

  // No. SSM format lama: JM0968547-V, 003654347-H, CT0168708-U, IP0623505-T
  function oldSsm(s) {
    const re = /\b([A-Z]{0,3})\s?([0-9OoIl]{5,10})\s?[-–]\s?([A-Z])\b/g;
    let m, best = null;
    while ((m = re.exec(s))) {
      let pre = m[1], body = digits(m[2]);
      if (!/\d/.test(m[2])) continue;
      // OCR kadang-kadang tambah "O" di sebelah "0": JM0O785169 -> JM0785169
      if (pre.length === 2 && body.length === 8) body = body.replace(/00/, "0");
      best = `${pre}${body}-${m[3]}`;
      break;
    }
    return best;
  }
  function newSsm(s) {
    const m = s.replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, "0").match(/\b((?:19|20)\d{10})\b/);
    return m ? m[1] : null;
  }
  function validIc(n) {
    if (!/^\d{12}$/.test(n)) return false;
    const mm = +n.slice(2, 4), dd = +n.slice(4, 6);
    return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
  }

  function detect(text) {
    const t = text.toUpperCase();
    const ssm = /SURUHANJAYA|PENDAFTARAN PERNIAGAAN|BORANG [A-Z]|KAEDAH|PERAKUAN|EZBIZ|COMPANIES COMM/.test(t);
    const pbt = /MAJLIS|LESEN|AKAUN|NO\.?\s?FAIL|TEMPOH SAH/.test(t);
    if (ssm && !pbt) return "ssm";
    if (pbt && !ssm) return "pbt";
    if (ssm && pbt) return /PERAKUAN|BORANG/.test(t) ? "ssm" : "pbt";
    return null;
  }

  function parseSsm(text) {
    const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
    const out = {};
    // Nama: baris selepas "dengan nama"
    let i = lines.findIndex(l => /dengan\s+nama|nama\s+berikut|under the name/i.test(l));
    if (i >= 0) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const c = clean(lines[j]);
        if (c && !/PENDAFTARAN|REGISTRATION/i.test(c) && /[A-Z]{2}/.test(c)) { out.nama = c; break; }
      }
    }
    const regIdx = lines.findIndex(l => /PENDAFTARAN\s*:|NO\.?\s*PENDAFTARAN|REGISTRATION NO/i.test(l));
    if (!out.nama && regIdx > 0) out.nama = clean(lines[regIdx - 1]);
    const regLine = regIdx >= 0 ? lines.slice(regIdx, regIdx + 2).join(" ") : text;
    out.no_lama = oldSsm(regLine) || oldSsm(text);
    out.no_baru = newSsm(regLine) || newSsm(text);
    // Tarikh tamat: "sehingga 9 OKTOBER 2027" / "hingga 31/12/2027"
    const flat = lines.join(" ");
    const m = flat.match(/(?:sehingga|hingga|until|tamat)\s*[:\-]?\s*(.{0,30})/i);
    out.tamat = m ? dateFrom(m[1]) : null;
    // Alamat: selepas "beralamat di" hingga "Bil." / "Bertarikh"
    const a = flat.match(/beralamat\s+di\s*:?\s*(.+?)(?:\s+Bil\.?\s|\s+Bertarikh|\s+Cawangan|$)/i);
    if (a) out.alamat = clean(a[1]).replace(/\s*,\s*/g, ", ").replace(/\.$/, "");
    const c = flat.match(/Cawangan\s*:?\s*([A-Z0-9]+)/i);
    if (c) out.cawangan = c[1];
    return out;
  }

  // Ambil perkataan HURUF BESAR di awal sahaja; buang bunyi OCR di hujung
  function upperRun(v) {
    if (!v) return v;
    const out = [];
    for (let t of v.split(" ")) {
      if (/^[A-Z]*l[A-Z]*$/.test(t) && t.length > 1) t = t.replace(/l/g, "I");
      if (!/^[A-Z0-9&.,\/()'@-]+$/.test(t)) break;
      out.push(t);
    }
    return out.join(" ").replace(/[.,]+$/, "") || v;
  }

  const LABEL_CUT = /\s+(?:NO\s?\.?\s?(?:PETAK|BIL|FAIL|SIRI)|LOKASI|TARIKH|TEMPOH)\b.*$/i;
  function after(line, re) {
    const m = line.match(re);
    if (!m) return null;
    let v = line.slice(m.index + m[0].length).replace(/^[\s:.;,~\-_=©]+/, "");
    v = v.replace(LABEL_CUT, "");
    return clean(v);
  }

  function parsePbt(text) {
    const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
    const out = {};
    const flat = lines.join(" ");
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!out.nama_syarikat && /S\s?YARIKAT\W{0,5}[:.]/i.test(l) && !/ALAMAT/i.test(l))
        out.nama_syarikat = upperRun(after(l, /S\s?YARIKAT/i));
      if (!out.no_lesen && /AKAUN/i.test(l)) {
        const m = l.match(/AKAUN\W*([A-Z][0-9OIl]{6,9})/i);
        if (m) out.no_lesen = m[1][0].toUpperCase() + digits(m[1].slice(1));
      }
      if (!out.kp && /K\s?\/\s?P|\bIP\b|KAD PENGENALAN/i.test(l)) {
        const m = digits(l.replace(/^.*?(K\s?\/\s?P|\bIP\b|PENGENALAN)/i, "")).replace(/[\s-]/g, "").match(/\d{12}/);
        if (m && validIc(m[0])) {
          out.kp = m[0];
          // Nama pemegang biasanya di baris sebelum K/P
          if (!out.pemilik && i > 0 && !/SYARIKAT|AKAUN/i.test(lines[i - 1])) {
            const v = lines[i - 1].replace(/^.*?\bNAMA\b/i, "").replace(/^[^:.]*?[:.]\s/, "");
            const nm = upperRun(clean(v.split(/\s[.:]\s/)[0]));
            if (nm && nm.length >= 3) out.pemilik = nm;
          }
        }
      }
      if (/^\W*NAMA\s*[:.]/i.test(l)) out.pemilik = upperRun(after(l, /NAMA/i));
      if (!out.alamat && /ALAMAT\s*(PERNIAGAAN|SYARIKAT|PREMIS)|MAT\s+PERNIAGAAN|LOKASI\s+LESEN\s*:\s*\w{3}/i.test(l)) {
        const parts = [after(l, /(PERNIAGAAN|SYARIKAT|PREMIS|LESEN)/i)].map(x => (x || "").replace(/,\s*\w{1,2}$/, ""));
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          if (/[:]|MAKLUMAT|AKLUMAN|BAYARAN/i.test(lines[j])) break;
          const c = clean(lines[j].replace(/^[^A-Z0-9]*[A-Za-z]?\)\s*/, ""));
          if (c && c.length >= 3) parts.push(c);
        }
        out.alamat = parts.filter(Boolean).join(", ").replace(/\s*,\s*,/g, ",");
      }
    }
    const ssmLine = lines.find(l => /\bS\s?SM\b|NO\.?\s?SSM|^\W*S?SM\b/i.test(l)) || "";
    out.no_lama = oldSsm(ssmLine.toUpperCase());
    out.no_baru = newSsm(ssmLine);
    if (!out.kp) {
      const all = digits(flat).match(/\b\d{12}\b/g) || [];
      const ic = all.find(n => validIc(n) && !/^(19|20)\d{2}0[0-9]/.test(n));
      if (ic) out.kp = ic;
    }
    const t = flat.match(/(\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4})\s*(?:SEHINGGA|HINGGA|-|TO)\s*(\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4})/i);
    if (t) { out.mula = dateFrom(t[1]); out.tamat = dateFrom(t[2]); }
    else {
      const m = flat.match(/(?:SEHINGGA|HINGGA|TAMAT)\s*:?\s*(\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4})/i);
      if (m) out.tamat = dateFrom(m[1]);
    }
    const mj = flat.match(/MAJLIS\s+(?:BANDARAYA|PERBANDARAN|DAERAH)\s+[A-Z ]{3,30}/i);
    if (mj) out.majlis = clean(mj[0]).replace(/\s+(BANGUNAN|JALAN|NO)\b.*$/i, "");
    return out;
  }

  const api = { detect, parseSsm, parsePbt, dateFrom, oldSsm, newSsm };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Parse = api;
})(typeof self !== "undefined" ? self : this);

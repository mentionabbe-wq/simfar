// ── server.js ──────────────────────────────────────────────────────────
// REST API SimFar — Alkes & BMHP. Express + better-sqlite3.
// Semua logika bisnis (alur status, auto-PO untuk lab, pemotongan anggaran)
// dipindahkan ke sisi server agar konsisten lintas pengguna.

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { db } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Sajikan file statis front-end (app.html, index.html) dari folder induk.
const FRONTEND_DIR = path.join(__dirname, '..');
app.use(express.static(FRONTEND_DIR));

// ── Upload (multer) ────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB / file
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('Format tidak didukung: ' + file.originalname));
  },
});

// ── Helpers ────────────────────────────────────────────────────────────
function nextId(prefix, table) {
  const rows = db.prepare(`SELECT id FROM ${table} WHERE id LIKE ?`).all(prefix + '-%');
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.id).split('-')[1], 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

const TODAY = () => new Date().toISOString().slice(0, 10);

function docsFor(ownerType, ownerId) {
  return db.prepare(
    'SELECT id, name, size, type FROM dokumen WHERE ownerType = ? AND ownerId = ? ORDER BY id'
  ).all(ownerType, ownerId);
}

function attachDocs(ownerType, ownerId, fileIds = []) {
  if (!Array.isArray(fileIds) || !fileIds.length) return;
  const stmt = db.prepare('UPDATE dokumen SET ownerType = ?, ownerId = ? WHERE id = ?');
  const tx = db.transaction(() => fileIds.forEach((id) => stmt.run(ownerType, String(ownerId), id)));
  tx();
}

function getPermintaan(id) {
  const p = db.prepare('SELECT * FROM permintaan WHERE id = ?').get(id);
  if (!p) return null;
  p.items = db.prepare('SELECT * FROM permintaan_items WHERE permintaanId = ? ORDER BY urutan, id').all(id);
  p.dokumen = docsFor('permintaan', id);
  return p;
}

function getPengajuan(id) {
  const po = db.prepare('SELECT * FROM pengajuan WHERE id = ?').get(id);
  if (!po) return null;
  po.items = db.prepare('SELECT * FROM pengajuan_items WHERE pengajuanId = ? ORDER BY id').all(id);
  po.suratPesanan = docsFor('pengajuan', id);
  return po;
}

// Tambah/kurangi stok ruangan untuk satu item (delta jumlah).
function upsertStok(ruangan, it) {
  const ex = db.prepare('SELECT * FROM stok WHERE ruangan = ? AND nama = ?').get(ruangan, it.nama);
  if (ex) {
    db.prepare("UPDATE stok SET jumlah = jumlah + ?, harga = ?, satuan = ?, jenis = ?, updatedAt = datetime('now') WHERE id = ?")
      .run(it.jumlah, it.harga ?? ex.harga, it.satuan || ex.satuan, it.jenis || ex.jenis, ex.id);
  } else {
    db.prepare('INSERT INTO stok (ruangan, nama, jenis, satuan, jumlah, harga) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ruangan, it.nama, it.jenis || 'alkes', it.satuan || 'pcs', it.jumlah, it.harga || 0);
  }
}

// Total nilai serah terima yang sudah selesai pada ruangan & bulan tertentu.
function calcUsed(ruangan, bulan) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(i.harga * i.jumlah), 0) AS used
    FROM permintaan p
    JOIN permintaan_items i ON i.permintaanId = p.id
    WHERE p.ruangan = ? AND substr(p.tanggal, 1, 7) = ? AND p.statusSerahTerima = 'selesai'
  `).get(ruangan, bulan);
  return row.used;
}

// ── USERS / LOGIN ──────────────────────────────────────────────────────
app.get('/api/users', (_req, res) => {
  const rows = db.prepare('SELECT id, nama, ruangan, role FROM users ORDER BY id').all();
  const grouped = {};
  for (const u of rows) (grouped[u.role] ||= []).push(u);
  res.json(grouped);
});

const ROLES = ['keperawatan', 'laboratorium', 'farmasi', 'keuangan', 'manager', 'direktur'];

// Pendaftaran akun. body: { nama, role, ruangan, username, password }
app.post('/api/register', (req, res) => {
  const { nama, role, ruangan, username, password } = req.body || {};
  if (!nama || !role || !ruangan || !username || !password) return res.status(400).json({ error: 'Lengkapi semua kolom pendaftaran' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Bagian tidak valid' });
  if (String(password).length < 4) return res.status(400).json({ error: 'Password minimal 4 karakter' });
  const uname = String(username).trim().toLowerCase();
  const ex = db.prepare('SELECT id FROM users WHERE lower(username) = ?').get(uname);
  if (ex) return res.status(409).json({ error: 'Username sudah dipakai' });
  const info = db.prepare('INSERT INTO users (nama, ruangan, role, username, password) VALUES (?, ?, ?, ?, ?)')
    .run(String(nama).trim(), String(ruangan).trim(), role, uname, String(password));
  res.status(201).json({ id: info.lastInsertRowid, nama: String(nama).trim(), ruangan: String(ruangan).trim(), role, username: uname });
});

// Login. body: { username, password }
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const uname = String(username || '').trim().toLowerCase();
  const u = db.prepare('SELECT id, nama, ruangan, role, username, password FROM users WHERE lower(username) = ?').get(uname);
  if (!u || u.password !== password) return res.status(401).json({ error: 'Username atau password salah' });
  res.json({ id: u.id, nama: u.nama, ruangan: u.ruangan, role: u.role, username: u.username });
});

// ── PERMINTAAN ─────────────────────────────────────────────────────────
app.get('/api/permintaan', (req, res) => {
  const { ruangan, status, sumber } = req.query;
  let sql = 'SELECT * FROM permintaan WHERE 1=1';
  const args = [];
  if (ruangan) { sql += ' AND ruangan = ?'; args.push(ruangan); }
  if (status)  { sql += ' AND status = ?';  args.push(status); }
  if (sumber)  { sql += ' AND sumber = ?';  args.push(sumber); }
  sql += ' ORDER BY createdAt DESC, id DESC';
  const rows = db.prepare(sql).all(...args);
  for (const p of rows) {
    p.items = db.prepare('SELECT * FROM permintaan_items WHERE permintaanId = ? ORDER BY urutan, id').all(p.id);
    p.dokumen = docsFor('permintaan', p.id);
  }
  res.json(rows);
});

app.get('/api/permintaan/:id', (req, res) => {
  const p = getPermintaan(req.params.id);
  if (!p) return res.status(404).json({ error: 'Data tidak ditemukan' });
  p.pengajuan = db.prepare('SELECT * FROM pengajuan WHERE permintaanId = ? ORDER BY id').all(p.id);
  res.json(p);
});

// Buat permintaan baru (Keperawatan / Laboratorium).
app.post('/api/permintaan', (req, res) => {
  const { ruangan, pemohon, keperluan, sumber, tanggal, items, dokumenIds } = req.body || {};
  if (!ruangan || !pemohon || !sumber) return res.status(400).json({ error: 'ruangan, pemohon, dan sumber wajib diisi' });
  if (!keperluan || !String(keperluan).trim()) return res.status(400).json({ error: 'Keperluan wajib diisi' });
  const clean = (Array.isArray(items) ? items : [])
    .filter((it) => it && String(it.nama || '').trim())
    .map((it) => ({
      nama: String(it.nama).trim(),
      jenis: it.jenis === 'bmhp' ? 'bmhp' : 'alkes',
      satuan: String(it.satuan || 'pcs').trim() || 'pcs',
      jumlah: Math.max(1, parseInt(it.jumlah, 10) || 1),
    }));
  if (!clean.length) return res.status(400).json({ error: 'Tambahkan minimal 1 item' });

  const id = nextId('REQ', 'permintaan');
  const insReq = db.prepare(`INSERT INTO permintaan (id, ruangan, tanggal, pemohon, keperluan, status, sumber, statusSerahTerima)
                             VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)`);
  const insItem = db.prepare(`INSERT INTO permintaan_items (permintaanId, nama, jenis, satuan, jumlah, statusItem, harga, urutan)
                              VALUES (?, ?, ?, ?, ?, NULL, 0, ?)`);
  const tx = db.transaction(() => {
    insReq.run(id, ruangan, tanggal || TODAY(), pemohon, String(keperluan).trim(), sumber);
    clean.forEach((it, i) => insItem.run(id, it.nama, it.jenis, it.satuan, it.jumlah, i));
  });
  tx();
  attachDocs('permintaan', id, dokumenIds);
  res.status(201).json(getPermintaan(id));
});

// Farmasi memproses ketersediaan stok per item.
// body: { items: [{ itemId, statusItem: 'diberikan'|'pengajuan' }], suratPesananIds?: [] }
app.post('/api/permintaan/:id/proses', (req, res) => {
  const p = getPermintaan(req.params.id);
  if (!p) return res.status(404).json({ error: 'Data tidak ditemukan' });
  if (p.status === 'selesai') return res.status(409).json({ error: 'Permintaan sudah selesai' });

  const updates = Array.isArray(req.body?.items) ? req.body.items : [];
  const map = new Map(updates.map((u) => [Number(u.itemId), u.statusItem]));
  for (const it of p.items) {
    const st = map.get(it.id);
    if (st !== 'diberikan' && st !== 'pengajuan') {
      return res.status(400).json({ error: `Tentukan status untuk item "${it.nama}"` });
    }
  }

  const upd = db.prepare('UPDATE permintaan_items SET statusItem = ? WHERE id = ?');
  const result = db.transaction(() => {
    p.items.forEach((it) => upd.run(map.get(it.id), it.id));

    const needPO = p.items.filter((it) => map.get(it.id) === 'pengajuan');
    let createdPO = null;

    if (needPO.length) {
      const isLab = p.sumber === 'laboratorium';
      const poId = nextId('PO', 'pengajuan');
      const poStatus = isLab ? 'disetujui' : 'menunggu';
      const poNote = isLab ? 'PO langsung disetujui — permintaan laboratorium' : '';
      db.prepare(`INSERT INTO pengajuan (id, permintaanId, ruangan, tanggal, total, supplier, status, catatan)
                  VALUES (?, ?, ?, ?, 0, '', ?, ?)`)
        .run(poId, p.id, p.ruangan, TODAY(), poStatus, poNote);
      const insPOi = db.prepare('INSERT INTO pengajuan_items (pengajuanId, nama, satuan, jumlah, harga) VALUES (?, ?, ?, ?, 0)');
      needPO.forEach((it) => insPOi.run(poId, it.nama, it.satuan, it.jumlah));
      attachDocs('pengajuan', poId, req.body?.suratPesananIds);

      const newStatus = needPO.length === p.items.length ? 'diproses' : 'sebagian';
      db.prepare('UPDATE permintaan SET status = ? WHERE id = ?').run(newStatus, p.id);
      createdPO = poId;
    } else {
      db.prepare("UPDATE permintaan SET status = 'selesai' WHERE id = ?").run(p.id);
    }
    return createdPO;
  })();

  res.json({ permintaan: getPermintaan(p.id), pengajuanId: result });
});

// Farmasi input harga & serah terima (khusus permintaan laboratorium).
// body: { items: [{ itemId, harga }] }
app.post('/api/permintaan/:id/serah-terima', (req, res) => {
  const p = getPermintaan(req.params.id);
  if (!p) return res.status(404).json({ error: 'Data tidak ditemukan' });
  if (p.statusSerahTerima === 'selesai') return res.status(409).json({ error: 'Serah terima sudah selesai' });

  const updates = Array.isArray(req.body?.items) ? req.body.items : [];
  const map = new Map(updates.map((u) => [Number(u.itemId), Math.max(0, parseInt(u.harga, 10) || 0)]));

  // Hitung total dulu untuk validasi sebelum melakukan perubahan apa pun.
  let total = 0;
  const finalHarga = new Map();
  p.items.forEach((it) => {
    const h = map.has(it.id) ? map.get(it.id) : it.harga;
    finalHarga.set(it.id, h);
    total += h * it.jumlah;
  });
  if (!total) return res.status(400).json({ error: 'Isi harga minimal satu item' });

  const upd = db.prepare('UPDATE permintaan_items SET harga = ? WHERE id = ?');
  db.transaction(() => {
    p.items.forEach((it) => {
      const h = finalHarga.get(it.id);
      upd.run(h, it.id);
      // Barang yang diserahterimakan masuk ke stok ruangan (laboratorium).
      upsertStok(p.ruangan, { nama: it.nama, jenis: it.jenis, satuan: it.satuan, jumlah: it.jumlah, harga: h });
    });
    db.prepare("UPDATE permintaan SET statusSerahTerima = 'selesai', status = 'selesai' WHERE id = ?").run(p.id);
  })();

  const bulan = p.tanggal.slice(0, 7);
  const ang = db.prepare('SELECT * FROM anggaran WHERE ruangan = ? AND bulan = ?').get(p.ruangan, bulan);
  const used = calcUsed(p.ruangan, bulan);
  const overBudget = ang ? Math.max(0, used - ang.nominal) : 0;

  res.json({ permintaan: getPermintaan(p.id), total, overBudget });
});

// ── PENGAJUAN (PO) ─────────────────────────────────────────────────────
app.get('/api/pengajuan', (req, res) => {
  const { status, permintaanId } = req.query;
  let sql = 'SELECT * FROM pengajuan WHERE 1=1';
  const args = [];
  if (status)       { sql += ' AND status = ?';        args.push(status); }
  if (permintaanId) { sql += ' AND permintaanId = ?';  args.push(permintaanId); }
  sql += ' ORDER BY createdAt DESC, id DESC';
  const rows = db.prepare(sql).all(...args);
  for (const po of rows) {
    po.items = db.prepare('SELECT * FROM pengajuan_items WHERE pengajuanId = ? ORDER BY id').all(po.id);
    po.suratPesanan = docsFor('pengajuan', po.id);
  }
  res.json(rows);
});

app.get('/api/pengajuan/:id', (req, res) => {
  const po = getPengajuan(req.params.id);
  if (!po) return res.status(404).json({ error: 'Data tidak ditemukan' });
  res.json(po);
});

// Keuangan menyetujui / menolak pengajuan + input harga & supplier.
// body: { action: 'disetujui'|'ditolak', supplier, catatan, items: [{ itemId, harga }] }
app.post('/api/pengajuan/:id/keputusan', (req, res) => {
  const po = getPengajuan(req.params.id);
  if (!po) return res.status(404).json({ error: 'Data tidak ditemukan' });
  if (po.status !== 'menunggu') return res.status(409).json({ error: 'Pengajuan sudah diproses' });

  const { action, supplier, catatan, items } = req.body || {};
  if (action !== 'disetujui' && action !== 'ditolak') return res.status(400).json({ error: 'action tidak valid' });

  const map = new Map((Array.isArray(items) ? items : []).map((u) => [Number(u.itemId), Math.max(0, parseInt(u.harga, 10) || 0)]));
  const upd = db.prepare('UPDATE pengajuan_items SET harga = ? WHERE id = ?');
  let total = 0;
  po.items.forEach((it) => { total += (map.has(it.id) ? map.get(it.id) : it.harga) * it.jumlah; });

  if (action === 'disetujui') {
    if (!supplier || !String(supplier).trim()) return res.status(400).json({ error: 'Nama supplier wajib diisi' });
    if (!total) return res.status(400).json({ error: 'Isi harga satuan item' });
  }

  db.transaction(() => {
    po.items.forEach((it) => { if (map.has(it.id)) upd.run(map.get(it.id), it.id); });
    db.prepare('UPDATE pengajuan SET status = ?, supplier = ?, catatan = ?, total = ? WHERE id = ?')
      .run(action, String(supplier || '').trim(), String(catatan || '').trim(), total, po.id);
  })();

  res.json(getPengajuan(po.id));
});

// ── ANGGARAN ───────────────────────────────────────────────────────────
app.get('/api/anggaran', (req, res) => {
  const { ruangan, bulan } = req.query;
  let sql = 'SELECT * FROM anggaran WHERE 1=1';
  const args = [];
  if (ruangan) { sql += ' AND ruangan = ?'; args.push(ruangan); }
  if (bulan)   { sql += ' AND bulan = ?';   args.push(bulan); }
  sql += ' ORDER BY bulan DESC, ruangan';
  const rows = db.prepare(sql).all(...args);
  res.json(rows);
});

// Ringkasan pemakaian anggaran 1 ruangan/bulan: nominal, terpakai, sisa, persen.
app.get('/api/anggaran/usage', (req, res) => {
  const { ruangan, bulan } = req.query;
  if (!ruangan || !bulan) return res.status(400).json({ error: 'ruangan dan bulan wajib diisi' });
  const ang = db.prepare('SELECT * FROM anggaran WHERE ruangan = ? AND bulan = ?').get(ruangan, bulan);
  const nominal = ang ? ang.nominal : 0;
  const used = calcUsed(ruangan, bulan);
  const sisa = nominal - used;
  const pct = nominal > 0 ? Math.min(100, Math.round((used / nominal) * 100)) : 0;
  res.json({ ruangan, bulan, nominal, used, sisa, pct, anggaranId: ang ? ang.id : null });
});

// Upsert anggaran bulanan.
app.put('/api/anggaran', (req, res) => {
  const { ruangan, bulan, nominal } = req.body || {};
  if (!ruangan || !bulan) return res.status(400).json({ error: 'ruangan dan bulan wajib diisi' });
  const n = Math.max(0, parseInt(nominal, 10) || 0);
  if (!n) return res.status(400).json({ error: 'Nominal anggaran wajib diisi' });
  const ex = db.prepare('SELECT * FROM anggaran WHERE ruangan = ? AND bulan = ?').get(ruangan, bulan);
  if (ex) {
    db.prepare('UPDATE anggaran SET nominal = ? WHERE id = ?').run(n, ex.id);
    res.json({ ...ex, nominal: n, updated: true });
  } else {
    const id = nextId('ANG', 'anggaran');
    db.prepare('INSERT INTO anggaran (id, ruangan, bulan, nominal) VALUES (?, ?, ?, ?)').run(id, ruangan, bulan, n);
    res.status(201).json({ id, ruangan, bulan, nominal: n, updated: false });
  }
});

// ── STOK (inventaris laboratorium) ─────────────────────────────────────
app.get('/api/stok', (req, res) => {
  const { ruangan } = req.query;
  let sql = 'SELECT * FROM stok';
  const args = [];
  if (ruangan) { sql += ' WHERE ruangan = ?'; args.push(ruangan); }
  sql += ' ORDER BY nama';
  res.json(db.prepare(sql).all(...args));
});

app.get('/api/stok/pemakaian', (req, res) => {
  const { ruangan } = req.query;
  let sql = 'SELECT * FROM stok_pemakaian';
  const args = [];
  if (ruangan) { sql += ' WHERE ruangan = ?'; args.push(ruangan); }
  sql += ' ORDER BY createdAt DESC, id DESC';
  res.json(db.prepare(sql).all(...args));
});

// Catat pemakaian → mengurangi stok. body: { ruangan, tanggal, pemakai, keterangan, items:[{stokId,jumlah}] }
app.post('/api/stok/pemakaian', (req, res) => {
  const { ruangan, tanggal, pemakai, keterangan, items } = req.body || {};
  if (!ruangan) return res.status(400).json({ error: 'ruangan wajib diisi' });
  const clean = (Array.isArray(items) ? items : [])
    .map((x) => ({ stokId: Number(x.stokId), jumlah: Math.max(0, parseInt(x.jumlah, 10) || 0) }))
    .filter((x) => x.stokId && x.jumlah > 0);
  if (!clean.length) return res.status(400).json({ error: 'Tambahkan minimal 1 item pemakaian' });

  for (const x of clean) {
    const s = db.prepare('SELECT * FROM stok WHERE id = ? AND ruangan = ?').get(x.stokId, ruangan);
    if (!s) return res.status(404).json({ error: 'Item stok tidak ditemukan' });
    if (x.jumlah > s.jumlah) return res.status(400).json({ error: `Stok "${s.nama}" tidak cukup (sisa ${s.jumlah})` });
  }

  const created = [];
  db.transaction(() => {
    for (const x of clean) {
      const s = db.prepare('SELECT * FROM stok WHERE id = ?').get(x.stokId);
      db.prepare("UPDATE stok SET jumlah = jumlah - ?, updatedAt = datetime('now') WHERE id = ?").run(x.jumlah, s.id);
      const id = nextId('PMK', 'stok_pemakaian');
      db.prepare(`INSERT INTO stok_pemakaian (id, ruangan, stokId, nama, satuan, jumlah, tanggal, pemakai, keterangan)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, ruangan, s.id, s.nama, s.satuan, x.jumlah, tanggal || TODAY(), String(pemakai || '').trim(), String(keterangan || '').trim());
      created.push(id);
    }
  })();
  res.status(201).json({ created });
});

app.get('/api/stok/opname', (req, res) => {
  const { ruangan } = req.query;
  let sql = 'SELECT * FROM stok_opname';
  const args = [];
  if (ruangan) { sql += ' WHERE ruangan = ?'; args.push(ruangan); }
  sql += ' ORDER BY createdAt DESC, id DESC';
  const rows = db.prepare(sql).all(...args);
  for (const o of rows) o.items = db.prepare('SELECT * FROM stok_opname_item WHERE opnameId = ? ORDER BY id').all(o.id);
  res.json(rows);
});

// Stok opname → set stok sistem ke jumlah fisik, catat selisih.
// body: { ruangan, tanggal, petugas, catatan, items:[{stokId,fisik}] }
app.post('/api/stok/opname', (req, res) => {
  const { ruangan, tanggal, petugas, catatan, items } = req.body || {};
  if (!ruangan) return res.status(400).json({ error: 'ruangan wajib diisi' });
  const clean = (Array.isArray(items) ? items : [])
    .map((x) => ({ stokId: Number(x.stokId), fisik: Math.max(0, parseInt(x.fisik, 10)) }))
    .filter((x) => x.stokId && Number.isFinite(x.fisik));
  if (!clean.length) return res.status(400).json({ error: 'Isi hasil hitung fisik minimal 1 item' });

  const id = nextId('OPN', 'stok_opname');
  let totalSelisih = 0;
  let disesuaikan = 0;
  db.transaction(() => {
    db.prepare(`INSERT INTO stok_opname (id, ruangan, tanggal, petugas, catatan, jumlahItem, totalSelisih)
                VALUES (?, ?, ?, ?, ?, 0, 0)`)
      .run(id, ruangan, tanggal || TODAY(), String(petugas || '').trim(), String(catatan || '').trim());
    const insItem = db.prepare('INSERT INTO stok_opname_item (opnameId, stokId, nama, sistem, fisik, selisih) VALUES (?, ?, ?, ?, ?, ?)');
    for (const x of clean) {
      const s = db.prepare('SELECT * FROM stok WHERE id = ? AND ruangan = ?').get(x.stokId, ruangan);
      if (!s) continue;
      const selisih = x.fisik - s.jumlah;
      insItem.run(id, s.id, s.nama, s.jumlah, x.fisik, selisih);
      if (selisih !== 0) {
        db.prepare("UPDATE stok SET jumlah = ?, updatedAt = datetime('now') WHERE id = ?").run(x.fisik, s.id);
        disesuaikan += 1;
      }
      totalSelisih += selisih;
    }
    db.prepare('UPDATE stok_opname SET jumlahItem = ?, totalSelisih = ? WHERE id = ?').run(clean.length, totalSelisih, id);
  })();
  res.status(201).json({ id, disesuaikan, totalSelisih });
});

// ── FILE UPLOAD / DOWNLOAD ─────────────────────────────────────────────
// Upload dulu (tanpa owner), lalu id-nya dikirim saat membuat permintaan/PO.
app.post('/api/files', upload.array('files', 10), (req, res) => {
  const ins = db.prepare(`INSERT INTO dokumen (ownerType, ownerId, name, size, type, storedName)
                          VALUES (NULL, NULL, ?, ?, ?, ?)`);
  const out = (req.files || []).map((f) => {
    const info = ins.run(f.originalname, f.size, f.mimetype, f.filename);
    return { id: info.lastInsertRowid, name: f.originalname, size: f.size, type: f.mimetype };
  });
  res.status(201).json(out);
});

app.get('/api/files/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM dokumen WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'File tidak ditemukan' });
  const fp = path.join(UPLOAD_DIR, d.storedName);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Berkas hilang dari penyimpanan' });
  res.download(fp, d.name);
});

// ── Health & error handling ────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Multer / error handler terpusat → selalu balas JSON.
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File terlalu besar (maks 10 MB)' });
  }
  console.error(err);
  res.status(400).json({ error: err.message || 'Terjadi kesalahan' });
});

app.listen(PORT, () => {
  console.log(`\n  SimFar backend berjalan di http://localhost:${PORT}`);
  console.log(`  Front-end : http://localhost:${PORT}/app.html`);
  console.log(`  API health: http://localhost:${PORT}/api/health\n`);
});

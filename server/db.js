// ── db.js ──────────────────────────────────────────────────────────────
// SQLite schema, connection, dan seed data untuk SimFar.
// Menggunakan better-sqlite3 (sinkron, cepat, prebuilt binary — tanpa compiler).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'simfar.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ─────────────────────────────────────────────────────────────
function init() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nama       TEXT NOT NULL,
    ruangan    TEXT NOT NULL,
    role       TEXT NOT NULL,
    username   TEXT,
    password   TEXT,
    createdAt  TEXT DEFAULT (datetime('now')),
    lastLogin  TEXT,
    loginCount INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS permintaan (
    id                TEXT PRIMARY KEY,
    ruangan           TEXT NOT NULL,
    tanggal           TEXT NOT NULL,
    pemohon           TEXT NOT NULL,
    pemohonUsername   TEXT,
    keperluan         TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending',
    sumber            TEXT NOT NULL,
    statusSerahTerima TEXT,
    createdAt         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS permintaan_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    permintaanId TEXT NOT NULL REFERENCES permintaan(id) ON DELETE CASCADE,
    nama         TEXT NOT NULL,
    jenis        TEXT NOT NULL DEFAULT 'alkes',
    satuan       TEXT NOT NULL DEFAULT 'pcs',
    jumlah       INTEGER NOT NULL DEFAULT 1,
    statusItem   TEXT,
    harga        INTEGER NOT NULL DEFAULT 0,
    urutan       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS pengajuan (
    id           TEXT PRIMARY KEY,
    permintaanId TEXT NOT NULL REFERENCES permintaan(id) ON DELETE CASCADE,
    ruangan      TEXT NOT NULL,
    tanggal      TEXT NOT NULL,
    total        INTEGER NOT NULL DEFAULT 0,
    supplier     TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'menunggu',
    catatan      TEXT NOT NULL DEFAULT '',
    createdAt    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pengajuan_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pengajuanId TEXT NOT NULL REFERENCES pengajuan(id) ON DELETE CASCADE,
    nama        TEXT NOT NULL,
    satuan      TEXT NOT NULL DEFAULT 'pcs',
    jumlah      INTEGER NOT NULL DEFAULT 1,
    harga       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS anggaran (
    id      TEXT PRIMARY KEY,
    ruangan TEXT NOT NULL,
    bulan   TEXT NOT NULL,
    nominal INTEGER NOT NULL DEFAULT 0,
    UNIQUE(ruangan, bulan)
  );

  -- Lampiran file. ownerType: 'permintaan' (dokumen) | 'pengajuan' (surat pesanan)
  CREATE TABLE IF NOT EXISTS dokumen (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ownerType  TEXT,
    ownerId    TEXT,
    name       TEXT NOT NULL,
    size       INTEGER NOT NULL DEFAULT 0,
    type       TEXT,
    storedName TEXT NOT NULL,
    createdAt  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ── Inventaris stok laboratorium ──────────────────────────────────
  CREATE TABLE IF NOT EXISTS stok (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ruangan   TEXT NOT NULL,
    nama      TEXT NOT NULL,
    jenis     TEXT NOT NULL DEFAULT 'alkes',
    satuan    TEXT NOT NULL DEFAULT 'pcs',
    jumlah    INTEGER NOT NULL DEFAULT 0,
    harga     INTEGER NOT NULL DEFAULT 0,
    updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(ruangan, nama)
  );

  CREATE TABLE IF NOT EXISTS stok_pemakaian (
    id         TEXT PRIMARY KEY,
    ruangan    TEXT NOT NULL,
    stokId     INTEGER REFERENCES stok(id) ON DELETE SET NULL,
    nama       TEXT NOT NULL,
    satuan     TEXT NOT NULL DEFAULT 'pcs',
    jumlah     INTEGER NOT NULL DEFAULT 0,
    tanggal    TEXT NOT NULL,
    pemakai    TEXT NOT NULL DEFAULT '',
    keterangan TEXT NOT NULL DEFAULT '',
    createdAt  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stok_opname (
    id           TEXT PRIMARY KEY,
    ruangan      TEXT NOT NULL,
    tanggal      TEXT NOT NULL,
    petugas      TEXT NOT NULL DEFAULT '',
    catatan      TEXT NOT NULL DEFAULT '',
    jumlahItem        INTEGER NOT NULL DEFAULT 0,
    totalSelisih      INTEGER NOT NULL DEFAULT 0,
    totalSelisihNilai INTEGER NOT NULL DEFAULT 0,
    createdAt         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stok_opname_item (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    opnameId     TEXT NOT NULL REFERENCES stok_opname(id) ON DELETE CASCADE,
    stokId       INTEGER,
    nama         TEXT NOT NULL,
    sistem       INTEGER NOT NULL DEFAULT 0,
    fisik        INTEGER NOT NULL DEFAULT 0,
    selisih      INTEGER NOT NULL DEFAULT 0,
    harga        INTEGER NOT NULL DEFAULT 0,
    selisihNilai INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_pi_req  ON permintaan_items(permintaanId);
  CREATE INDEX IF NOT EXISTS idx_pgi_po  ON pengajuan_items(pengajuanId);
  CREATE INDEX IF NOT EXISTS idx_dok_own ON dokumen(ownerType, ownerId);
  CREATE INDEX IF NOT EXISTS idx_stok_rg ON stok(ruangan);
  CREATE INDEX IF NOT EXISTS idx_pmk_rg  ON stok_pemakaian(ruangan);
  CREATE INDEX IF NOT EXISTS idx_opn_rg  ON stok_opname(ruangan);
  `);
  migrate();
}

// Tambah kolom yang mungkin belum ada pada database lama (tanpa kehilangan data).
function migrate() {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('username'))   db.exec('ALTER TABLE users ADD COLUMN username TEXT');
  if (!cols.includes('password'))   db.exec('ALTER TABLE users ADD COLUMN password TEXT');
  if (!cols.includes('createdAt'))  db.exec('ALTER TABLE users ADD COLUMN createdAt TEXT');
  if (!cols.includes('lastLogin'))  db.exec('ALTER TABLE users ADD COLUMN lastLogin TEXT');
  if (!cols.includes('loginCount')) db.exec('ALTER TABLE users ADD COLUMN loginCount INTEGER NOT NULL DEFAULT 0');

  const pcols = db.prepare('PRAGMA table_info(permintaan)').all().map((c) => c.name);
  if (!pcols.includes('pemohonUsername')) db.exec('ALTER TABLE permintaan ADD COLUMN pemohonUsername TEXT');

  const ocols = db.prepare('PRAGMA table_info(stok_opname)').all().map((c) => c.name);
  if (!ocols.includes('totalSelisihNilai')) db.exec('ALTER TABLE stok_opname ADD COLUMN totalSelisihNilai INTEGER NOT NULL DEFAULT 0');
  const oicols = db.prepare('PRAGMA table_info(stok_opname_item)').all().map((c) => c.name);
  if (!oicols.includes('harga'))        db.exec('ALTER TABLE stok_opname_item ADD COLUMN harga INTEGER NOT NULL DEFAULT 0');
  if (!oicols.includes('selisihNilai')) db.exec('ALTER TABLE stok_opname_item ADD COLUMN selisihNilai INTEGER NOT NULL DEFAULT 0');
}

// ── Seed data (sama dengan demo di app.html) ───────────────────────────
// Hanya akun admin bawaan (untuk login pertama). Username/password bisa di-override
// lewat env ADMIN_USERNAME / ADMIN_PASSWORD saat deploy (mis. di CasaOS).
const SEED_USERS = [
  {
    nama: 'Administrator',
    ruangan: 'Semua Ruangan',
    role: 'admin',
    username: (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },
];

const SEED_PERMINTAAN = [];
const SEED_PENGAJUAN = [];
const SEED_ANGGARAN = [];

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return; // sudah ada data, jangan timpa

  const insUser = db.prepare('INSERT INTO users (nama, ruangan, role, username, password) VALUES (@nama, @ruangan, @role, @username, @password)');
  const insReq  = db.prepare(`INSERT INTO permintaan (id, ruangan, tanggal, pemohon, keperluan, status, sumber, statusSerahTerima)
                              VALUES (@id, @ruangan, @tanggal, @pemohon, @keperluan, @status, @sumber, @statusSerahTerima)`);
  const insItem = db.prepare(`INSERT INTO permintaan_items (permintaanId, nama, jenis, satuan, jumlah, statusItem, harga, urutan)
                              VALUES (@permintaanId, @nama, @jenis, @satuan, @jumlah, @statusItem, @harga, @urutan)`);
  const insPO   = db.prepare(`INSERT INTO pengajuan (id, permintaanId, ruangan, tanggal, total, supplier, status, catatan)
                              VALUES (@id, @permintaanId, @ruangan, @tanggal, @total, @supplier, @status, @catatan)`);
  const insPOi  = db.prepare(`INSERT INTO pengajuan_items (pengajuanId, nama, satuan, jumlah, harga)
                              VALUES (@pengajuanId, @nama, @satuan, @jumlah, @harga)`);
  const insAng  = db.prepare('INSERT INTO anggaran (id, ruangan, bulan, nominal) VALUES (@id, @ruangan, @bulan, @nominal)');

  const tx = db.transaction(() => {
    SEED_USERS.forEach(u => insUser.run(u));
    SEED_PERMINTAAN.forEach(p => {
      insReq.run({ ...p });
      p.items.forEach((it, i) => insItem.run({
        permintaanId: p.id, nama: it.nama, jenis: it.jenis, satuan: it.satuan,
        jumlah: it.jumlah, statusItem: it.statusItem ?? null, harga: it.harga ?? 0, urutan: i,
      }));
    });
    SEED_PENGAJUAN.forEach(po => {
      insPO.run({ id: po.id, permintaanId: po.permintaanId, ruangan: po.ruangan, tanggal: po.tanggal,
        total: po.total, supplier: po.supplier, status: po.status, catatan: po.catatan });
      po.items.forEach(it => insPOi.run({ pengajuanId: po.id, nama: it.nama, satuan: it.satuan, jumlah: it.jumlah, harga: it.harga }));
    });
    SEED_ANGGARAN.forEach(a => insAng.run(a));
  });
  tx();
  console.log('[db] seed data dimuat.');
}

// CLI: `node db.js --reseed` → kosongkan & isi ulang
function reseed() {
  db.exec(`DELETE FROM stok_opname_item; DELETE FROM stok_opname; DELETE FROM stok_pemakaian; DELETE FROM stok;
           DELETE FROM dokumen; DELETE FROM pengajuan_items; DELETE FROM pengajuan;
           DELETE FROM permintaan_items; DELETE FROM permintaan; DELETE FROM anggaran; DELETE FROM users;`);
  seed();
}

init();
seed(); // idempoten — hanya mengisi bila tabel users masih kosong

if (require.main === module) {
  if (process.argv.includes('--reseed')) { reseed(); console.log('[db] reseed selesai.'); }
  else { console.log('[db] init selesai. Path:', DB_PATH); }
}

module.exports = { db, init, seed, reseed, DB_PATH };

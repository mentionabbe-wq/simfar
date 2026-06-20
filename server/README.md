# SimFar — Backend API

Backend REST untuk **SimFar (Sistem Informasi Permintaan Alkes & BMHP)** — front-end ada di `../index.html`.
Dibangun dengan **Node.js + Express + SQLite (better-sqlite3)**. Semua logika bisnis (alur status
permintaan, pembuatan PO otomatis untuk laboratorium, dan pemotongan anggaran) berjalan di server.

## Prasyarat

Mesin ini **belum memiliki Node.js**. Pasang dulu:

1. Unduh Node.js LTS (≥ 18) dari <https://nodejs.org> lalu jalankan installer.
2. Tutup & buka ulang terminal, verifikasi: `node --version`.

## Menjalankan

```bash
cd server
npm install      # memasang express, better-sqlite3, multer, cors
npm start        # menjalankan di http://localhost:3000
```

Saat pertama dijalankan, database `data/simfar.db` dibuat otomatis dan diisi data demo
yang sama dengan yang dulu di-hardcode pada `app.html`.

- Front-end : <http://localhost:3000/app.html>
- Cek API   : <http://localhost:3000/api/health>

Perintah lain:

```bash
npm run dev      # auto-restart saat file berubah (node --watch)
npm run seed     # kosongkan & isi ulang data demo (node db.js --reseed)
```

## Struktur

```
server/
├─ server.js        Express app + seluruh route REST
├─ db.js            Skema SQLite, koneksi, dan seed data demo
├─ data/simfar.db   Database (dibuat otomatis, tidak di-commit)
├─ uploads/         Berkas lampiran yang diunggah
└─ package.json
```

## Endpoint API

Semua respons berformat JSON. Base URL: `http://localhost:3000`.

### Auth / Users
| Method | Path | Keterangan |
|---|---|---|
| GET  | `/api/users` | Daftar pengguna dikelompokkan per role (untuk layar login) |
| POST | `/api/login` | Body `{ id }` atau `{ nama, role }` → data pengguna |

### Permintaan (Keperawatan / Laboratorium)
| Method | Path | Keterangan |
|---|---|---|
| GET  | `/api/permintaan` | Daftar. Filter opsional: `?ruangan=&status=&sumber=` |
| GET  | `/api/permintaan/:id` | Detail + items + dokumen + pengajuan terkait |
| POST | `/api/permintaan` | Buat baru → status `pending` |
| POST | `/api/permintaan/:id/proses` | **Farmasi** set ketersediaan stok per item; otomatis buat PO bila ada item `pengajuan` |
| POST | `/api/permintaan/:id/serah-terima` | **Farmasi** input harga & selesaikan serah terima (lab) |

Body **POST `/api/permintaan`**:
```json
{
  "ruangan": "Ruang Anggrek",
  "pemohon": "Ns. Sari Dewi, S.Kep",
  "sumber": "keperawatan",
  "keperluan": "Tambahan stok",
  "tanggal": "2026-06-20",
  "items": [{ "nama": "Spuit 3cc", "jenis": "alkes", "satuan": "pcs", "jumlah": 50 }],
  "dokumenIds": [12, 13]
}
```

Body **POST `/api/permintaan/:id/proses`**:
```json
{
  "items": [
    { "itemId": 7, "statusItem": "diberikan" },
    { "itemId": 8, "statusItem": "pengajuan" }
  ],
  "suratPesananIds": [20]
}
```
Aturan: bila ada item `pengajuan` → dibuat PO. Untuk `sumber: "laboratorium"` PO langsung
berstatus `disetujui` (tanpa lewat Keuangan); selain itu `menunggu`. Status permintaan menjadi
`diproses` (semua item perlu PO), `sebagian` (sebagian), atau `selesai` (semua tersedia).

Body **POST `/api/permintaan/:id/serah-terima`**:
```json
{ "items": [{ "itemId": 11, "harga": 850000 }] }
```
Menetapkan `statusSerahTerima = "selesai"`, `status = "selesai"`, dan mengembalikan `total`
serta `overBudget` (selisih bila melampaui anggaran).

### Pengajuan / PO (Keuangan)
| Method | Path | Keterangan |
|---|---|---|
| GET  | `/api/pengajuan` | Daftar PO. Filter: `?status=&permintaanId=` |
| GET  | `/api/pengajuan/:id` | Detail PO |
| POST | `/api/pengajuan/:id/keputusan` | **Keuangan** setujui/tolak + input harga & supplier |

Body **POST `/api/pengajuan/:id/keputusan`**:
```json
{
  "action": "disetujui",
  "supplier": "PT. Kimia Farma Trading",
  "catatan": "Pembayaran 30 hari",
  "items": [{ "itemId": 3, "harga": 18000 }]
}
```
`action: "disetujui"` mewajibkan `supplier` dan total > 0. `action: "ditolak"` tidak.

### Anggaran (Laboratorium)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/anggaran` | Daftar anggaran. Filter: `?ruangan=&bulan=` |
| GET | `/api/anggaran/usage?ruangan=&bulan=` | Ringkasan: `{ nominal, used, sisa, pct }` |
| PUT | `/api/anggaran` | Upsert `{ ruangan, bulan, nominal }` |

`used` dihitung dari total nilai (harga × jumlah) seluruh permintaan ruangan tersebut pada
bulan itu yang `statusSerahTerima = "selesai"`.

### Stok / Inventaris (khusus Laboratorium)
Stok bersifat **per ruangan**. Stok bertambah otomatis saat serah terima permintaan lab
selesai (`POST /api/permintaan/:id/serah-terima`), berkurang saat pemakaian, dan disesuaikan
saat stok opname.

| Method | Path | Keterangan |
|---|---|---|
| GET  | `/api/stok?ruangan=` | Daftar sisa stok |
| GET  | `/api/stok/pemakaian?ruangan=` | Riwayat pemakaian |
| POST | `/api/stok/pemakaian` | Catat pemakaian (mengurangi stok) |
| GET  | `/api/stok/opname?ruangan=` | Riwayat stok opname + itemnya |
| POST | `/api/stok/opname` | Simpan opname → stok sistem disesuaikan ke jumlah fisik |

Body **POST `/api/stok/pemakaian`**:
```json
{
  "ruangan": "Laboratorium Klinik",
  "tanggal": "2026-06-20",
  "pemakai": "Analis. Fitriani Amd.AK",
  "keterangan": "Pemeriksaan rutin",
  "items": [{ "stokId": 3, "jumlah": 2 }]
}
```
Ditolak (400) bila jumlah melebihi sisa stok.

Body **POST `/api/stok/opname`**:
```json
{
  "ruangan": "Laboratorium Klinik",
  "tanggal": "2026-06-20",
  "petugas": "Analis. Fitriani Amd.AK",
  "catatan": "Opname bulanan",
  "items": [{ "stokId": 3, "fisik": 8 }]
}
```
`selisih = fisik − stok sistem`. Stok sistem di-set ke `fisik`. Respons:
`{ id, disesuaikan, totalSelisih }`.

### Berkas / Lampiran
| Method | Path | Keterangan |
|---|---|---|
| POST | `/api/files` | Multipart field `files` (maks 10 MB, PDF/DOC/DOCX/JPG/PNG) → `[{ id, name, size, type }]` |
| GET  | `/api/files/:id` | Unduh berkas |

Alur: unggah berkas dulu ke `/api/files`, lalu kirim `id`-nya sebagai `dokumenIds`
(permintaan) atau `suratPesananIds` (PO) saat membuat/ memproses data.

## Catatan integrasi front-end

`app.html` saat ini menyimpan semua data di memori (objek `S`). Untuk memakai backend ini,
ganti operasi pada `S` dengan `fetch()` ke endpoint di atas — mis. `submitReq()` → `POST /api/permintaan`,
`saveProses()` → `POST /api/permintaan/:id/proses`, `keAct()` → `POST /api/pengajuan/:id/keputusan`,
`simpanSerahTerima()` → `POST /api/permintaan/:id/serah-terima`. Endpoint sudah dirancang agar
cocok 1:1 dengan fungsi-fungsi tersebut. (Penggantian itu langkah lanjutan, di luar lingkup backend ini.)
```

# SimFar — Sistem Informasi Permintaan Alkes & BMHP

Aplikasi permintaan alat kesehatan & BMHP rumah sakit, 4 peran: **Keperawatan, Laboratorium,
Farmasi, Keuangan**. Laboratorium punya **anggaran sendiri** + menu **inventaris stok**
(Sisa Stok, Pemakaian, Stok Opname).

## Login & Pendaftaran

Halaman awal punya dua tab: **Masuk** (username + password) dan **Daftar**. Pengguna baru
mendaftar dengan memilih **Bagian** (Unit / Laboratorium / Farmasi / Keuangan) dan mengisi
ruangan/unit-nya. Setelah login, pengguna **hanya melihat menu sesuai bagiannya**.

Akun demo (password `123456`): `sari` (Unit), `yusuf` (Lab), `rina` (Farmasi), `hendra` (Keuangan).
Akun **admin** yang bisa mengakses semua menu: `admin` / `admin123` (tidak bisa dibuat lewat pendaftaran).

## Cara menjalankan

Aplikasi bisa dijalankan **dua cara**. Untuk sekadar memakai/men-deploy, cara A sudah cukup
— **tanpa install apa pun**.

### A. Tanpa server (paling mudah) ✅
File `app.html` sudah **mandiri**: semua data disimpan di browser (localStorage), tanpa Node,
tanpa database, tanpa compile.

- **Coba langsung:** dobel-klik `app.html` → terbuka di browser → langsung jalan.
- **Deploy online (gratis):** unggah `app.html` (dan `index.html`) ke salah satu:
  - **Netlify Drop** — buka <https://app.netlify.com/drop>, seret folder ini ke sana. Selesai.
  - **GitHub Pages** — push folder ini ke repo GitHub, aktifkan Pages, akses `…/app.html`.
  - **Vercel / Cloudflare Pages** — pilih "static site", deploy folder ini apa adanya.

Data tersimpan per-browser. Untuk mereset ke data contoh, buka Console (F12) lalu jalankan
`resetLocalDB()` dan muat ulang, atau hapus site data.

> Catatan: di mode tanpa server, lampiran file hanya dicatat nama/ukurannya (tidak benar-benar
> diunggah/diunduh). Untuk penyimpanan file nyata + database, pakai cara B.

### B. Dengan backend Node (data tersimpan di database SQLite)
Untuk multi-user / penyimpanan terpusat. Perlu **Node.js LTS** terpasang.

```bash
cd server
npm install
npm start          # http://localhost:3000/app.html
```

`app.html` otomatis mendeteksi server saat dibuka lewat `http://localhost:3000`. Jika server
tidak ada, ia otomatis memakai mode lokal (cara A). Detail API ada di [`server/README.md`](server/README.md).

## Cara kerja deteksi mode
Saat dibuka, `app.html` melakukan probe `GET /api/health`:
- **Berhasil** → memakai backend Node (cara B).
- **Gagal** (dibuka langsung / hosting statis) → memakai mesin lokal localStorage (cara A),
  dan menampilkan notifikasi "Mode lokal aktif".

## Deploy ke CasaOS (Docker)

Image menyajikan front-end + REST API + database SQLite (data tersimpan terpusat & persisten,
dibagikan ke semua perangkat — bukan localStorage). Login awal: **admin / admin123**
(ganti lewat env `ADMIN_USERNAME` / `ADMIN_PASSWORD`).

### Cara 1 — build di server CasaOS (paling mudah)
Di CasaOS, buka **Terminal** (atau app Portainer → Stacks), lalu:
```bash
git clone https://github.com/mentionabbe-wq/simfar.git simfar
cd simfar
docker compose up -d
```
Akses: `http://IP-SERVER:3000/app.html`. CasaOS akan menampilkan kontainer `simfar`.
> Ganti port di `docker-compose.yml` bila 3000 sudah dipakai (mis. `"8095:3000"`).

### Cara 2 — image prebuilt dari GitHub (CasaOS → Custom Install)
Setelah push ke GitHub, workflow di `.github/workflows/docker-publish.yml` otomatis membangun
image multi-arch (amd64+arm64) ke **GHCR**: `ghcr.io/mentionabbe-wq/simfar:latest`. Jadikan package-nya
*public* di GitHub (tab Packages), lalu di CasaOS pilih **+ → Install a customized app** dan isi:
- **Docker Image**: `ghcr.io/mentionabbe-wq/simfar:latest`
- **Port**: host `3000` → container `3000`
- **Volume**: `/DATA/AppData/simfar/data` → `/app/server/data`, dan `.../uploads` → `/app/server/uploads`
- **Env** (opsional): `ADMIN_USERNAME`, `ADMIN_PASSWORD`

## Struktur
```
permintaan-ruangan/
├─ app.html              Aplikasi SimFar (mandiri; berisi mesin lokal + klien API server)
├─ index.html            Draf formulir peminjaman ruangan (terpisah)
├─ Dockerfile            Image untuk self-host (CasaOS)
├─ docker-compose.yml    Definisi service + volume persisten
├─ .github/workflows/    CI: build & publish image ke GHCR
└─ server/               Backend Node.js + Express + SQLite
```

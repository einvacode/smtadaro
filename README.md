# Marine CCTV Monitoring Dashboard

Platform monitoring CCTV berbasis web dengan fitur uptime monitoring, user management, dan auto-backup.

## 🚀 Instalasi Umum

### Persyaratan
- **Node.js** (v18 atau lebih baru)
- **Git** (untuk fitur update otomatis)

### Langkah Instalasi
1. Clone repository:
   ```bash
   git clone https://github.com/einvacode/smtadaro.git
   cd smtadaro
   ```
2. Install dependensi:
   ```bash
   npm install
   ```
3. Jalankan aplikasi:
   ```bash
   npm start
   ```
   Buka `http://localhost:3099` di browser Anda.

---

## 🐘 Panduan XAMPP (Windows)

Jika Anda ingin menjalankan aplikasi ini bersama XAMPP dan menggunakan Apache sebagai reverse proxy (akses via port 80):

1. Pastikan Node.js sudah terinstall di Windows.
2. Jalankan aplikasi via CMD di folder project: `npm start`.
3. Buka file konfigurasi Apache `httpd.conf` atau `httpd-vhosts.conf` di XAMPP.
4. Aktifkan modul proxy:
   ```apache
   LoadModule proxy_module modules/mod_proxy.so
   LoadModule proxy_http_module modules/mod_proxy_http.so
   ```
5. Tambahkan VirtualHost:
   ```apache
   <VirtualHost *:80>
       ServerName marine.local
       ProxyPreserveHost On
       ProxyPass / http://localhost:3099/
       ProxyPassReverse / http://localhost:3099/
   </VirtualHost>
   ```
6. Restart Apache di XAMPP Control Panel.

---

## 🛠️ Panduan Proxmox (LXC / VM)

Metode instalasi manual di Linux VM atau LXC:

1. Install Node.js & Git:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs git build-essential
   ```
2. Clone & Install sesuai langkah umum.
3. Gunakan **PM2** agar aplikasi tetap berjalan secara otomatis:
   ```bash
   sudo npm install -g pm2
   pm2 start server/index.js --name marine-cctv
   pm2 save
   pm2 startup
   ```

---

## ⚙️ Konfigurasi (.env)
Buat file `.env` di folder root:
```env
PORT=3099
# Tambahkan variabel lain jika diperlukan
```

## 🔒 Akun Default
- **Username**: `admin`
- **Password**: `admin123` (Segera ubah setelah login)

---

## 📂 Fitur Backup
File database dan backup tersimpan di folder `./data`. Pastikan folder ini memiliki izin tulis (write permission).

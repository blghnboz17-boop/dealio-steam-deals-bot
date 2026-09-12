# WSL/Linux servisi

Bu servis Bilgehan'ın Ubuntu-24.04 kurulumuna göre ayarlandı. Başka bir makinede
`dealio.service` içindeki kullanıcı, grup, proje klasörü ve Node yolunu uyarlayın.
Node 22.16 veya üstü, systemd, proje bağımlılıkları ve yerel `.env` gereklidir.
Bot proje klasöründeki `.env` dosyasını kendisi okur; gizli bilgileri servis dosyasına eklemeyin.

İlk kurulum (WSL terminalinde):

```bash
cd /home/bilgehan/code/steam-wishlist-discord-bot
npm ci
npm run build
sudo install -m 644 deploy/dealio.service /etc/systemd/system/dealio.service
sudo systemctl daemon-reload
sudo systemctl enable --now dealio
```

Güncelleme:

```bash
git pull --ff-only
npm ci
npm run build
sudo systemctl restart dealio
sudo systemctl status dealio --no-pager
```

Kayıtlar: `sudo journalctl -u dealio -n 50 --no-pager`.
Durdurma: `sudo systemctl stop dealio`.
Otomatik başlatmayı kapatma: `sudo systemctl disable --now dealio`.

Servis botu normal kullanıcı olarak çalıştırır; hata ile kapanırsa yeniden başlatır.
`.env` değişince servisi yeniden başlatın. Varsayılan tarama bekleme aralığı 30 dakikadır.
Çalışan servisin yanında ayrıca `npm start` kullanmayın; aynı veritabanı için tek bot süreci gerekir.

Bu kurulum Windows açıldığında WSL'yi başlatan bir görev oluşturmaz. Bilgisayar kapalı,
uykuda veya WSL kapatılmış durumdayken bildirim gönderilemez.
Gerçek hazır durumu `.runtime/bot.health.json` dosyasında `phase: ready` ve
`discordReady: true` ile doğrulanabilir; yalnızca systemd'nin `active` yazması
Discord bağlantısının tamamlandığını kanıtlamaz.

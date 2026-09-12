# Botu çalıştırma: Azure üretim, WSL geliştirme

## Azure'daki çalışan botu güncelleme

Üretim botu Azure sunucusunda çalışır. Windows CMD veya PowerShell'de önce:

```bash
ssh dealiobot@20.240.162.55
```

Sunucuya bağlandıktan sonra:

```bash
cd /home/dealiobot/steam-wishlist-discord-bot
git pull --ff-only
sudo systemctl stop dealio
npm ci
npm ci --prefix .opencode
npm run typecheck
npm run typecheck:handoff
npm test
npm run build
sudo systemctl start dealio
sudo systemctl status dealio --no-pager
```

Derleme veya test başarısızsa yeni sürümü başlatmadan önce hatayı giderin.
Tarama aralığı sunucudaki `.env` dosyasında `POLL_INTERVAL_HOURS=0.5` olmalıdır.
WSL'deki yerel `.env` değişikliği sunucuya kendiliğinden aktarılmaz.

**Aynı Discord bot token'ıyla Azure ve WSL kopyalarını birlikte çalıştırmayın.**
İki kopya aynı etkileşimi yanıtlamaya çalışır; panellerin bellekteki oturumları
paylaşılmadığı için yeni panel bile yanlışlıkla süresi dolmuş görünebilir.
Veritabanı kilidi yalnızca aynı makine/veritabanını korur, ayrı sunucuları korumaz.

## İsteğe bağlı yerel WSL servisi

Üretim botu Azure'da çalışırken yerel servis kapalı ve devre dışı tutulur:

```bash
sudo systemctl disable --now dealio
```

Aşağıdaki yerel servisi ancak ayrı bir test bot token'ıyla veya Azure kopyasını
bilerek durdurduktan sonra açın. Azure'daki mevcut servis dosyasını bu yerel
şablonla değiştirmeyin.

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

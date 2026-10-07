# Botu çalıştırma: Azure üretim, WSL geliştirme

## Azure'daki çalışan botu güncelleme

Üretim botu 1 GiB RAM'li Azure VM'de çalışır. **Derleme, tür kontrolü ve tam
test paketini bu VM'de çalıştırmayın.** 29 Eylül 2026 aday derlemesinde bellek
baskısı ve geçici SSH yanıtsızlığı görüldü. Derlemeyi yerelde veya CI'da üretin.

### Hazırlık: üretim dışında

1. Dağıtılacak kesin commit'i temiz bir checkout'ta seçin. `npm ci`,
   `npm run typecheck`, `npm run typecheck:scenarios`, `npm test` ve
   `npm run build` başarılı olmalı; GitHub Node 22/24 kontrollerini doğrulayın.
2. `dist` arşivi hazırlayın. Yanına kaynak commit'i, Node sürümünü,
   `package-lock.json` SHA-256 değerini ve arşivin SHA-256 değerini içeren bir
   manifest koyun. `.env`, veritabanı ve geliştirme bağımlılıklarını eklemeyin.
3. Arşivi ve manifesti SSH/SCP ile VM'de yeni bir aday klasörüne aktarın;
   aktarılan arşivin SHA-256 değerini manifestle karşılaştırın. Güvenilen kendi
   derlemenizi bu boş klasörde açın; çalışan `dist` üzerine açmayın.

### Komutlarla (7 Ekim 2026'dan beri kullanılan yol)

`main`'deki birleştirme commit'i `<sha>` (kısa) ve `<full>` (tam) olsun. Yerelde,
Git Bash'te:

```bash
git fetch origin && git worktree add --detach ../dealio-release-<sha> <full>
cd ../dealio-release-<sha> && npm ci && npm run typecheck && npm run typecheck:scenarios && npm test && npm run build
tar -czf /c/tmp/dist-<sha>.tar.gz dist
```

`tar`'a `/c/...` biçiminde yol verin; `C:/...` yazılırsa `C:` uzak sunucu sanılır.
`manifest-<sha>.json` şu alanları taşır: `sourceCommit`, `sourceTree`
(`git rev-parse HEAD^{tree}`), `builtOn`, `node`, `packageLockSha256`,
`distArchiveSha256`, `ci`, `previousCommit`, `schemaChange`. Sonra:

```bash
ssh dealiobot@20.240.162.55 'mkdir -p ~/dealio-candidate-<sha>'
scp dist-<sha>.tar.gz manifest-<sha>.json deploy/switch-release.sh dealiobot@20.240.162.55:dealio-candidate-<sha>/
```

Arşivi elle açmayın: betik SHA-256'sını doğruladığı arşivi kendisi açar ve canlıya
yalnız o kopyayı koyar.

`main` CI'ı geçtikten sonra geçiş:

```bash
ssh dealiobot@20.240.162.55 'bash ~/dealio-candidate-<sha>/switch-release.sh <sha>'
```

[`switch-release.sh`](switch-release.sh) şunları yapar:
- `origin/main`'in tree'sinin manifestle aynı olduğunu, fast-forward'u, temiz ağacı ve arşiv SHA-256'sını doğrular.
- Botu durdurur, veritabanını `~/dealio-backups/<tarih>-<sha>/` içine yedekler ve kopyada bütünlük ile yabancı anahtar kontrolü yapar.
- Git'i ilerletir, eski `dist`'i yedeğe taşır, adayı koyar ve botu başlatır.
- Yeni sürecin `.runtime/bot.health.json` kaydında `phase: ready` ve
  `discordReady: true` görünmesini bekler (varsayılan 180 sn,
  `DEALIO_SWITCH_HEALTH_TIMEOUT` ile değişir). Görünmezse ya da bir adım hata
  verirse eski commit ve `dist`'e, şema sürümü değiştiyse eski veritabanına döner,
  eski sürümü başlatır ve hata koduyla çıkar.
- `package-lock.json` değişiyorsa durur; doğrulanmış üretim bağımlılıklarını
  kurduktan sonra `DEALIO_DEPENDENCIES_READY=1` ile yeniden çalıştırın.
- Başarılı geçişten sonra 7 günden eski sürüm klasörlerindeki veritabanı
  kopyalarını siler (`dist` ve manifestler geri dönüş için kalır). Silinen
  kullanıcıların verisi bu kopyalarda kalmasın diye; silme günlüğü 35 gün tutulur.

Derlemeden sonra `main`'e yalnız belge birleştirilmişse tree farklı olacağı için betik
durur; yeni `main`'den yeniden derleyin. Ardından sağlık kaydını
(`phase: ready`, `discordReady: true`) ve günlükteki hataları kontrol edin.

Windows CMD veya PowerShell'den sunucuya bağlantı:

```bash
ssh dealiobot@20.240.162.55
```

### VM'de kısa geçiş

1. Çalışan Git revizyonunu, temiz çalışma ağacını ve taze sağlık kaydını
   doğrulayın. `git fetch` sonrası hedef commit manifestteki commit ile aynı
   olmalı. `package-lock.json` değişmemişse mevcut üretim bağımlılıkları
   kullanılabilir. Değişmişse hedef Linux/Node sürümüne uygun üretim
   bağımlılıklarını ayrı ortamda hazırlayıp adayla doğrulayın; Windows
   `node_modules` klasörünü Linux'a taşımayın. Doğrulanmış bağımlılık paketi
   hazır olmadan geçiş yapmayın.
2. Tutarlı SQLite yedeği alın ve izole geri yükleme kontrolünü doğrulayın.
   Eski commit, `dist` ve değişiyorsa bağımlılık paketini geri dönüş için saklayın.
3. Git'i doğrulanmış hedef commit'e fast-forward ilerletin. Aday derleme hazırken
   servisi durdurun; eski `dist` klasörünü yedek konuma taşıyıp aday `dist`i
   yerine koyun. Aday ve kurulu derleme dosyalarının aynı olduğunu doğrulayın.
4. Servisi başlatın ve sağlık kontrolünü tamamlayın:

```bash
cd /home/dealiobot/steam-wishlist-discord-bot
sudo systemctl start dealio
sudo systemctl status dealio --no-pager
```

`.runtime/bot.health.json` yeni başlangıca ait olmalı: `phase: ready`,
`discordReady: true` ve güncel heartbeat aranır. Gerçek menü/test DM kabulünü
ve anonim süre kayıtlarını kontrol edin. Başarısızsa servisi durdurup saklanan
derleme, bağımlılıklar ve Git revizyonuna dönün; veritabanı şeması değiştiyse
önceden doğrulanmış geri dönüş planını uygulayın. Veritabanını körlemesine eski
yedekle değiştirmek aradaki kullanıcı işlemlerini kaybedebilir.

Kayda test edilen kaynak commit'ini, dağıtılan commit'i, derleme özetini,
CI sonucunu, yedek/geri yükleme ve sağlık kanıtını yazın. Belgeler için daha
sonra gelen commit'leri derlemenin kaynak commit'iyle karıştırmayın.
Tarama aralığı sunucudaki `.env` dosyasında `POLL_INTERVAL_HOURS=0.5` olmalıdır.

**Yönetim paneli (isteğe bağlı).** Paneli açmak için sunucudaki `.env` dosyasına
en az 32 karakterlik rastgele bir `DEALIO_ADMIN_TOKEN` ekleyip servisi yeniden
başlatın. Panel yalnız `127.0.0.1:8787` adresini dinler; Azure ağ kurallarında port
açmayın. Erişim SSH tüneliyle yapılır (`scripts/admin-tunnel.ps1`). Doğrulama:
`ss -ltnp | grep 8787` çıktısı yalnız `127.0.0.1:8787` göstermelidir. Ayrıntılar:
[`docs/admin-panel.tr.md`](../docs/admin-panel.tr.md).
WSL'deki yerel `.env` değişikliği sunucuya kendiliğinden aktarılmaz.

**Aynı Discord bot token'ıyla Azure ve WSL kopyalarını birlikte çalıştırmayın.**
İki kopya aynı etkileşimi yanıtlamaya çalışır; panellerin bellekteki oturumları
paylaşılmadığı için yeni panel bile yanlışlıkla süresi dolmuş görünebilir.
Veritabanı kilidi yalnızca aynı makine/veritabanını korur, ayrı sunucuları korumaz.

### Bellek ayarları (7 Ekim 2026'da uygulandı)

VM'de yaklaşık 841 MB kullanılabilir RAM var. Bot belleği tükenirse çekirdek bir
süreci kapatır; bu ayarlar o anın botu düşürmemesi içindir:

- `/swapfile` (1 GB), `/etc/fstab` içinde kalıcı. `vm.swappiness=10`
  (`/etc/sysctl.d/90-dealio-swap.conf`): swap yalnız son çaredir. `fstab`
  yedeği: `/etc/fstab.bak-20261007`.
- `/etc/systemd/system/dealio.service.d/memory.conf`: `OOMScoreAdjust=-500`.
  Bellek tükenirse çekirdek önce diğer süreçleri kapatır. Aynı dosya `ExecStart`'ı
  `node --optimize-for-size` ile yeniden tanımlar: 200 kullanıcılık yük testinde en
  yüksek bellek 369 MB'tan 132 MB'a indi, hız ölçüm gürültüsü içinde kaldı. Boştaki
  bellek (~116 MB, çoğu yüklü kod) değişmez. Önceki hali: `memory.conf.bak-20261007`.
- Sunucuda işe yaramayan servisler kapatıldı: `fwupd` (maskelendi, `fwupd-refresh.timer`
  kapalı), `multipathd` (tek disk, multipath aygıtı yok), `ModemManager`, `udisks2`.
  Azure ajanı (`walinuxagent`), SSH ve `unattended-upgrades` açık kalır.

Geri alma: `sudo swapoff /swapfile`, `fstab` satırını sil, `sudo rm /swapfile
/etc/sysctl.d/90-dealio-swap.conf /etc/systemd/system/dealio.service.d/memory.conf`,
`sudo systemctl unmask fwupd.service` ve
`sudo systemctl enable --now multipathd.socket multipathd.service ModemManager.service udisks2.service`,
ardından `sudo systemctl daemon-reload`.

Kontrol: `free -m`, `swapon --show`, `cat /proc/$(systemctl show -p MainPID --value dealio)/oom_score_adj`
(-500 olmalı), `tr '\0' ' ' < /proc/$(systemctl show -p MainPID --value dealio)/cmdline`
(`--optimize-for-size` görünmeli). VM'de kalıcı başka araç çalıştırmak (ör. bir kod ajanı sunucusu) RAM'i
doğrudan bottan alır.

## İsteğe bağlı yerel WSL servisi

Üretim botu Azure'da çalışırken yerel servis kapalı ve devre dışı tutulur:

```bash
sudo systemctl disable --now dealio
```

Aşağıdaki yerel servisi ancak ayrı bir test bot token'ıyla veya Azure kopyasını
bilerek durdurduktan sonra açın. Azure'daki mevcut servis dosyasını bu yerel
şablonla değiştirmeyin. Şablondaki systemd sertleştirmesi (`ProtectSystem=full`,
`PrivateDevices`, `RestrictNamespaces` vb.) VM'deki servise kendiliğinden geçmez;
istenirse aynı satırlar VM'deki `/etc/systemd/system/dealio.service` dosyasına
elle eklenip `daemon-reload` ve yeniden başlatma ile denenmelidir.

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

### Silme kaydı ve kullanıcı sınırı

- `/delete-data` talepleri veritabanının yanındaki `data/deletions.jsonl`
  dosyasına (Discord kimliğinin tek yönlü özeti ve silme zamanı) yazılır ve
  35 gün tutulur. Bot her açılışta bu kayda bakarak, yedekten geri gelmiş ama
  silinmiş kullanıcıların yapılandırmalarını yeniden siler. Veritabanını
  yedekten geri yüklerken bu dosyayı **silmeyin ve üzerine yazmayın**; yalnızca
  `wishlist.db` değiştirilmelidir. Başlangıç günlüğündeki
  `Re-applied N data deletion(s)` satırı yeniden uygulanan silmeleri gösterir.
- Yeni kayıtlar `DEALIO_MAX_USERS` ile sınırlanır (varsayılan 200). Mevcut
  kullanıcılar etkilenmez; sınır dolduğunda `/setup` "beta dolu" der ve bir şey
  kaydetmez. Sınırı yalnızca üretim sunucusunda kapasite ölçümü yapıldıktan
  sonra artırın.

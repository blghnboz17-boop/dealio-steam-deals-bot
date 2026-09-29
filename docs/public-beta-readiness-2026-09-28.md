# Açık beta hazırlığı: 28 Eylül 2026 durum kaydı

Bu kayıt, yalnız belirtilen tarihte salt okunur olarak doğrulanan canlı durumu ve yerel geliştirme işini ayırır. Tarih geçtikçe canlı sonuçlar yeniden ölçülmelidir.

29 Eylül'deki dağıtım, gerçek Discord ölçümleri ve 1. aşama kabulü için [güncel kabul kaydına](phase1-acceptance.tr.md) bakın. Aşağıdaki metin 28 Eylül inceleme anının tarihsel kaydıdır.

## Doğrulanan canlı durum

- Azure VM'deki `/home/dealiobot/steam-wishlist-discord-bot` dizini `main` / `c40e3c62a81afbca231bf7a720e9d16bf99e2be0` revizyonundaydı. `dealio` servisi etkin, sağlık kaydı `phase=ready`, `discordReady=true`, `guildCount=3` idi.
- Salt okunur izleme önizlemesi üç etkin kullanıcı için son başarılı tarama yaşını yaklaşık 25 dakika, bekleyen kuyruk yaşını sıfır, yedek durumunu başarısız/eksik gösterdi. Son üç otomatik tarama günlük satırının her biri `users=3 completed=3 errors=0` bildirdi; bu, yedi günlük başarı oranı kanıtı değildir.
- `dealio-backup.timer`, `dealio-restore.timer` ve `dealio-monitor.timer` sunucuda `not-found` döndürdü. Eski yerel VM geri dönüş dizini bulunuyor; uzak felaket kurtarma yedeği sayılmaz.
- GitHub'daki public site iş akışı için çalıştırma kaydı bulunamadı. Discord Developer Portal'daki güncel yasal URL'ler bu incelemede doğrulanmadı.

## Yerel uygulama durumu

- Desktop ana çalışma ağacındaki yenileme ve bildirim değişiklikleri, kullanıcı dosyalarına dokunmadan `public-beta-readiness` adlı yalıtılmış worktree'ye taşındı. Ana çalışma ağacındaki OpenCode ve yapılandırma değişiklikleri yerinde kaldı.
- Bu worktree'ye kimliksiz Discord ilk yanıt, tarama ve DM gecikme kayıtları ile yedi günlük günlük özetleyicisi eklendi. Bunlar canlı VM'ye dağıtılmadığı sürece rapor `null` yüzdelikler verir.
- Yayın kapısı, her kapı için aynı commit'e bağlı kayıt JSON'unu ve boş olmayan artifact dosyalarını doğrular. Kayıt içeriğinin doğruluğu ve gerçek Discord kabulü ayrıca incelenmelidir.

## Sıradaki yayın kapıları

1. Geliştirme revizyonunu test edip kesin commit'e bağla; üretim dağıtımını bu commit ile eşleştir.
2. Canlıda en az yedi gün ölçüm topla; ilk yanıt, tarama, Steam hata ve anlık DM gecikmelerini incele. Geniş kullanıma geçmeden büyük wishlist ve eşzamanlı kullanıcı yükünü test et.
3. Azure kredi ve gerçek aylık maliyeti doğrula. Ardından uzak yedek, izole geri yükleme ve bağımsız alarmı kurup arızayı gerçekten tetikleyerek kanıtla.
4. Yasal/yardım sayfalarını erişilebilir HTTPS adresinde yayımla; uygulama bağlantılarını ve Türkçe/İngilizce masaüstü/mobil akışları gerçek Discord'da doğrula.
5. Yayın kanıtı kapısı geçtikten sonra onlarca kullanıcıyla kademeli betayı başlat; bir haftalık sorun ve kapasite verisine göre erişimi artır.

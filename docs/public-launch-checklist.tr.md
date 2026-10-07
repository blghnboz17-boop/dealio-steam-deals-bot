# Genel yayın kontrol listesi

Genel yayından önce bakılacak işler. 4. aşama (gerçek kullanıcı kabulü) şartı
7 Ekim 2026'da sahibin kararıyla kaldırıldı; genel yayın kararı ve davetler yalnız
sahibindir. Bu liste hiçbir kapıyı geçti saymaz.

İşaretler: **[Sahip kanıtı]** gerçek kullanıcı, gerçek cihaz veya gerçek hesapla
yapılması ve kaydedilmesi gereken iş; **[Sahip işlemi]** sahibin yapacağı ayar
veya karar; **[Kod]** kod değişikliği gerektiren iş.

## 1. Yayın kapısı (`npm run release:check`)

Yayınlanacak commit'e bağlı, her kapı için ayrı kanıt kaydı ve dosyası gerekir.
Bu kapılar o commit için çalıştırılmadan geçti sayılmaz:

- [ ] **[Sahip kanıtı]** `testBotDesktop`: ayrı test uygulamasıyla masaüstü kabulü.
- [ ] **[Sahip kanıtı]** `testBotMobile`: ayrı test uygulamasıyla mobil kabul.
- [ ] **[Sahip kanıtı]** `restoreRehearsal`: o commit için uzak yedekten geri yükleme.
- [ ] **[Sahip kanıtı]** `independentAlarm`: Healthchecks alarmının gerçekten tetiklenmesi.
- [ ] **[Sahip kanıtı]** `cleanInstall`: temiz kurulum.
- [ ] **[Sahip kanıtı]** `azureCreditVerified`: Azure for Students kredisi ve aylık
  maliyetin doğrulanması (kredi 7 Eylül 2027'de biter).
- [ ] **[Sahip işlemi]** `termsUrl`, `privacyUrl`, `supportUrl` HTTPS üzerinden açılıyor.

## 2. Yasal sayfalar ve Discord uygulaması

- [x] **[Sahip işlemi]** 7 Ekim 2026 tarihli gizlilik politikası ve koşullar
  `Publish public Dealio pages` iş akışıyla yayımlandı (7 Ekim 2026).
- [ ] **[Sahip işlemi]** Discord Developer Portal'daki Terms of Service ve Privacy
  Policy URL'lerinin yayımlanan sayfalara gittiğini doğrula.
- [ ] **[Sahip işlemi]** Politikadaki önemli değişikliğin mevcut beta kullanıcılarına
  duyurulup duyurulmayacağına karar ver. Ajan kullanıcılara kendiliğinden mesaj göndermez.
- [ ] **[Sahip işlemi]** Bot 100 sunucuya yaklaşmadan Discord uygulama doğrulamasını
  başlat; Discord doğrulanmamış botların 100'den fazla sunucuya eklenmesine izin vermez.
- [ ] **[Sahip işlemi]** Destek yolu: sitede yalnız e-posta var. Genel yayında yanıt
  süresi ve kanal (ör. destek sunucusu) belirlenmeli.

## 3. Kapasite ve işletim

- [ ] **[Sahip işlemi]** `DEALIO_MAX_USERS` (varsayılan 200) genel yayında ne olacak?
  200 kullanıcılık sentetik ölçüm var
  ([capacity-2026-10-07-200-users.json](evidence/capacity-2026-10-07-200-users.json));
  daha yüksek sınır 1 GiB VM'de yeni ölçüm ister.
- [ ] **[Sahip kanıtı]** Genel yayın sonrası ilk hafta için ilk yanıt, tarama, Steam
  hata oranı ve DM gecikmesinin yeniden ölçülmesi (`npm run metrics:report`).

## 4. Yayından önce kod değişikliği isteyen bulgular

Gizlilik politikası bunları bugünkü davranışla açıklıyor; düzeltilince politika da
güncellenmeli.

- [x] **[Kod, düzeltildi]** `deploy/switch-release.sh` her sürümde VM'de
  `~/dealio-backups/<tarih>-<sha>/wishlist.db` ve `restore-test.db` bırakıyor ve
  bunları hiç silmiyor. Silme günlüğü 35 gün sonra temizlendiği için daha eski bir
  kopyadan geri dönüş silinmiş kullanıcıyı geri getirebilir. Otomatik temizlik
  (ör. 7 gün) eklenmeli. Artık başarılı her geçişte 7 günden eski kopyalar
  siliniyor; politika güncellendi. Sürüm çıkmazsa eski kopyalar bir sonraki sürüme
  kadar kalır.
- [x] **[Kod, düzeltildi]** `/delete-data`, doğrudan mesajın `broadcast.audience` alanındaki
  alıcı kimliğini (90 gün) ve `admin_audit.target` satırlarını (1 yıl) silmiyor.
  Artık yalnız o kişiye giden mesaj siliniyor, diğer kitlelerden kimlik çıkarılıyor
  ve denetim kaydındaki kimlik hash ile değiştiriliyor; politika güncellendi.
- [x] **[Kod, düzeltildi]** Kurulumu olmayan biri `/delete-data` çalıştırınca kullanım kayıtları
  siliniyor ama ekran “veri bulunamadı” diyor ve silme günlüğüne kayıt yazılmıyor;
  yedekten dönüşte bu kayıtlar geri gelebilir. Artık her silme günlüğe yazılıyor
  ve ekran kalan kullanım kayıtlarının da silindiğini söylüyor.
- [ ] **[Kod]** VM'in genel IP adresi `scripts/admin-tunnel.ps1` ve `deploy/*.md`
  içinde yazılı. Depo özel olduğu sürece sorun değil; depo açılacaksa çıkarılmalı.

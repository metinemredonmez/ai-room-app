# Yaygın parola engel listesi (PWD, ASVS V6.2)

`common_passwords.txt`: SecLists Xato listesinden, kaynak sırası korunarak seçilmiş, 8–256 karakterlik ilk **3000
benzersiz** girdi (küçük harfe indirgenmiş). Liste sahibinin Palemi projesinden aynen alındı (6 Kasım 2026).

- Sabitlenmiş kaynak: https://raw.githubusercontent.com/danielmiessler/SecLists/c205c36a445bff37f8e58a9ec829105cd4975c58/Passwords/Common-Credentials/xato-net-10-million-passwords-100000.txt
- Kaynak commit: `c205c36a445bff37f8e58a9ec829105cd4975c58`
- Kaynak SHA-256: `1472aafa2561df5e3293aee252aee3ca660c12b399a283cf808bb01b39be388b`
- Çıktı SHA-256: `c360327001608fc6378176ac3b16e15fb3cfff0305d7f0df4175101f10e9cc62`
- Lisans: MIT, Daniel Miessler 2018 (`SecLists-LICENSE.txt`)

Karşılaştırma büyük/küçük harf duyarsızdır; kullanıcının parolası değiştirilmez. Türkçe ve klavye örüntüleri
`src/auth/password-policy.ts` içinde ayrıca tutulur. Dosya eksik ya da 3000 girdiden azsa API başlamaz (fail-closed).
Çalışma anında hiçbir dış servise parola gönderilmez. Bu küme bütün sızmış parolaları kapsamaz.

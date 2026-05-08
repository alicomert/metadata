# Metadata Silici

GitHub Pages uzerinde calisan statik metadata temizleme araci.

## Ozellikler

- JPG, JPEG, PNG ve WebP fotograflarda metadata bloklarini temizler.
- MP4, MOV, M4V, WebM ve MKV videolari tarayici icinde FFmpeg ile stream-copy remux yaparak temizler.
- Dosyalar sunucuya yuklenmez; islem kullanicinin tarayicisinda yapilir.
- Fotograflar yeniden sikistirilmaz, videolar yeniden encode edilmez.

## Kullanim

`index.html` dosyasi GitHub Pages kok dizininden dogrudan calisir.

## Test

```bash
npm test
```

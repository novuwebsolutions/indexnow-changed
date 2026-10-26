# indexnow-changed

Saadab pärast iga deploy'd IndexNow'le ainult need lehed, mis staatilisel saidil päriselt muutusid. IndexNow kaudu jõuab teade Bingi ja teiste IndexNow'd kasutavate otsingumootoriteni (Yandex, Seznam, Naver, Yep). Bing on oluline ka AI-otsingu jaoks: Microsoft Copilot ja DuckDuckGo toetuvad selle indeksile.

Tegime selle oma kodulehe [novu.ee](https://novu.ee) jaoks (Astro, Cloudflare) ja avaldame, sest sama mure on igal staatilisel saidil: sitemap üksi jõuab Bingi aeglaselt ja kõigi lehtede uuesti saatmine iga deploy järel on IndexNow reeglite vastu.

*English below.*

## Kuidas see töötab

1. Loeb ehitatud saidi kaustast (`dist`) sitemapi ja leiab iga lehe HTML-faili.
2. Arvutab igale lehele räsi ainult lehe enda sisust: pealkiri, kirjeldus, canonical, keelelingid ja `<main>`. Menüü, jalus ja koodipakettide räsiga failinimed (`/_astro/…`, `/assets/…`) ei loe, nii et jaluse muutus ei saada kõiki lehti uuesti.
3. Võrdleb eelmise õnnestunud saatmisega ja saadab ainult uued, muutunud ja sitemapist kadunud aadressid.
4. Kontrollib enne saatmist, et võtmefail `https://teie.sait/<võti>.txt` on päriselt üleval, ja jätab saatmise meelde ainult vastuse 200 või 202 korral.

## Kasutamine

Lisa saidile võtmefail (näiteks `public/<võti>.txt`, sisuks ainult võti) ja käivita pärast deploy'd:

```bash
npx github:novuwebsolutions/indexnow-changed --site https://teie.sait --key <võti> --dist dist
```

Näiteks `package.json`-is:

```json
"deploy": "astro build && wrangler deploy && indexnow-changed --site https://teie.sait --key <võti> --dist dist/client"
```

| Valik | Mida teeb |
|---|---|
| `--site` | saidi aadress (või `INDEXNOW_SITE`) |
| `--key` | IndexNow võti (või `INDEXNOW_KEY`) |
| `--dist` | ehitatud saidi kaust, vaikimisi `dist` |
| `--dry` | näitab, mida saadetaks, ja ei saada midagi |
| `--all` | saadab kõik sitemapi aadressid |
| `--memory` | kus hoida eelmise saatmise räsisid (vaikimisi `~/.cache/indexnow/<host>.json`) |

Esimesel käivitusel saadetakse kõik aadressid. IndexNow lubab seda üks kord, näiteks uue saidi või kolimise järel. Edaspidi lähevad ainult muutunud lehed.

Google IndexNow'd ei kasuta. Google'i jaoks jääb sitemap ja Search Console.

## Testid

```bash
npm test
```

---

## English

Sends only the pages of a static site that actually changed to IndexNow after each deploy (Bing, Yandex, Seznam, Naver, Yep). It hashes each page's own content (title, description, canonical and language links, `<main>`), ignores menus, footers and hashed bundle names, compares with the last accepted submission, checks that the key file is live, and remembers a submission only on a 200 or 202. No dependencies, Node 18+.

```bash
npx github:novuwebsolutions/indexnow-changed --site https://your.site --key <key> --dist dist --dry
```

Made by [Novu Web Solutions](https://novu.ee), a web studio in Viljandi, Estonia, for our own Astro site on Cloudflare. MIT licence.

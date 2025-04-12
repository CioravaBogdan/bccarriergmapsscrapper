# Google Maps Advanced Scraper

Acesta este un actor Apify pentru extragerea datelor din Google Maps, capabil să extragă detalii despre locații/afaceri prin căutare după cuvinte cheie, locații sau coordonate geografice specifice.

## Funcționalități

- **Căutare flexibilă**: Caută după cuvinte cheie, locații sau coordonate geografice
- **Extragerea datelor detaliate**: Nume, adresă, telefon, website, coordonate geografice
- **Procesare URL-uri**: Suport pentru URL-uri directe către afaceri sau pagini de căutare
- **Control al costurilor**: Limitare opțională a numărului de rezultate pentru a controla costurile
- **Suport pentru review-uri**: Extrage opțional recenziile și informații despre utilizatorii care le-au lăsat
- **Proxy rotativ**: Utilizează Apify Proxy pentru a evita blocările și limitările

## Parametri de intrare

| Parametru | Tip | Descriere |
|-----------|-----|-----------|
| `startUrls` | Array | Lista de URL-uri Google Maps pentru extragere directă. Lasă gol pentru a folosi parametrii de căutare. |
| `search` | String | Termenul de căutare pe Google Maps (ex: "restaurante", "hoteluri", "cafenele"). |
| `searchLocation` | String | Locația în care să se caute (ex: "Bacău", "București", "Cluj"). |
| `latitude` | Number | Coordonata de latitudine pentru căutare în zonă (ex: 46.5654079). |
| `longitude` | Number | Coordonata de longitudine pentru căutare în zonă (ex: 26.9169387). |
| `searchRadius` | Number | Raza în kilometri în jurul coordonatelor specificate (aplicabil doar când sunt specificate coordonatele). |
| `maxItems` | Number | Numărul maxim de rezultate de extras. 0 = fără limită. |
| `language` | String | Limba în care să se extragă datele (ex: "ro", "en"). |
| `includeReviews` | Boolean | Dacă să se extragă și recenziile afacerilor. |
| `maxReviews` | Number | Numărul maxim de recenzii de extras per afacere. 0 = toate disponibile. |
| `includeReviewerInfo` | Boolean | Dacă să se extragă și informațiile despre utilizatorii care au lăsat recenzii. |
| `maxCostPerRun` | Number | Costul maxim estimat per rulare. 0 = fără limită. |

## Exemple de utilizare

### 1. Căutare după cuvinte cheie într-o locație:

```json
{
  "search": "fabrica",
  "searchLocation": "bacau",
  "language": "ro",
  "maxItems": 10
}
```

### 2. Căutare după cuvinte cheie și coordonate:

```json
{
  "search": "restaurante",
  "latitude": 46.5654079,
  "longitude": 26.9169387,
  "searchRadius": 5,
  "language": "ro",
  "maxItems": 20
}
```

### 3. Extragere de la URL-uri specifice:

```json
{
  "startUrls": [
    {
      "url": "https://www.google.com/maps/place/Restaurant+Casa+Noastr%C4%83+Bac%C4%83u/@46.5654079,26.9169387,15z"
    }
  ],
  "includeReviews": true,
  "maxReviews": 50,
  "language": "ro"
}
```

## Format date rezultate

```json
{
  "scrapedUrl": "https://www.google.com/maps/place/...",
  "name": "Numele afacerii",
  "category": "Categoria afacerii",
  "address": "Adresa completă",
  "phone": "+40 123 456 789",
  "website": "https://website.com",
  "googleUrl": "https://www.google.com/maps/place/...",
  "placeId": "ID-ul Google Places",
  "coordinates": {
    "lat": 46.1234567,
    "lng": 27.1234567
  },
  "openingHoursStatus": "Deschis",
  "reviews": [
    {
      "name": "Nume utilizator",
      "rating": 5,
      "date": "acum o lună",
      "text": "Textul recenziei..."
    }
  ]
}
```

## Instalare și rulare locală

1. Clonează repository-ul:
```
git clone https://github.com/CioravaBogdan/bccarriergmapsscrapper.git
```

2. Instalează dependențele:
```
npm install
```

3. Rulează scraper-ul:
```
npm start
```

## Repository GitHub

Repository-ul este disponibil la: [https://github.com/CioravaBogdan/bccarriergmapsscrapper](https://github.com/CioravaBogdan/bccarriergmapsscrapper)

## Note

- Acest actor este proiectat pentru a rula pe platforma Apify
- Respectă termenii și condițiile Google Maps
- Utilizează un proxy pentru a evita rate limiting
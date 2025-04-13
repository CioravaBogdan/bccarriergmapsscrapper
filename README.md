# Google Maps Advanced Scraper

![Apify Actor](https://img.shields.io/badge/Powered%20by-Apify-blue)
![Version](https://img.shields.io/badge/version-1.0.0-green)

**Extrage date despre afaceri și locații din Google Maps cu opțiuni avansate de căutare și filtrare.**

## 🌟 Funcționalități

- **Căutări multiple** - Rulează mai multe căutări cu termeni diferiți într-o singură execuție
- **Căutare geografică** - Definește zone exacte de căutare folosind coordonate și rază
- **Căutare după adresă** - Găsește afaceri într-o anumită locație specificată ca text
- **Extragere date complete** - Nume, adresă, telefon, website, coordonate, orare, recenzii
- **Extragere imagini** - Descarcă fotografii ale afacerilor (opțional)
- **Extragere recenzii** - Colectează recenziile clienților cu opțiuni de sortare
- **Extragere contacte** - Descoperă emailuri și profiluri sociale din website-uri
- **Control al costurilor** - Limitează numărul de rezultate pentru a optimiza costurile

## 📊 Rezultate

Datele extrase includ:

- Informații de bază: nume, categorie, adresă, telefon, website
- Coordonate geografice exacte
- Recenzii și rating-uri ale clienților
- Imagini ale afacerii
- Programe de funcționare
- Contacte: email (extras din website), profiluri sociale
- URL-uri și ID-uri Google Maps

## 📋 Exemplu de input

### Căutare după cuvinte cheie în România:

```json
{
  "searchTab": {
    "searchStringsArray": [
      "producator echipamente industriale",
      "exportator produse agricole",
      "fabrica de mobila"
    ],
    "searchLocation": "Romania"
  },
  "limitTab": {
    "maxCrawledPlacesPerSearch": 50,
    "maxCrawledPlaces": 150
  }
}
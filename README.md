# Google Maps Advanced Scraper (Apify Actor)

![Version](https://img.shields.io/badge/version-0.1.0-blue) ![Apify Actor](https://img.shields.io/badge/Powered%20by-Apify-blueviolet)

**Extract comprehensive data about businesses and locations from Google Maps, including contact details, social media profiles, reviews, images, and more, with advanced search options and cost control.**

This Apify actor automates the process of searching Google Maps and scraping detailed information about places found. It can handle multiple search queries, specific geographic areas, or direct place URLs. It also includes an optional feature to visit the place's website to extract additional contact information like emails and social media links, and even attempts to identify contact persons (experimental).

## ✨ Key Features

*   **Multiple Search Methods**:
    *   Search by keywords combined with a location name (e.g., "restaurants in New York").
    *   Search by keywords within a specific geographic area (latitude, longitude, radius).
    *   Extract data directly from a list of Google Maps place URLs.
*   **Comprehensive Data Extraction**:
    *   **Basic Info**: Name, category, address, phone, website, status (Open/Closed).
    *   **Location**: GPS coordinates, Plus Code.
    *   **Ratings & Reviews**: Average rating, review count, individual reviews (text, author, date, rating).
    *   **Images**: URLs of place photos.
    *   **Opening Hours**: Current status and full weekly schedule (requires detail page scraping).
    *   **Website Contact Extraction**: Emails, social media profiles (Facebook, LinkedIn, Twitter/X, Instagram, etc.), and experimental contact person identification (name, title) scraped from the place's website.
*   **Advanced Configuration**:
    *   Language selection for Google Maps interface and results.
    *   Proxy configuration (Apify Proxy recommended, including residential IPs).
    *   Limits on the number of places per search and total places per run.
    *   Limits on the number of images and reviews per place.
    *   Review sorting options.
*   **Cost Control**:
    *   `costOptimizedMode` for significantly cheaper runs (limits data points, disables website scraping).
    *   Option to set a maximum estimated cost (`maxCostPerRun`) for the run.
    *   Option to explicitly skip website contact extraction.
    *   Option to skip permanently closed places.

## ⚙️ How It Works

1.  **Input Processing**: The actor takes your search criteria (keywords, location, coordinates, URLs) and configuration options.
2.  **Request Generation**: It generates initial Google Maps search URLs or uses the provided place URLs.
3.  **Crawling (Puppeteer)**: It uses the Apify SDK and Puppeteer (a headless Chrome browser) to open Google Maps pages.
    *   It handles cookie consent banners and basic anti-blocking measures using Apify's fingerprinting and session pool features.
4.  **Search Results**: For search queries, it scrolls down the results page to load more places and extracts links to individual place detail pages.
5.  **Detail Page Scraping**: It visits each place's detail page (unless disabled) to extract comprehensive information like reviews, images, opening hours, etc.
6.  **Website Contact Extraction (Optional)**: If enabled (`scrapeContacts: true` and not overridden by cost optimization), it navigates to the place's website in a new browser page.
    *   It scans the main page and potentially linked "Contact" or "About" pages (based on `maxDepth`) for emails, phone numbers, social media links, and contact person details.
    *   It uses resource blocking to speed up website loading and reduce costs.
7.  **Cost Estimation**: Throughout the run, it estimates the cost based on actions performed (places scraped, details extracted, contacts attempted) and can stop automatically if `maxCostPerRun` is exceeded.
8.  **Data Output**: The extracted data for each valid place is saved to the Apify dataset in JSON format.

## 🚀 How to Use

You can run this actor either through the Apify Console UI or programmatically using the Apify API.

### 1. Using Apify Console UI

Navigate to the actor's page in the Apify Console and click "Run". Configure the input fields in the UI:

*   **Search Terms (`searchStringsArray`)**: List of keywords (e.g., `["restaurants", "hotels", "plumbers"]`).
*   **Location (`searchLocation`)**: Geographic area for the search (e.g., `"London, UK"`).
*   **Custom Geolocation (`customGeolocation`)**: Precise coordinates and radius (e.g., `{ "coordinates": [-74.006, 40.7128], "radiusKm": 5 }`). *Overrides `searchLocation` if provided.*
*   **Start URLs (`startUrls`)**: List of specific Google Maps URLs (search or place URLs) to scrape directly.
*   **Max Places per Search (`maxCrawledPlacesPerSearch`)**: Limit results for each keyword search (0 = unlimited).
*   **Max Total Places (`maxCrawledPlaces`)**: Overall limit for the entire run (0 = unlimited).
*   **Max Images (`maxImages`)**: Max images per place (0 = none).
*   **Max Reviews (`maxReviews`)**: Max reviews per place (0 = none).
*   **Sort Reviews By (`reviewsSort`)**: How to sort reviews (`relevance`, `newest`, `highest`, `lowest`).
*   **Language (`language`)**: Google Maps interface language code (e.g., `en`, `es`, `de`, `ro`).
*   **Scrape Place Detail Page (`scrapePlaceDetailPage`)**: If disabled, only data from the search results page is extracted (faster, cheaper).
*   **Skip Closed Places (`skipClosedPlaces`)**: Ignore places marked "Permanently closed".
*   **Extract Contacts from Website (`scrapeContacts`)**: Enable/disable visiting websites for contacts.
*   **Contact Extraction Depth (`maxDepth` - *Implicit Option*)**: Controls how many pages (main, contact, about) are checked on the website (default is 1: main + contact). *Currently configured within `extract-contact.js`, consider adding to INPUT_SCHEMA if needed.*
*   **Cost Optimized Mode (`costOptimizedMode`)**: Reduces features for lower cost.
*   **Max Cost per Run (`maxCostPerRun`)**: Budget limit in USD (0 = unlimited).
*   **Skip Website Contact Extraction (`skipContactExtraction`)**: Force disable contact extraction.
*   **Proxy Configuration (`proxyConfig`)**: Configure Apify Proxy (Residential IPs recommended for best results).

### 2. Using Apify API

You can run the actor and pass the input configuration as a JSON object via the API.

**API Endpoint:**

```
Replace `YOUR_USERNAME` with your Apify username and `YOUR_APIFY_TOKEN` with your API token.

**Method:** `POST`

**Body (JSON Input):**

```json
{
  "searchStringsArray": ["string"], // Keywords to search for
  "searchLocation": "string",      // Location name (e.g., "Paris, France")
  "customGeolocation": {           // Precise coordinates and radius
    "type": "Point",
    "coordinates": [longitude, latitude], // e.g., [2.3522, 48.8566]
    "radiusKm": "number"           // e.g., 10
  },
  "startUrls": ["string"],         // Direct Google Maps URLs
  "maxCrawledPlacesPerSearch": "number", // Limit per keyword (0=unlimited)
  "maxCrawledPlaces": "number",      // Total limit for the run (0=unlimited)
  "maxImages": "number",             // Max images per place (0=none)
  "maxReviews": "number",            // Max reviews per place (0=none)
  "reviewsSort": "string",         // "relevance", "newest", "highest", "lowest"
  "language": "string",            // Language code (e.g., "en", "de")
  "scrapePlaceDetailPage": "boolean",// Scrape details like reviews/images? (default: true)
  "skipClosedPlaces": "boolean",     // Skip permanently closed places? (default: false)
  "scrapeContacts": "boolean",       // Scrape website for contacts? (default: true)
  "costOptimizedMode": "boolean",    // Enable low-cost mode? (default: false)
  "maxCostPerRun": "number",         // Max estimated cost in USD (0=unlimited)
  "skipContactExtraction": "boolean",// Force disable contact scraping? (default: false)
  "proxyConfig": {                 // Proxy settings
    "useApifyProxy": "boolean",      // Use Apify Proxy? (default: true)
    "apifyProxyGroups": ["string"],  // Proxy groups (e.g., ["RESIDENTIAL"])
    "apifyProxyCountry": "string"    // Specific country (e.g., "US")
  }
}
```
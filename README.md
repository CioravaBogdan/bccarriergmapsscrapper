# Google Maps Advanced Scraper

This Apify actor scrapes detailed information about businesses from Google Maps, including contact details, reviews, and more. It can optionally visit the business's website to find email addresses and social media profiles.

## Features

*   Scrapes business name, address, phone, website, category, rating, review count, opening hours, coordinates, etc.
*   Optionally scrapes detailed user reviews, including text, rating, date, and owner replies.
*   Optionally visits the listed website to find email addresses and social media links (Facebook, Instagram, Twitter, LinkedIn).
*   Supports starting from specific Google Maps URLs or performing a new search.
*   Uses Apify SDK with Puppeteer for robust browser automation.
*   Configurable proxy support (Apify Proxy recommended).
*   Limits for maximum items and maximum reviews per place.
*   Basic cost control estimation.
*   Handles retries and logs errors.

## Input Schema

See `INPUT_SCHEMA.json` for detailed input parameters and descriptions. Key inputs include:

*   `startUrls`: List of Google Maps URLs to scrape directly.
*   `search` / `searchLocation`: Keywords and location for a new search.
*   `maxItems`: Maximum number of places to scrape.
*   `includeReviews`: Boolean flag to enable review scraping.
*   `maxReviews`: Maximum number of reviews per place.
*   `proxyConfig`: Proxy settings.

## Output

The actor outputs data for each scraped place into the default Apify dataset. Each item includes the fields extracted from Google Maps and potentially the website (email, socialProfiles).

Example Output Item:

```json
[
  {
    "name": "Restaurant Exemplu",
    "category": "Restaurant",
    "address": "Strada Exemplu 123, București",
    "phone": "+40 123 456 789",
    "website": "https://www.exemplu.ro",
    "googleUrl": "https://www.google.com/maps/place/...",
    "placeId": "ChIJ...",
    "coordinates": { 
      "lat": 44.4268, 
      "lng": 26.1025 
    },
    "rating": 4.5,
    "reviewCount": 150,
    "openingHoursStatus": "Deschis ⋅ Se închide la 22:00",
    "plusCode": "8GFQ2X4R+M8",
    "status": "Operațional",
    "imageUrls": ["https://lh5..."],
    "reviews": [
      {
        "reviewId": "abc123",
        "text": "Mâncare excelentă!",
        "rating": 5,
        "relativeDate": "acum o lună",
        "reviewerName": "Ion P.",
        "ownerReply": "Vă mulțumim!",
        "ownerReplyRelativeDate": "acum 3 săptămâni"
      }
    ],
    "email": "contact@exemplu.ro",
    "socialProfiles": {
      "facebook": "https://www.facebook.com/exemplu",
      "instagram": "https://www.instagram.com/exemplu"
    },
    "scrapedUrl": "https://www.google.com/maps/place/..."
  }
]
```

## Running Locally (Docker)

1.  Build the Docker image: `docker build -t gmaps-scraper .`
2.  Prepare an `input.json` file in `./apify_storage/input.json`.
3.  Run the container:
    ```bash
    docker run --rm -v ./apify_storage:/app/apify_storage gmaps-scraper
    ```
    *(Note: Apify SDK v3+ uses `apify_storage` by default. Adjust volume mount if needed based on SDK version or local setup)*
    Results will be in `./apify_storage/datasets/default`.

## Running on Apify Platform

1.  Install Apify CLI: `npm install -g apify-cli`
2.  Login: `apify login`
3.  Push the actor: `apify push`
4.  Run the actor from the Apify Console or via API, providing the necessary input.

## Notes

*   Google Maps frequently changes its layout. Selectors in the code might need updates.
*   Scraping Google Maps can lead to IP blocks or CAPTCHAs. Using high-quality proxies (like Apify Residential Proxies) is highly recommended.
*   Be mindful of Google's Terms of Service and data privacy regulations (like GDPR) when scraping and using the data, especially reviewer information.

## Legal & Ethical Considerations

### Terms of Service Compliance
This scraper interacts with Google Maps in a way that may not comply with Google's Terms of Service. Using this tool for commercial purposes may violate these terms. It is provided for educational purposes only. Users are responsible for ensuring their usage complies with all applicable terms and conditions.

### Data Privacy & GDPR
* This scraper can collect business information and optionally reviewer data from Google Maps.
* If you enable the `includeReviewerInfo` option, be aware that you may be collecting personal data subject to GDPR and other privacy regulations.
* If you plan to store or process data from EU citizens:
  * Ensure you have a legal basis for processing this data
  * Implement data minimization principles
  * Provide a way for individuals to request removal of their data
  * Document your data processing activities

### Rate Limiting & Site Impact
* The scraper includes basic rate limiting and randomized delays to minimize impact on Google's servers.
* Be responsible with your scraping frequency and volume.
* Consider using the maxItems and maxCostPerRun parameters to limit your scraper's footprint.

### Opt-Out Implementation
If you're building a service using this data, consider implementing:
* Clear data removal processes
* Privacy policy explaining data sources
* Contact information for removal requests
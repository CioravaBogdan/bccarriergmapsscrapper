// Importăm SDK-ul Apify și extragem utilitarele necesare
const Apify = require('apify');
const { log } = Apify.utils;  // utilitar pentru logging unificat
// Importăm funcția auxiliară pentru extragerea contactelor (dacă există)
// const { extractContactDetails } = require('./utils/extract-contact'); // Comentat - activați dacă creați fișierul utils

// Randomized delay function to mimic human behavior
const randomDelay = async (min = 2000, max = 5000) => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    log.debug(`Waiting for random delay of ${delay}ms`);
    await new Promise(resolve => setTimeout(resolve, delay));
};

Apify.main(async () => {
    // 1. Citirea input-ului și definirea parametrilor cu valori implicite
    log.info('Reading input...');
    const input = await Apify.getInput();
    const {
        startUrls = [],            // Listă de URL-uri Google Maps de pornire (opțional, poate conține căutări sau locuri individuale)
        search,                    // Termenul de căutare (cuvinte cheie pentru afaceri)
        searchLocation,            // Locația (oraș, zonă) unde să caute
        language = 'ro',           // Limba interfeței Google Maps (afectează anumite date, ex: "Deschis acum")
        maxItems = 0,              // Număr maxim de companii de extras (0 înseamnă nelimitat)
        includeReviews = false,    // Dacă să extragă și recenziile pentru fiecare locație
        maxReviews = 0,            // Număr maxim de recenzii per locație (0 = toate)
        includeReviewerInfo = false, // Dacă extrage detalii despre recenzenți (nume, profil) – atenție la GDPR (Not implemented in this example)
        maxCostPerRun = 0,         // Cost maxim per rulare (USD) – 0 înseamnă fără limită specifică (Control logic implemented)
        proxyConfig = input.proxyConfig || {
            useApifyProxy: true,
            apifyProxyGroups: ['RESIDENTIAL'], // Request residential IPs specifically
            countryCode: 'US'  // Optionally set country code for geo-targeted results
        }
    } = input;

    // Validare input minim necesar
    if (!startUrls.length && (!search || !searchLocation)) {
        throw new Error('Input error: You must provide either "startUrls" or both "search" and "searchLocation".');
    }

    // 2. Configurare Proxy
    log.info('Configuring proxy with residential IPs...');
    const proxyConfiguration = await Apify.createProxyConfiguration(proxyConfig);
    if (!proxyConfiguration) {
        log.warning('Proxy configuration failed. Continuing without proxy, risk of blocking is high.');
    } else {
        log.info('Proxy configured successfully.');
    }

    // 3. Inițializare coadă de URL-uri (RequestQueue)
    log.info('Initializing request queue...');
    const requestQueue = await Apify.openRequestQueue();
    let initialRequestCount = 0;
    if (startUrls.length > 0) {
        // Adăugăm URL-urile de start direct din listă
        for (const urlEntry of startUrls) {
            const req = typeof urlEntry === 'string' ? { url: urlEntry } : urlEntry;
            req.userData = req.userData || {};
            if (!req.userData.label) {
                req.userData.label = req.url.includes('/search') ? 'SEARCH' : 'DETAIL';
            }
            log.info(`Adding start URL: ${req.url} (Label: ${req.userData.label})`);
            await requestQueue.addRequest(req);
            initialRequestCount++;
        }
    } else {
        // Construiește URL-ul de căutare dacă nu avem startUrls
        if (startUrls.length === 0 && search) {
            log.info('No start URLs provided, generating from search parameters.');
            const searchTermEncoded = encodeURIComponent(search);
            const locationEncoded = searchLocation ? encodeURIComponent(searchLocation) : '';
            let searchUrl = `https://www.google.com/maps/search/${searchTermEncoded}/`;
            
            if (locationEncoded) {
                searchUrl += `@${locationEncoded}`;
            }
            
            log.info(`Adding search URL: ${searchUrl}`);
            await requestQueue.addRequest({ 
                url: searchUrl, 
                userData: { label: 'SEARCH', search, searchLocation } 
            });
            initialRequestCount++;
        }
    }
    log.info(`Request queue initialized with ${initialRequestCount} request(s).`);

    // Counter for scraped items
    let scrapedItemsCount = 0;
    const state = await Apify.getValue('STATE') || { scrapedItemsCount: 0 };
    scrapedItemsCount = state.scrapedItemsCount;

    // 4. Inițializare crawler Puppeteer
    log.info('Initializing PuppeteerCrawler...');
    const crawler = new Apify.PuppeteerCrawler({
        requestQueue,
        proxyConfiguration,
        maxConcurrency: 1, // Reducem la 1 pentru debugging
        maxRequestRetries: 3,
        navigationTimeoutSecs: 120,
        
        // Eliminăm complet configurația launchContext și folosim browserPoolOptions
        browserPoolOptions: {
            // Configurare minimală
            useFingerprints: false,
            preLaunchHooks: [],
            postLaunchHooks: [],
            prePageCreateHooks: [],
            postPageCreateHooks: [],
        },
        
        // Eliminăm configurațiile avansate pentru moment
        useSessionPool: false, // Dezactivăm session pool temporar
        persistCookiesPerSession: false, // Dezactivăm persistența cookie-urilor

        // Restul metodelor de handler rămân la fel
        handlePageFunction: async ({ page, request }) => {
            const { label } = request.userData;
            log.info(`Processing ${request.url} (Label: ${label})`);

            // Check for consent screen / CAPTCHA early
            try {
                // A common selector for consent buttons
                const consentButtonSelector = 'button[aria-label*="Accept all"], button[aria-label*="Agree"]';
                const consentButton = await page.$(consentButtonSelector);
                if (consentButton) {
                    log.info('Consent screen detected, attempting to click Accept button.');
                    await page.click(consentButtonSelector);
                    await page.waitForTimeout(2000); // Wait for potential redirect/reload
                }
                 // Add CAPTCHA detection/handling if necessary (complex, often requires external services or session rotation)
                 const isCaptcha = await page.$('iframe[src*="recaptcha"]');
                 if (isCaptcha) {
                     log.warning(`CAPTCHA detected on ${request.url}. Retrying request might help.`);
                     session.retire(); // Retire the session to get a new IP/cookies
                     throw new Error('CAPTCHA detected');
                 }

            } catch (e) {
                 log.warning(`Error during pre-processing (consent/captcha check): ${e.message}`);
                 // Decide if we should throw to retry or just log
                 if (e.message.includes('CAPTCHA')) {
                     throw e; // Throw to trigger retry with new session
                 }
            }


            if (label === 'SEARCH') {
                log.info(`Processing search results for: "${request.userData.search}" in ${request.userData.searchLocation || 'specified area'}...`);

                // Wait for results container, more robust selector
                const resultsSelector = 'div[role="feed"] > div > div[role="article"]'; // div[role=feed] contains the scrollable list
                try {
                    await page.waitForSelector(resultsSelector, { timeout: 30000 }); // Increased timeout
                    log.info('Search results container found.');
                } catch (e) {
                    log.warning(`Could not find search results container (${resultsSelector}) on ${request.url}. Page might be empty or layout changed.`);
                    // Check for "No results found" message
                    const noResults = await page.evaluate(() => document.body.innerText.includes("No results found"));
                    if (noResults) {
                        log.info(`No results found for the search on ${request.url}`);
                        return; // No need to proceed
                    }
                    // If not "No results", maybe layout changed or blocked
                    throw new Error(`Failed to load search results container: ${e.message}`);
                }

                // Scroll down to load more results (basic implementation)
                // A more robust implementation would check scroll height and loop
                await page.evaluate(async () => {
                    const feed = document.querySelector('div[role="feed"]');
                    if (feed) {
                        for (let i = 0; i < 5; i++) { // Scroll down a few times
                            feed.scrollTop = feed.scrollHeight;
                            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for load
                        }
                    }
                });
                log.info('Scrolled down search results page.');


                // Extragere rezultate folosind DOM (more reliable than internal state)
                const places = await page.evaluate((selector) => {
                    const results = [];
                    const placeElements = document.querySelectorAll(selector);
                    placeElements.forEach(el => {
                        const linkElement = el.querySelector('a[href*="/maps/place/"]');
                        const url = linkElement ? linkElement.href : null;
                        if (url) {
                            const titleElement = el.querySelector('div.fontHeadlineSmall'); // Common selector for title
                            const title = titleElement ? titleElement.textContent.trim() : null;
                            // Extract Place ID from URL if possible
                            let placeId = null;
                            const placeIdMatch = url.match(/!1s([^!]+)/); // Regex to find Place ID pattern in URL
                            if (placeIdMatch && placeIdMatch[1]) {
                                placeId = placeIdMatch[1];
                            }
                            results.push({ title, url, placeId });
                        }
                    });
                    return results;
                }, resultsSelector);

                log.info(`Found ${places.length} potential places on the current page.`);

                if (places.length === 0) {
                    log.warning('No place URLs extracted from the search results page. Check selectors.');
                }

                let enqueuedCount = 0;
                for (const place of places) {
                    // Check maxItems limit before enqueueing
                    if (maxItems > 0 && scrapedItemsCount + enqueuedCount >= maxItems) {
                        log.info(`maxItems limit (${maxItems}) reached. Stopping enqueueing.`);
                        break;
                    }
                     // Check maxCost limit (simplified check)
                     if (maxCostPerRun > 0) {
                         const estimatedCost = 0.007 + (scrapedItemsCount + enqueuedCount) * 0.004; // Base + per place cost
                         if (estimatedCost >= maxCostPerRun) {
                             log.info(`Estimated cost ($${estimatedCost.toFixed(3)}) reached maxCostPerRun ($${maxCostPerRun}). Stopping enqueueing.`);
                             break;
                         }
                     }

                    if (place.url) {
                        // Check if URL already processed or enqueued to avoid duplicates
                        // Note: Apify's RequestQueue handles this automatically if keepUrlFragment is false (default)
                        await requestQueue.addRequest({
                            url: place.url,
                            userData: { label: 'DETAIL', placeName: place.title || place.placeId || 'Unknown Place' }
                        });
                        enqueuedCount++;
                    }
                }
                log.info(`Enqueued ${enqueuedCount} detail page requests.`);

                // Check if we need to paginate (find next page button)
                // Pagination logic is complex on Maps, often infinite scroll is used.
                // The scrolling implemented above is a basic form. A robust solution
                // might need to detect the end of results or handle explicit "Next" buttons if they appear.


            } else if (label === 'DETAIL') {
                // Check maxItems limit before processing
                if (maxItems > 0 && scrapedItemsCount >= maxItems) {
                    log.info(`maxItems limit (${maxItems}) reached. Skipping detail processing for ${request.url}`);
                    return; // Stop processing further details
                }
                 // Check maxCost limit before processing
                 if (maxCostPerRun > 0) {
                     const estimatedCost = 0.007 + scrapedItemsCount * 0.004;
                     if (estimatedCost >= maxCostPerRun) {
                         log.info(`Estimated cost ($${estimatedCost.toFixed(3)}) reached maxCostPerRun ($${maxCostPerRun}). Skipping detail processing for ${request.url}`);
                         return;
                     }
                 }

                // Înlocuiește sau actualizează secțiunea de extragere de date

                // În funcția handlePageFunction, actualizează partea de extragere a numelui:
                const placeName = await page.$eval('h1', (el) => el.textContent.trim())
                    .catch(() => {
                        log.warning('Could not extract place name from h1 element');
                        return 'Unknown Place';
                    });

                log.info(`▶️ Extracting details for: ${placeName} from ${request.url}`);

                // Wait for essential elements to ensure page is loaded
                const titleSelector = 'h1'; // Simpler, more general selector for the main title
                try {
                    await page.waitForSelector(titleSelector, { timeout: 20000 });
                    log.info('Detail page title found.');
                } catch (e) {
                    log.warning(`Could not find title element (${titleSelector}) on ${request.url}. Page might not have loaded correctly.`);
                    // Consider throwing error to retry if title is essential
                     throw new Error(`Failed to load essential detail page elements: ${e.message}`);
                }

                // Extragere informații de bază din pagina de detalii using more specific selectors
                const placeData = await page.evaluate(() => {
                    const data = {
                        scrapedUrl: window.location.href // Add the URL we actually scraped from
                    };

                    // Helper function to get text content safely
                    const getText = (selector) => {
                        const element = document.querySelector(selector);
                        return element ? element.textContent.trim() : null;
                    };
                     // Helper function to get attribute safely
                     const getAttribute = (selector, attribute) => {
                         const element = document.querySelector(selector);
                         return element ? element.getAttribute(attribute) : null;
                     };


                    data.name = getText('h1'); // Main title
                    data.category = getText('button[jsaction*="pane.rating.category"]');
                    data.address = getText('button[data-item-id="address"] div.fontBodyMedium'); // More specific address text
                    data.phone = getText('button[data-item-id^="phone:"] div.fontBodyMedium'); // More specific phone text
                    data.website = getAttribute('a[data-item-id="authority"]', 'href');
                    data.googleUrl = window.location.href; // The canonical URL of the place detail page

                    // Extract Place ID from a common data attribute if available
                    const placeIdElement = document.querySelector('[data-google-place-id]');
                    data.placeId = placeIdElement ? placeIdElement.getAttribute('data-google-place-id') : null;
                    // Fallback: try extracting from URL again if needed
                    if (!data.placeId) {
                        const placeIdMatch = window.location.href.match(/!1s([^!]+)/);
                        if (placeIdMatch && placeIdMatch[1]) {
                            data.placeId = placeIdMatch[1];
                        }
                    }


                    // Coordinates (try extracting from meta tag or map link)
                    data.coordinates = null;
                    const metaElement = document.querySelector('meta[itemprop="image"]'); // Often contains coords in content URL
                    if (metaElement) {
                        const content = metaElement.getAttribute('content');
                        const llMatch = content ? content.match(/center=([\d.-]+)%2C([\d.-]+)/) : null;
                        if (llMatch && llMatch[1] && llMatch[2]) {
                            data.coordinates = { lat: parseFloat(llMatch[1]), lng: parseFloat(llMatch[2]) };
                        }
                    }
                     // Fallback to map link if meta tag fails
                     if (!data.coordinates) {
                         const mapLink = document.querySelector('a[href*="/maps/dir/"]');
                         if (mapLink) {
                             const url = mapLink.href;
                             const atIndex = url.indexOf('/@');
                             if (atIndex !== -1) {
                                 const coordsPart = url.substring(atIndex + 2).split('z')[0];
                                 const [lat, lng] = coordsPart.split(',');
                                 if (lat && lng && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng))) {
                                     data.coordinates = { lat: parseFloat(lat), lng: parseFloat(lng) };
                                 }
                             }
                         }
                     }


                    // Rating and review count
                    const ratingElement = document.querySelector('div.F7nice'); // Common container for rating/reviews
                    if (ratingElement) {
                        const ratingValue = ratingElement.querySelector('span[aria-hidden="true"]')?.textContent.trim();
                        const reviewCountText = ratingElement.querySelector('span[aria-label*="reviews"]')?.textContent.trim();

                        data.rating = ratingValue && !isNaN(parseFloat(ratingValue)) ? parseFloat(ratingValue) : null;
                        if (reviewCountText) {
                            const countMatch = reviewCountText.match(/[\d,]+/);
                            data.reviewCount = countMatch ? parseInt(countMatch[0].replace(/,/g, ''), 10) : null;
                        }
                    }

                    // Opening Hours
                    // Clicking the hours might be needed, this gets the currently displayed status
                    const hoursElement = document.querySelector('div[jsaction*="pane.openhours"]');
                    data.openingHoursStatus = hoursElement ? hoursElement.textContent.trim() : null; // e.g., "Open ⋅ Closes 10 PM"
                    // Extracting full schedule requires clicking and parsing the table, which adds complexity.
                    // For now, we just get the current status text.

                    // Description (Plus Code, etc.) - Look for sections with specific icons
                    data.plusCode = getText('button[data-item-id="plus_code"] div.fontBodyMedium');
                    // Other attributes often found in similar buttons
                    // data.someAttribute = getText('button[data-item-id="attribute_id"] div.fontBodyMedium');

                    // Status (Temporarily closed, Permanently closed)
                    const statusElement = document.querySelector('div.fontHeadlineSmall + div > span[style*="color: rgb(217, 48, 37)"]'); // Look for red text near title
                    data.status = statusElement ? statusElement.textContent.trim() : 'Operational'; // Assume operational if no specific status found


                    // Images (extract first few image URLs)
                    data.imageUrls = [];
                    const imageElements = document.querySelectorAll('button[jsaction*="pane.heroHeaderImage.click"] img');
                    imageElements.forEach(img => {
                        if (img.src && !img.src.startsWith('data:')) { // Exclude base64 images
                            data.imageUrls.push(img.src);
                        }
                    });


                    return data;
                });

                // Add Place ID if extracted separately
                const placeIdFromUrl = request.url.match(/!1s([^!]+)/);
                 if (!placeData.placeId && placeIdFromUrl && placeIdFromUrl[1]) {
                     placeData.placeId = placeIdFromUrl[1];
                 }


                // 7. Extract Reviews if requested
                placeData.reviews = [];
                if (includeReviews && placeData.reviewCount > 0) {
                    log.info(`Attempting to extract reviews for ${placeName}...`);
                    const reviewsButtonSelector = 'button[jsaction*="pane.reviewChart.moreReviews"], button[aria-label*="Reviews for"]'; // Try multiple selectors
                    try {
                        await randomDelay(1000, 3000);
                        const reviewsButton = await page.$(reviewsButtonSelector);
                        if (reviewsButton) {
                            await page.click(reviewsButtonSelector);
                            log.info('Clicked "See all reviews" button.');
                            // Wait for the reviews section/dialog to appear
                            const reviewsSectionSelector = 'div[jsaction*="pane.reviewList"]'; // Selector for the reviews container
                            await page.waitForSelector(reviewsSectionSelector, { timeout: 15000 });
                            log.info('Reviews section loaded.');

                            // Scroll through reviews
                            let currentReviewCount = 0;
                            let lastReviewCount = -1;
                            let scrollAttempts = 0;
                            const maxScrollAttempts = 20; // Limit scroll attempts to prevent infinite loops

                            while (scrollAttempts < maxScrollAttempts) {
                                currentReviewCount = await page.$$eval('div[data-review-id]', reviews => reviews.length);
                                log.debug(`Found ${currentReviewCount} reviews after scroll.`);

                                if (maxReviews > 0 && currentReviewCount >= maxReviews) {
                                    log.info(`Reached maxReviews limit (${maxReviews}).`);
                                    break;
                                }
                                if (currentReviewCount === lastReviewCount) {
                                     log.info('No new reviews loaded after scroll, stopping scroll.');
                                     break; // No new reviews loaded
                                }

                                lastReviewCount = currentReviewCount;

                                // Scroll the review pane
                                await page.evaluate((selector) => {
                                    const scrollableElement = document.querySelector(selector);
                                    if (scrollableElement) {
                                        scrollableElement.scrollTop = scrollableElement.scrollHeight;
                                    }
                                }, reviewsSectionSelector);

                                await page.waitForTimeout(1500 + Math.random() * 1000); // Wait for reviews to load (randomized)
                                scrollAttempts++;
                            }


                            // Extract review details
                            placeData.reviews = await page.evaluate((maxRev, includeRevInfo, reviewSectionSel) => {
                                const reviews = [];
                                const reviewElements = document.querySelectorAll(`${reviewSectionSel} div[data-review-id]`);

                                reviewElements.forEach((el, index) => {
                                    if (maxRev > 0 && index >= maxRev) return;

                                    const review = {};
                                    review.reviewId = el.getAttribute('data-review-id');
                                    review.text = el.querySelector('span.wiI7pd')?.textContent.trim() || null; // Review text
                                    review.rating = null;
                                    const starsElement = el.querySelector('span.kvMYJc[aria-label]'); // Stars element
                                    if (starsElement) {
                                        const starsMatch = starsElement.getAttribute('aria-label').match(/(\d+)\s+star/);
                                        if (starsMatch) {
                                            review.rating = parseInt(starsMatch[1], 10);
                                        }
                                    }
                                    review.relativeDate = el.querySelector('span.rsqaWe')?.textContent.trim() || null; // e.g., "a month ago"

                                    if (includeRevInfo) {
                                        review.reviewerName = el.querySelector('div.d4r55')?.textContent.trim() || null;
                                        review.reviewerProfileUrl = el.querySelector('button[jsaction*="pane.review.reviewerLink"]')?.getAttribute('data-href') || null; // May need adjustment
                                        // Extracting reviewer photo, review count, local guide status requires more selectors
                                    }

                                    // Owner reply
                                    const replyElement = el.querySelector('div.PBK6be');
                                    if (replyElement) {
                                        review.ownerReply = replyElement.querySelector('span.wiI7pd')?.textContent.trim() || null;
                                        review.ownerReplyRelativeDate = replyElement.querySelector('span.rsqaWe')?.textContent.trim() || null;
                                    }

                                    reviews.push(review);
                                });
                                return reviews;

                            }, maxReviews, includeReviewerInfo, reviewsSectionSelector);
                            log.info(`Extracted ${placeData.reviews.length} reviews.`);

                            // Optional: Click back button if reviews opened in a modal/overlay
                            // await page.click('button[aria-label="Back"]');

                        } else {
                            log.warning('Could not find the "See all reviews" button.');
                        }
                    } catch (e) {
                        log.error(`Error extracting reviews: ${e.message}`);
                        // Continue without reviews if extraction fails
                    }
                }


                // 8. Extract Contact Details from Website (Optional, requires utils/extract-contact.js)
                placeData.email = null;
                placeData.socialProfiles = {};
                /* // Uncomment this section if you implement extract-contact.js
                if (placeData.website) {
                    log.info(`Attempting to extract contact details from website: ${placeData.website}`);
                    try {
                        // Use the helper function (you need to create this file and function)
                        const contactDetails = await extractContactDetails(placeData.website, proxyConfiguration);
                        placeData.email = contactDetails.email;
                        placeData.socialProfiles = contactDetails.socialProfiles;
                        log.info(`Extracted from website: Email - ${placeData.email}, Social - ${Object.keys(placeData.socialProfiles).length}`);
                    } catch (err) {
                        log.warning(`Failed to extract contact details from ${placeData.website}: ${err.message}`);
                    }
                }
                */

                // 9. Salvează datele extrase
                await Apify.pushData(placeData);
                scrapedItemsCount++;
                await Apify.setValue('STATE', { scrapedItemsCount }); // Persist count
                log.info(`✅ Successfully scraped ${placeName}. Total scraped: ${scrapedItemsCount}`);

            }
        },

        // 10. Funcție de tratare a eșecurilor
        handleFailedRequestFunction: async ({ request, error }) => {
            log.error(`❌ Request failed after ${request.retryCount} retries: ${request.url} | Error: ${error.message}`);
            // Log failed request details for debugging
            const failedData = {
                url: request.url,
                label: request.userData.label,
                placeName: request.userData.placeName || null,
                retryCount: request.retryCount,
                errorMessage: error.message,
                errorType: error.constructor.name,
                timestamp: new Date().toISOString()
            };
             // Retire session on certain errors (e.g., blocking, CAPTCHA)
             if (error.message.includes('Navigation timeout') || error.message.includes('net::ERR_') || error.message.includes('CAPTCHA')) {
                 log.warning(`Retiring session due to error: ${error.message}`);
                 session.retire();
             }

            // Save failed request info to a separate dataset (optional)
            await Apify.pushData(failedData, { datasetId: 'FAILED_REQUESTS' });
        }
    });

    // 11. Pornirea crawler-ului
    log.info('Starting the crawler run...');
    await crawler.run();
    log.info(`Crawler finished. Total items scraped: ${scrapedItemsCount}`);
});
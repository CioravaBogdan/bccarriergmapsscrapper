// Change to the correct Apify SDK v3 import pattern
const { Actor, log } = require('apify');
const { sleep } = require('apify');
const { PuppeteerCrawler } = require('crawlee');

const { extractContactDetails, ABORT_RESOURCE_TYPES_DEFAULT } = require('./utils/extract-contact');
const CostEstimator = require('./utils/cost-estimator'); // Import the class

// --- Helper Functions ---
const randomDelay = async (min = 1000, max = 3000) => { // Shorter delays often suffice
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    log.debug(`Waiting for random delay of ${delay}ms`);
    await sleep(delay); // Use Apify.utils.sleep
};

// Function to perform robust scrolling
async function infiniteScroll(page, scrollSelector, maxScrolls = 20) {
    log.info(`Starting infinite scroll within selector: ${scrollSelector}`);
    let scrolls = 0;
    let lastHeight = 0;
    try {
        while (scrolls < maxScrolls) {
            const newHeight = await page.evaluate((selector) => {
                const element = document.querySelector(selector);
                if (!element) return -1; // Element not found
                element.scrollBy(0, element.scrollHeight); // Scroll down
                return element.scrollHeight;
            }, scrollSelector);

            if (newHeight === -1) {
                log.warning(`Scroll element ${scrollSelector} not found.`);
                break;
            }
            if (newHeight === lastHeight) {
                log.info(`Scroll height hasn't changed (${newHeight}px). Assuming end of results.`);
                break; // Reached the bottom or no new content loaded
            }
            lastHeight = newHeight;
            scrolls++;
            log.debug(`Scrolled down ${scrolls} times, new height: ${newHeight}px`);
            await sleep(1500 + Math.random() * 1000); // Wait for content to load
        }
        log.info(`Finished scrolling after ${scrolls} scrolls.`);
    } catch (e) {
        log.warning(`Error during scrolling: ${e.message}`);
    }
}

// --- Main Actor Logic ---
Actor.main(async () => {
    log.info('Reading input...');
    const input = await Actor.getInput();

    // --- Input Processing & Validation ---
    const {
        searchStringsArray = [],
        searchLocation = '',
        customGeolocation = null,
        startUrls = [],
        maxCrawledPlacesPerSearch = 0, // 0 means unlimited for this specific search
        maxCrawledPlaces = 0, // 0 means unlimited total
        maxCostPerRun = 0,
        scrapeContacts = true,
        scrapePlaceDetailPage = true, // Default to true if not provided
        skipClosedPlaces = false,
        maxImages = 5,
        maxReviews = 5,
        reviewsSort = 'newest', // Default sort
        language = 'en',
        proxyConfig = { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
        costOptimizedMode = false,
        skipContactExtraction = false,
    } = input;

    if (!startUrls.length && (!searchStringsArray.length || (!searchLocation && !customGeolocation))) {
        throw new Error('Input error: Provide "startUrls", or "searchStringsArray" with "searchLocation" or "customGeolocation".');
    }

    // Apply cost optimization overrides
    const effectiveMaxImages = costOptimizedMode ? Math.min(maxImages, 1) : maxImages;
    const effectiveMaxReviews = costOptimizedMode ? Math.min(maxReviews, 1) : maxReviews;
    const effectiveScrapeContacts = costOptimizedMode || skipContactExtraction ? false : scrapeContacts;
    const effectiveNavigationTimeout = costOptimizedMode ? 45 : 90; // Shorter timeouts
    const effectiveRequestHandlerTimeout = costOptimizedMode ? 120 : 240;

    // --- Initialize Utilities ---
    const costEstimator = new CostEstimator(maxCostPerRun);
    const state = await Actor.getValue('STATE') || { scrapedItemsCount: 0 };
    let scrapedItemsCount = state.scrapedItemsCount;

    // --- Proxy Configuration ---
    log.info('Configuring proxy...');
    const proxyConfiguration = await Actor.createProxyConfiguration({
        ...proxyConfig,
        // Groups: ['RESIDENTIAL'], // Ensure residential if needed
    });
    log.info('Proxy configured.');

    // --- Request Queue Initialization ---
    log.info('Initializing request queue...');
    const requestQueue = await Actor.openRequestQueue();
    let initialRequestCount = 0;

    // Add Start URLs first
    for (const urlEntry of startUrls) {
        const req = typeof urlEntry === 'string' ? { url: urlEntry } : urlEntry;
        if (!req.url) continue;
        req.userData = req.userData || {};
        // Determine label based on URL structure
        if (!req.userData.label) {
            if (req.url.includes('/maps/search/')) {
                req.userData.label = 'SEARCH';
                // Try to extract search term if possible (optional)
                const match = req.url.match(/\/maps\/search\/([^/@]+)/);
                req.userData.search = match ? decodeURIComponent(match[1]).replace(/\+/g, ' ') : 'Unknown Search';
            } else if (req.url.includes('/maps/place/')) {
                req.userData.label = 'DETAIL';
                // Try to extract place name if possible (optional)
                const match = req.url.match(/\/maps\/place\/([^/@]+)/);
                req.userData.placeName = match ? decodeURIComponent(match[1]).replace(/\+/g, ' ') : 'Unknown Place';
            } else {
                 log.warning(`Could not determine label for start URL: ${req.url}. Assuming DETAIL.`);
                 req.userData.label = 'DETAIL';
            }
        }
        log.info(`Adding start URL: ${req.url} (Label: ${req.userData.label})`);
        await requestQueue.addRequest(req);
        initialRequestCount++;
    }

    // Add Search URLs (only if no startUrls or if explicitly needed alongside)
    // Simplified: If search terms are provided, add search requests regardless of startUrls for now.
    // Refine this logic if you need complex coordination between startUrls and searches.
    if (searchStringsArray.length > 0) {
        for (const searchTerm of searchStringsArray) {
            if (!searchTerm.trim()) continue;
            const searchTermEncoded = encodeURIComponent(searchTerm.trim());
            let searchUrl;
            const userData = { label: 'SEARCH', search: searchTerm.trim(), placesFoundThisSearch: 0 };

            if (customGeolocation?.coordinates?.length === 2) {
                const [longitude, latitude] = customGeolocation.coordinates;
                if (typeof latitude !== 'number' || typeof longitude !== 'number' || isNaN(latitude) || isNaN(longitude)) {
                    log.error(`Invalid customGeolocation coordinates: [${longitude}, ${latitude}]`);
                    continue; // Skip this search term
                }
                const radiusKm = customGeolocation.radiusKm || 5;
                // Zoom level approximation based on radius
                const zoom = Math.max(10, 16 - Math.floor(Math.log2(radiusKm)));
                searchUrl = `https://www.google.com/maps/search/${searchTermEncoded}/@${latitude},${longitude},${zoom}z/data=!4m2!2m1!6e5?hl=${language}`; // Added hl and data param
                userData.coordinates = { lat: latitude, lng: longitude };
                userData.searchRadius = radiusKm;
                log.info(`Adding search URL with coordinates: ${searchUrl}`);
            } else if (searchLocation) {
                const locationEncoded = encodeURIComponent(searchLocation);
                searchUrl = `https://www.google.com/maps/search/${searchTermEncoded}+in+${locationEncoded}/data=!4m2!2m1!6e5?hl=${language}`;
                userData.searchLocation = searchLocation;
                log.info(`Adding search URL with location: ${searchUrl}`);
            } else {
                searchUrl = `https://www.google.com/maps/search/${searchTermEncoded}/data=!4m2!2m1!6e5?hl=${language}`;
                log.info(`Adding search URL with only keywords: ${searchUrl}`);
            }
            await requestQueue.addRequest({ url: searchUrl, userData });
            initialRequestCount++;
        }
    }

    if (initialRequestCount === 0) {
        throw new Error('No valid start URLs or search parameters provided.');
    }
    log.info(`Request queue initialized with ${initialRequestCount} request(s).`);

    // --- Puppeteer Crawler Initialization ---
    log.info('Initializing PuppeteerCrawler...');
    const crawler = new PuppeteerCrawler({
        requestQueue,
        proxyConfiguration,
        requestHandlerTimeoutSecs: effectiveRequestHandlerTimeout,
        navigationTimeoutSecs: 120,
        maxRequestRetries: 3,
        
        // Explicitly configure Puppeteer to use the system Chrome
        launchContext: {
            // This is the key change - use puppeteer-core
            useChrome: true, // Use the Chrome installed on the system
            launchOptions: {
                headless: true,
                executablePath: '/usr/bin/google-chrome',
                args: [
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins',
                    '--disable-site-isolation-trials',
                    '--disable-features=BlockInsecurePrivateNetworkRequests',
                    '--no-sandbox',
                    '--disable-setuid-sandbox'
                ]
            }
        },
        
        // Also fix these function names to avoid the deprecation warnings
        requestHandler: async ({ page, request, session, browser }) => {
            const { userData, url } = request;
            const { label = 'SEARCH' } = userData;
            log.info(`Processing ${request.url} (Label: ${label})`);

            // --- Pre-processing: Consent/Captcha ---
            try {
                // Consent button click
                const consentButtonSelectors = [
                    'button[aria-label*="Accept all"]',
                    'button[aria-label*="Agree"]',
                    'button[jsname="b3VHJd"]', // Another common consent button identifier
                    'form[action*="consent"] button',
                ];
                for (const selector of consentButtonSelectors) {
                    if (await page.$(selector)) {
                        log.info(`Consent screen detected (selector: ${selector}), attempting to click.`);
                        await page.click(selector);
                        await sleep(2000 + Math.random() * 1000); // Wait for potential redirect/reload
                        log.info('Clicked consent button.');
                        break; // Assume one consent screen
                    }
                }
                // CAPTCHA check
                const isCaptcha = await page.$('iframe[src*="recaptcha"], #captcha-form');
                if (isCaptcha) {
                    session.retire(); // Retire session immediately
                    throw new Error('CAPTCHA detected');
                }
            } catch (e) {
                if (e.message.includes('CAPTCHA')) {
                    log.warning(`CAPTCHA detected on ${request.url}. Retiring session and retrying.`);
                    throw e; // Throw to trigger retry
                }
                log.warning(`Error during pre-processing (consent/captcha): ${e.message}`);
            }

            // --- Label-Specific Logic ---
            if (label === 'SEARCH') {
                log.info(`Processing search results for: "${userData.search}"...`);

                // Wait for results container
                const resultsSelector = 'div[role="feed"]'; // Primary container
                try {
                    await page.waitForSelector(resultsSelector, { timeout: 20000 });
                } catch (e) {
                    // Fallback selectors or error handling
                    const fallbackSelector = 'a[href*="/maps/place/"]';
                    if (await page.$(fallbackSelector)) {
                        log.warning(`Primary results selector '${resultsSelector}' not found, but found place links. Proceeding cautiously.`);
                    } else {
                        const pageContent = await page.content();
                        if (pageContent.includes('No results found') || pageContent.includes('Nu s-au găsit rezultate')) {
                            log.info(`'No results found' for search: "${userData.search}"`);
                            return; // No results, nothing more to do
                        }
                        await Actor.setValue(`ERROR_SEARCH_PAGE_${Date.now()}`, pageContent, { contentType: 'text/html' });
                        throw new Error(`Could not find search results container ('${resultsSelector}') or fallback links.`);
                    }
                }

                // Perform infinite scroll
                await infiniteScroll(page, resultsSelector, costOptimizedMode ? 5 : 25); // Limit scrolls in cost mode

                // Extract place URLs from search results
                const placeLinks = await page.evaluate((resultsSel) => {
                    const links = new Set();
                    // Prioritize links within the feed articles
                    document.querySelectorAll(`${resultsSel} div[role="article"] a[href*="/maps/place/"]`)
                        .forEach(el => links.add(el.href));
                    // Fallback: any place link within the feed
                    if (links.size === 0) {
                        document.querySelectorAll(`${resultsSel} a[href*="/maps/place/"]`)
                            .forEach(el => links.add(el.href));
                    }
                    // Fallback: any place link on the page (less reliable)
                     if (links.size === 0) {
                         document.querySelectorAll(`a[href*="/maps/place/"]`)
                             .forEach(el => links.add(el.href));
                     }
                    return Array.from(links);
                }, resultsSelector);

                log.info(`Found ${placeLinks.length} unique place links.`);

                let enqueuedCount = 0;
                let placesFoundThisSearch = userData.placesFoundThisSearch || 0;

                for (const url of placeLinks) {
                    // Check total limit
                    if (maxCrawledPlaces > 0 && scrapedItemsCount >= maxCrawledPlaces) {
                        log.info(`Total place limit (${maxCrawledPlaces}) reached. Stopping search.`);
                        break;
                    }
                    // Check limit for this specific search term
                    if (maxCrawledPlacesPerSearch > 0 && placesFoundThisSearch >= maxCrawledPlacesPerSearch) {
                        log.info(`Limit per search (${maxCrawledPlacesPerSearch}) reached for "${userData.search}". Stopping.`);
                        break;
                    }
                    // Check cost limit
                    if (!costEstimator.checkBudget()) {
                        log.warning(`Budget limit reached. Stopping actor.`);
                        // Optionally, you could just stop adding requests instead of exiting the whole actor
                        // For now, let's rely on the check before adding the request
                        break;
                    }

                    // Add language parameter to detail URL
                    const detailUrl = new URL(url);
                    detailUrl.searchParams.set('hl', language);

                    if (costEstimator.checkBudget()) { // Double check before adding
                        await requestQueue.addRequest({
                            url: detailUrl.href,
                            userData: {
                                label: 'DETAIL',
                                // Attempt to get name from link text if possible (very basic)
                                placeName: `Place from search: ${userData.search}`,
                                searchTerms: userData.search, // Pass search terms for context
                            }
                        });
                        enqueuedCount++;
                        placesFoundThisSearch++;
                    } else {
                         log.warning(`Budget limit reached just before adding request for ${url}. Stopping.`);
                         break;
                    }
                }
                log.info(`Enqueued ${enqueuedCount} detail page requests for search "${userData.search}". Total found this search: ${placesFoundThisSearch}`);

            } else if (label === 'DETAIL') {
                // Check budget before processing detail page
                if (!costEstimator.addPlace()) { // Increment place count and check budget
                    log.warning(`Budget limit reached before processing detail page ${request.url}. Skipping.`);
                    return;
                }

                log.info(`▶️ Extracting details for: ${userData.placeName || request.url}`);
                await randomDelay(500, 1500); // Small delay before extraction

                // --- Extract Core Data ---
                const extractedData = await page.evaluate(() => {
                    const getText = (selector) => document.querySelector(selector)?.textContent.trim() || null;
                    const getAttribute = (selector, attr) => document.querySelector(selector)?.getAttribute(attr) || null;

                    const placeName = getText('h1') || getText('.DUwDvf'); // Common selectors for name
                    const mainCategory = getText('button[jsaction*="category"]'); // Main category button
                    const address = getText('button[data-item-id="address"]')?.replace(/^.*?\s/, '') || getText('[data-tooltip*="address"]')?.replace(/^.*?\s/, ''); // Clean address icon text
                    const phone = getText('button[data-item-id="phone"]')?.replace(/^.*?\s/, '') || getText('[data-tooltip*="phone"]')?.replace(/^.*?\s/, ''); // Clean phone icon text
                    const website = getAttribute('a[data-item-id="authority"]', 'href') || getAttribute('a[aria-label*="Website"]', 'href');
                    const plusCode = getText('button[data-item-id="plus_code"]')?.replace(/^.*?\s/, '') || getText('[data-tooltip*="Plus code"]')?.replace(/^.*?\s/, '');
                    const statusText = getText('.JZ9JDb') || getText('.mgr77e'); // Status like "Permanently closed"

                    // Coordinates from URL (fallback)
                    let lat = null, lng = null;
                    const urlMatch = window.location.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
                    if (urlMatch) {
                        lat = parseFloat(urlMatch[1]);
                        lng = parseFloat(urlMatch[2]);
                    }

                    // Opening hours status (icon text)
                    const hoursIcon = document.querySelector('.OMl5r.hH0dDd'); // Selector for the clock icon area
                    const openingHoursStatus = hoursIcon?.getAttribute('aria-label') || null;

                    return {
                        name: placeName,
                        category: mainCategory,
                        address: address,
                        phone: phone,
                        website: website,
                        plusCode: plusCode,
                        statusText: statusText,
                        coordinates: (lat && lng) ? { lat, lng } : null,
                        openingHoursStatus: openingHoursStatus,
                    };
                });

                // --- Populate placeData ---
                const placeData = {
                    scrapedUrl: request.url,
                    name: extractedData.name || userData.placeName, // Use extracted name if available
                    category: extractedData.category,
                    address: extractedData.address,
                    phone: extractedData.phone,
                    website: extractedData.website,
                    googleUrl: request.url,
                    placeId: request.url.match(/!1s(0x[a-f0-9]+:[a-f0-9]+)/)?.[1] || null, // Extract Place ID
                    coordinates: extractedData.coordinates,
                    openingHoursStatus: extractedData.openingHoursStatus,
                    openingHours: null, // To be extracted later if needed
                    plusCode: extractedData.plusCode,
                    status: extractedData.statusText?.toLowerCase().includes('permanently closed') ? 'Permanently closed' : 'Operational', // Determine status
                    imageUrls: [],
                    reviews: [],
                    email: null,
                    socialProfiles: {},
                    searchTerms: userData.searchTerms || null, // Include search terms if available
                    timestamp: new Date().toISOString(), // Add timestamp
                    _error: null, // Placeholder for errors during sub-extractions
                };

                // --- Conditional Skipping ---
                if (skipClosedPlaces && placeData.status === 'Permanently closed') {
                    log.info(`Skipping permanently closed place: ${placeData.name}`);
                    return; // Stop processing this place
                }

                // --- Extract Opening Hours (if needed) ---
                // Add logic here if opening hours details are required (clicking the hours section)
                // Example (simplified):
                // if (scrapePlaceDetailPage) {
                //     try {
                //         const hoursButton = await page.$('button[jsaction*="pane.openhours"]');
                //         if (hoursButton) {
                //             await hoursButton.click();
                //             await page.waitForSelector('.y0A6Dd'); // Wait for hours table
                //             placeData.openingHours = await page.evaluate(() => { /* ... extraction logic ... */ });
                //         }
                //     } catch(e) { log.warning(`Could not extract opening hours: ${e.message}`); }
                // }


                // --- Extract Images (if needed) ---
                if (scrapePlaceDetailPage && effectiveMaxImages > 0) {
                    if (!costEstimator.addDetails()) { // Increment details cost and check budget
                        log.warning(`Budget limit reached before extracting images for ${placeData.name}. Skipping.`);
                    } else {
                        log.info(`Extracting up to ${effectiveMaxImages} images...`);
                        try {
                            // Simple extraction from thumbnails visible on the page
                            const imageUrls = await page.evaluate((max) => {
                                const urls = new Set();
                                document.querySelectorAll('button[jsaction*="pane.heroHeaderImage.click"] img[src*="googleusercontent"]')
                                    .forEach(img => {
                                        if (urls.size < max && img.src) {
                                            // Try to get higher resolution URL
                                            urls.add(img.src.replace(/=w\d+-h\d+/, '=w1024-h768'));
                                        }
                                    });
                                return Array.from(urls);
                            }, effectiveMaxImages);
                            placeData.imageUrls = imageUrls;
                            log.info(`Extracted ${placeData.imageUrls.length} images.`);
                        } catch (e) {
                            log.warning(`Failed to extract images: ${e.message}`);
                            placeData._error = (placeData._error ? placeData._error + '; ' : '') + `Image extraction failed: ${e.message}`;
                        }
                    }
                }

                // --- Extract Reviews (if needed) ---
                if (scrapePlaceDetailPage && effectiveMaxReviews > 0) {
                     if (!costEstimator.addDetails()) { // Increment details cost again
                         log.warning(`Budget limit reached before extracting reviews for ${placeData.name}. Skipping.`);
                     } else {
                        log.info(`Extracting up to ${effectiveMaxReviews} reviews (sorted by ${reviewsSort})...`);
                        try {
                            // Click the reviews tab/button
                            const reviewButtonSelectors = [
                                'button[jsaction*="pane.rating.moreReviews"]', // "More reviews" button
                                'button[jsaction*="pane.reviewChart.moreReviews"]',
                                'button[aria-label*="Reviews"]', // General reviews button/tab
                            ];
                            let reviewButtonClicked = false;
                            for (const selector of reviewButtonSelectors) {
                                if (await page.$(selector)) {
                                    await page.click(selector);
                                    await sleep(1500 + Math.random() * 1000); // Wait for reviews to load
                                    reviewButtonClicked = true;
                                    log.debug(`Clicked reviews button: ${selector}`);
                                    break;
                                }
                            }

                            if (reviewButtonClicked) {
                                // Optional: Apply sorting (requires clicking sort dropdown)
                                // Add logic here if sorting is needed based on `reviewsSort`

                                // Scroll within the reviews feed
                                const reviewFeedSelector = 'div[role="feed"][aria-label*="Reviews"], div.m6QErb[aria-label*="Reviews"]'; // Common review feed selectors
                                await infiniteScroll(page, reviewFeedSelector, costOptimizedMode ? 2 : 5); // Limit scrolls

                                // Extract reviews
                                placeData.reviews = await page.evaluate((max, feedSelector) => {
                                    const reviews = [];
                                    const reviewElements = document.querySelectorAll(`${feedSelector} div[jsaction*="mouseover:pane.review.in"]`); // Selector for individual review blocks
                                    reviewElements.forEach(el => {
                                        if (reviews.length >= max) return;
                                        const authorName = el.querySelector('.d4r55')?.textContent.trim();
                                        const ratingText = el.querySelector('.kvMYJc [aria-label*="stars"]')?.getAttribute('aria-label');
                                        const rating = ratingText ? parseFloat(ratingText) : null;
                                        const dateText = el.querySelector('.rsqaWe')?.textContent.trim();
                                        // Expand review text if needed
                                        const moreButton = el.querySelector('button[jsaction="click:TiglPc"]');
                                        if (moreButton) moreButton.click(); // Click "More" button
                                        const reviewText = el.querySelector('.wiI7pd')?.textContent.trim();

                                        if (authorName && rating !== null && dateText && reviewText) {
                                            reviews.push({ authorName, rating, date: dateText, text: reviewText });
                                        }
                                    });
                                    return reviews;
                                }, effectiveMaxReviews, reviewFeedSelector);
                                log.info(`Extracted ${placeData.reviews.length} reviews.`);
                            } else {
                                log.warning('Could not find or click the reviews button.');
                            }
                        } catch (e) {
                            log.warning(`Failed to extract reviews: ${e.message}`);
                             placeData._error = (placeData._error ? placeData._error + '; ' : '') + `Review extraction failed: ${e.message}`;
                        }
                    }
                }

                // --- Extract Contacts from Website (if enabled) ---
                if (effectiveScrapeContacts && placeData.website) {
                    if (!costEstimator.addContact()) { // Increment contact cost and check budget
                        log.warning(`Budget limit reached before extracting contacts for ${placeData.name}. Skipping.`);
                    } else {
                        log.info(`Attempting contact extraction from: ${placeData.website}`);
                        const contactOptions = {
                            timeout: costOptimizedMode ? 15000 : 30000,
                            maxDepth: costOptimizedMode ? 1 : 1, // Keep depth low to save cost
                            abortResourceTypes: costOptimizedMode ? ABORT_RESOURCE_TYPES_DEFAULT : ['image', 'font'], // Less aggressive blocking if not cost-optimized
                        };
                        try {
                            // Pass the BROWSER instance here
                            const contactInfo = await extractContactDetails(placeData.website, browser, contactOptions);
                            placeData.email = contactInfo.email;
                            // Merge social profiles, preferring existing ones from Maps page if any
                            placeData.socialProfiles = { ...contactInfo.socialProfiles, ...placeData.socialProfiles };
                            if (contactInfo._error) {
                                 placeData._error = (placeData._error ? placeData._error + '; ' : '') + `Contact extraction note: ${contactInfo._error}`;
                            }
                            log.info(`Contact extraction result: Email=${!!placeData.email}, Social=${Object.keys(placeData.socialProfiles).length}`);
                        } catch (e) {
                            log.warning(`Contact extraction failed for ${placeData.website}: ${e.message}`);
                             placeData._error = (placeData._error ? placeData._error + '; ' : '') + `Contact extraction failed: ${e.message}`;
                        }
                    }
                }

                // --- Push Data ---
                await Actor.pushData(placeData);
                scrapedItemsCount++;
                log.info(`✅ Successfully scraped ${placeData.name}. Total scraped: ${scrapedItemsCount}`);

                // Persist state periodically
                if (scrapedItemsCount % 20 === 0) {
                    await Actor.setValue('STATE', { scrapedItemsCount });
                }

            } // End DETAIL label
        }, // End handlePageFunction

        failedRequestHandler: async ({ request, error, session }) => { // Add session
            log.error(`❌ Request failed after ${request.retryCount} retries: ${request.url} | Error: ${error.message}`);
            // Retire session on common blocking errors
            if (error.message.includes('Navigation timeout') || error.message.includes('net::ERR_') || error.message.includes('CAPTCHA') || error.message.includes('Target closed') || error.status === 403 || error.status === 429) {
                log.warning(`Retiring session due to error: ${error.message}`);
                if (session) session.retire(); // Retire the session if available
            }
            // Save failed request info (optional)
            // await Apify.pushData({ url: request.url, error: error.message, retryCount: request.retryCount }, { datasetId: 'FAILED_REQUESTS' });
        }
    }); // End PuppeteerCrawler

    // --- Start Crawler & Finish ---
    log.info('Starting the crawler run...');
    await crawler.run();
    log.info('Crawler finished.');

    // Log final cost report
    await costEstimator.logReport();

    // Final state save
    await Actor.setValue('STATE', { scrapedItemsCount });
    log.info(`Run finished. Total items scraped: ${scrapedItemsCount}. Estimated cost: $${costEstimator.currentCost.toFixed(3)}`);

}); // End Apify.main

// Global timeout remains the same
setTimeout(() => {
    log.warning('Global timeout (10 minutes) reached, terminating the run.');
    process.exit(1); // Use non-zero exit code for timeout
}, 10 * 60 * 1000);
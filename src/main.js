// Importăm SDK-ul Apify și extragem utilitarele necesare
const Apify = require('apify');
const { log } = Apify.utils;
// Importăm funcția auxiliară pentru extragerea contactelor
const { extractContactDetails } = require('./utils/extract-contact');

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

    // Extrage setările din noul format flat
    const searchStringsArray = input.searchStringsArray || [];
    const searchLocation = input.searchLocation || '';
    const customGeolocation = input.customGeolocation || null;
    const startUrls = input.startUrls || [];

    const maxCrawledPlacesPerSearch = input.maxCrawledPlacesPerSearch || 0;
    const maxCrawledPlaces = input.maxCrawledPlaces || 0; 
    const maxCostPerRun = input.maxCostPerRun || 0;

    const scrapeContacts = input.scrapeContacts !== false;
    const scrapePlaceDetailPage = input.scrapePlaceDetailPage !== false;
    const skipClosedPlaces = input.skipClosedPlaces || false;
    const maxImages = input.maxImages || 0;
    const maxReviews = input.maxReviews || 0;
    const reviewsSort = input.reviewsSort || 'newest';

    const language = input.language || 'en';
    const proxyConfig = input.proxyConfig || {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL']
    };

    // Validare input minim necesar
    if (!startUrls.length && (!searchStringsArray.length || !searchLocation)) {
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
    }

    // Al doilea pas: dacă avem termeni de căutare și startUrls, adaugă și căutarea
    if (searchStringsArray.length > 0 && startUrls.length > 0) {
        // Vom folosi coordonatele primei locații pentru căutare
        // Acest cod este executat după ce se termină procesarea startUrls
        log.info('Adding search tasks to be processed after initial URLs');
        
        // Adaugă o cerere specială care va iniția căutarea după procesarea URL-urilor inițiale
        await requestQueue.addRequest({
            url: startUrls[0].url || startUrls[0], 
            userData: { 
                label: 'EXTRACT_AND_SEARCH',
                search: searchStringsArray.join(', '),
                searchRadius: 5
            }
        });
        initialRequestCount++;
    } 
    // Cazul standard când avem doar căutare fără startUrls (neschimbat)
    else if (searchStringsArray.length > 0 && startUrls.length === 0) {
        log.info('Generating search URL from keywords and location...');
        const searchTermEncoded = encodeURIComponent(searchStringsArray.join(' '));
        
        // Verifică dacă avem coordonate specifice
        if (customGeolocation && customGeolocation.coordinates && customGeolocation.coordinates.length === 2) {
            // GeoJSON folosește formatul [longitude, latitude]
            const longitude = customGeolocation.coordinates[0];
            const latitude = customGeolocation.coordinates[1];

            log.info(`DEBUG: Extracted raw coordinates from input - longitude: ${longitude}, latitude: ${latitude}`);

            // Verifică dacă sunt numere valide (nu doar undefined)
            if (typeof latitude !== 'number' || typeof longitude !== 'number' || isNaN(latitude) || isNaN(longitude)) {
                log.error(`Invalid coordinate values: latitude=${latitude}, longitude=${longitude}`);
                throw new Error("Invalid coordinate values");
            }

            const zoom = 15 - Math.min(Math.floor((customGeolocation.radiusKm || 5) / 2), 10);
            
            const searchUrl = `https://www.google.com/maps/search/${searchTermEncoded}/@${latitude},${longitude},${zoom}z`;
            log.info(`Adding search URL with coordinates: ${searchUrl}`);
            
            await requestQueue.addRequest({ 
                url: searchUrl, 
                userData: { 
                    label: 'SEARCH', 
                    search: searchStringsArray.join(', '), 
                    coordinates: { lat: latitude, lng: longitude },
                    searchRadius: customGeolocation.radiusKm || 5
                } 
            });
        } 
        // Dacă avem o locație specificată ca text
        else if (searchLocation) {
            const locationEncoded = encodeURIComponent(searchLocation);
            // Format corect: "căutare în locație"
            const searchUrl = `https://www.google.com/maps/search/${searchTermEncoded}+in+${locationEncoded}/`;
            log.info(`Adding search URL with location: ${searchUrl}`);
            await requestQueue.addRequest({ 
                url: searchUrl, 
                userData: { label: 'SEARCH', search: searchStringsArray.join(', '), searchLocation } 
            });
        }
        // Doar căutare după cuvinte cheie
        else {
            const searchUrl = `https://www.google.com/maps/search/${searchTermEncoded}/`;
            log.info(`Adding search URL with only keywords: ${searchUrl}`);
            await requestQueue.addRequest({ 
                url: searchUrl, 
                userData: { label: 'SEARCH', search: searchStringsArray.join(', ') } 
            });
        }
        initialRequestCount++;
    } else {
        throw new Error('Input error: You must provide either "startUrls" or "search" parameters.');
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
        maxConcurrency: 1,
        maxRequestRetries: 3,
        navigationTimeoutSecs: 180, // Mărește la 3 minute
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

                // Wait for results container, more robust selectors
                try {
                    // Adaugă un delay pentru încărcarea completă a paginii
                    await page.waitForTimeout(5000);
                    
                    // Încercăm mai mulți selectori folosiți de Google Maps
                    const possibleSelectors = [
                        'div[role="feed"] > div > div[role="article"]',
                        'div.section-result',
                        'div.gm2-headline-5',
                        'div.fontHeadlineSmall',
                        'div.Nv2PK',
                        'a[href*="/maps/place/"]'
                    ];
                    
                    // Verifică dacă există vreun rezultat vizibil
                    let resultsFound = false;
                    let usedSelector = '';
                    
                    for (const selector of possibleSelectors) {
                        const exists = await page.$(selector);
                        if (exists) {
                            log.info(`Found search results using selector: ${selector}`);
                            resultsFound = true;
                            usedSelector = selector;
                            break;
                        }
                    }
                    
                    if (!resultsFound) {
                        log.warning('Could not find any search results using known selectors.');
                        
                        // Salvează screenshot pentru debugging
                        await page.screenshot({ path: 'search-results-debug.png', fullPage: true });
                        
                        // Verifică dacă există mesaj "No results found"
                        const pageContent = await page.content();
                        const noResultsText = await page.evaluate(() => {
                            return document.body.innerText.includes('No results found') || 
                                   document.body.innerText.includes('Nu s-au găsit rezultate');
                        });
                        
                        if (noResultsText) {
                            log.info('Page shows "No results found" message.');
                            return; // Exit early
                        } else {
                            log.error('Unknown page structure. Debug info follows:');
                            const debugInfo = await page.evaluate(() => ({
                                title: document.title,
                                url: window.location.href,
                                bodyText: document.body.innerText.substring(0, 1000)
                            }));
                            log.info('Page debug info:', debugInfo);
                            throw new Error('Cannot process search results: Unknown page structure');
                        }
                    }
                    
                    // Continua cu procesarea rezultatelor folosind selectorul găsit
                    const resultsSelector = usedSelector;
                    
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


                    // Extragere rezultate folosind DOM cu debug
                    const places = await page.evaluate(() => {
                        const results = [];
                        
                        // 1. Încercăm să găsim containerul principal de rezultate
                        const resultContainer = document.querySelector('div[role="feed"]');
                        if (!resultContainer) {
                            console.error('Feed container not found');
                            return results;
                        }
                        
                        // 2. Găsim toate articolele (rezultatele) din container
                        // Încercăm multiple selectoare pentru a găsi rezultatele
                        const resultSelectors = [
                            'div[role="article"]',
                            'a[href*="/maps/place/"]',  // Link-uri directe către locații
                            '.Nv2PK'                   // Clasa comună pentru rezultate în Google Maps
                        ];
                        
                        let placeElements = [];
                        // Testăm fiecare selector până găsim unul care returnează rezultate
                        for (const selector of resultSelectors) {
                            const elements = resultContainer.querySelectorAll(selector);
                            if (elements && elements.length > 0) {
                                console.log(`Found ${elements.length} results using selector ${selector}`);
                                placeElements = Array.from(elements);
                                break;
                            }
                        }
                        
                        console.log(`Total place elements found: ${placeElements.length}`);
                        
                        // 3. Procesăm fiecare element găsit pentru a extrage informațiile
                        placeElements.forEach((el, index) => {
                            try {
                                // Găsim link-ul către locație
                                let linkElement = null;
                                
                                // Dacă elementul este deja un link
                                if (el.tagName === 'A' && el.href && el.href.includes('/maps/place/')) {
                                    linkElement = el;
                                } else {
                                    // Altfel, căutăm link-uri în interior
                                    linkElement = el.querySelector('a[href*="/maps/place/"]');
                                }
                                
                                if (!linkElement || !linkElement.href) {
                                    // Adăugăm o logică de fallback pentru a găsi link-uri
                                    const allLinks = el.querySelectorAll('a[href*="/maps/"]');
                                    for (const link of allLinks) {
                                        if (link.href.includes('/maps/place/') || link.href.includes('/maps/search/')) {
                                            linkElement = link;
                                            break;
                                        }
                                    }
                                }
                                
                                // Dacă am găsit un link valid
                                if (linkElement && linkElement.href) {
                                    // Găsește titlul (numele afacerii)
                                    let title = null;
                                    
                                    // Încercăm diferite metode pentru a găsi titlul
                                    // Metoda 1: Element cu clasa fontHeadlineSmall
                                    const headlineEl = el.querySelector('.fontHeadlineSmall');
                                    if (headlineEl) {
                                        title = headlineEl.textContent.trim();
                                    }
                                    
                                    // Metoda 2: Element cu aria-label pentru numele afacerii
                                    if (!title) {
                                        const nameEl = el.querySelector('[aria-label]');
                                        if (nameEl) {
                                            title = nameEl.getAttribute('aria-label').trim();
                                        }
                                    }
                                    
                                    // Metoda 3: Primul element h3 sau div puternic stilizat
                                    if (!title) {
                                        const possibleTitleEl = el.querySelector('h3, div.fontTitleLarge, div.gm2-headline-5');
                                        if (possibleTitleEl) {
                                            title = possibleTitleEl.textContent.trim();
                                        }
                                    }
                                    
                                    // Fallback: Folosim numele din URL
                                    if (!title) {
                                        const urlParts = linkElement.href.split('/');
                                        const nameFromUrl = urlParts[urlParts.indexOf('place') + 1];
                                        if (nameFromUrl) {
                                            title = decodeURIComponent(nameFromUrl).replace(/\+/g, ' ');
                                        }
                                    }
                                    
                                    // Setăm cel puțin un titlu generic dacă nu am putut găsi unul specific
                                    title = title || `Place Result ${index + 1}`;
                                    
                                    // Extragem Place ID din URL dacă este posibil
                                    let placeId = null;
                                    const placeIdMatch = linkElement.href.match(/!1s([^!]+)/);
                                    if (placeIdMatch && placeIdMatch[1]) {
                                        placeId = placeIdMatch[1];
                                    }
                                    
                                    // Adăugăm rezultatul la listă
                                    results.push({ 
                                        title, 
                                        url: linkElement.href, 
                                        placeId,
                                        index
                                    });
                                    console.log(`Added result #${index + 1}: ${title}`);
                                }
                            } catch (error) {
                                console.error(`Error processing result #${index + 1}: ${error.message}`);
                            }
                        });
                        
                        console.log(`Returning ${results.length} extracted places`);
                        return results;
                    });

                    log.info(`Found ${places.length} potential places on the current page.`);
                    if (places.length === 0) {
                        // Salvăm un screenshot pentru debugging
                        await page.screenshot({ path: './screenshots/search-results-debug.png', fullPage: true });
                        log.warning('No place URLs extracted from the search results page. Check selectors.');
                        
                        // Adăugăm informații detaliate pentru debug
                        const pageDebugInfo = await page.evaluate(() => {
                            return {
                                title: document.title,
                                url: window.location.href,
                                hasFeed: !!document.querySelector('div[role="feed"]'),
                                hasArticles: document.querySelectorAll('div[role="article"]').length,
                                visibleText: document.body.innerText.substring(0, 1000),
                                linksCount: document.querySelectorAll('a[href*="/maps/place/"]').length
                            };
                        });
                        log.info('Page debug info:', pageDebugInfo);
                    }

                    let enqueuedCount = 0;
                    for (const place of places) {
                        // Check maxItems limit before enqueueing
                        if (maxCrawledPlaces > 0 && scrapedItemsCount + enqueuedCount >= maxCrawledPlaces) {
                            log.info(`maxItems limit (${maxCrawledPlaces}) reached. Stopping enqueueing.`);
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
                                userData: { label: 'DETAIL', placeName: place.title || placeId || 'Unknown Place' }
                            });
                            enqueuedCount++;
                        }
                    }
                    log.info(`Enqueued ${enqueuedCount} detail page requests.`);

                    // Check if we need to paginate (find next page button)
                    // Pagination logic is complex on Maps, often infinite scroll is used.
                    // The scrolling implemented above is a basic form. A robust solution
                    // might need to detect the end of results or handle explicit "Next" buttons if they appear.


                } catch (e) {
                    log.error(`Error processing search page: ${e.message}`);
                    throw e;
                }

            } else if (label === 'EXTRACT_AND_SEARCH') {
                // Așteaptă încărcarea paginii și extrage coordonatele
                await page.waitForSelector('h1', { timeout: 20000 }).catch(() => {
                    log.warning('Timeout waiting for h1 element - page might not have loaded properly');
                });

                // Extrage coordonatele din pagină
                const coordinates = await page.evaluate(() => {
                    try {
                        // Metodă 1: Caută în URL
                        const urlMatch = window.location.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
                        if (urlMatch && urlMatch.length >= 3) {
                            return {
                                lat: parseFloat(urlMatch[1]),
                                lng: parseFloat(urlMatch[2])
                            };
                        }
                        
                        // Restul metodelor de extragere a coordonatelor
                        // ... (codul existent pentru extragerea coordonatelor)
                        
                        return { lat: 0, lng: 0 }; // fallback
                    } catch (e) {
                        console.error('Error extracting coordinates:', e);
                        return { lat: 0, lng: 0 };
                    }
                });

                if (coordinates.lat !== 0 && coordinates.lng !== 0) {
                    log.info(`Extracted coordinates for search: ${coordinates.lat}, ${coordinates.lng}`);
                    
                    // Construiește URL-ul de căutare în apropierea acestor coordonate
                    const searchTermEncoded = encodeURIComponent(request.userData.search);
                    const searchRadius = request.userData.searchRadius || 5;
                    const zoom = 15 - Math.min(Math.floor(searchRadius / 2), 10); // Zoom level based on radius
                    
                    const searchUrl = `https://www.google.com/maps/search/${searchTermEncoded}/@${coordinates.lat},${coordinates.lng},${zoom}z`;
                    log.info(`Adding search URL with coordinates: ${searchUrl}`);
                    
                    await requestQueue.addRequest({ 
                        url: searchUrl, 
                        userData: { 
                            label: 'SEARCH', 
                            search: request.userData.search, 
                            coordinates: coordinates,
                            searchRadius: searchRadius
                        } 
                    });
                } else {
                    log.warning('Could not extract coordinates from the page. Search around this location skipped.');
                }
            } else if (label === 'DETAIL') {
                // Check maxItems limit before processing
                if (maxCrawledPlaces > 0 && scrapedItemsCount >= maxCrawledPlaces) {
                    log.info(`maxItems limit (${maxCrawledPlaces}) reached. Skipping detail processing for ${request.url}`);
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

                // Înlocuiește secțiunea de extragere a detaliilor locației cu această versiune extinsă:

                // Extrage programul de funcționare
                const openingHours = await page.evaluate(() => {
                    try {
                        // Caută după butoanele din secțiunea de orar
                        const hoursButtons = Array.from(document.querySelectorAll('button[data-item-id*="oh"]'));
                        if (hoursButtons.length > 0) {
                            // Dacă găsim buton de orar, verificăm starea curentă
                            const statusText = hoursButtons[0].textContent.trim();
                            
                            // Încercăm să găsim orarul complet
                            let fullSchedule = null;
                            
                            // Opțional: Click pentru a deschide orarul complet și a-l extrage
                            // hoursButtons[0].click();
                            // await page.waitForTimeout(1000); // Așteaptă deschiderea panoului
                            
                            // Găsim toate elementele ce conțin zile și ore
                            const scheduleItems = Array.from(document.querySelectorAll('table[class*="eK4R0e"] tr'));
                            if (scheduleItems.length > 0) {
                                fullSchedule = scheduleItems.map(item => {
                                    const dayEl = item.querySelector('td:first-child');
                                    const hoursEl = item.querySelector('td:nth-child(2)');
                                    if (dayEl && hoursEl) {
                                        return {
                                            day: dayEl.textContent.trim(),
                                            hours: hoursEl.textContent.trim()
                                        };
                                    }
                                    return null;
                                }).filter(Boolean);
                            }
                            
                            return {
                                status: statusText,
                                fullSchedule
                            };
                        }
                        return null;
                    } catch (e) {
                        console.error('Error extracting opening hours:', e);
                        return null;
                    }
                });

                // Extrage Plus Code
                const plusCode = await page.evaluate(() => {
                    try {
                        // Caută după element ce conține plus code
                        const plusCodeElements = document.querySelectorAll('button[data-item-id*="oloc"]');
                        return plusCodeElements.length > 0 ? plusCodeElements[0].textContent.trim() : null;
                    } catch (e) {
                        console.error('Error extracting plus code:', e);
                        return null;
                    }
                });

                // Extrage imagini
                const imageUrls = [];
                if (maxImages > 0) {
                    try {
                        // Click pe prima imagine pentru a deschide galeria
                        const firstImgSelector = 'button[data-item-id*="image"]';
                        const hasImages = await page.$(firstImgSelector);
                        
                        if (hasImages) {
                            // Click pe imagine pentru a deschide galeria
                            await Promise.all([
                                page.click(firstImgSelector),
                                page.waitForSelector('div[data-photo-index]', { timeout: 5000 })
                            ]).catch(() => log.warning('Could not open the image gallery'));
                            
                            // Extrage URL-uri de imagini din galerie
                            const extractedImageUrls = await page.evaluate((maxImg) => {
                                const imgUrls = [];
                                const imgElements = document.querySelectorAll('img[src*="googleusercontent"]');
                                
                                imgElements.forEach(img => {
                                    if (imgUrls.length < maxImg && img.src) {
                                        // Optimizare: Înlocuiește cu URL-ul la rezoluție mai mare
                                        const highResUrl = img.src.replace(/=w\d+-h\d+/, '=w1200-h1200');
                                        imgUrls.push(highResUrl);
                                    }
                                });
                                
                                return imgUrls;
                            }, maxImages);
                            
                            imageUrls.push(...extractedImageUrls);
                            log.info(`Extracted ${imageUrls.length} image URLs`);
                            
                            // Închide galeria
                            await Promise.all([
                                page.click('button[aria-label="Back"]'),
                                page.waitForSelector(firstImgSelector, { timeout: 5000 })
                            ]).catch(() => log.warning('Could not close the image gallery'));
                        } else {
                            log.info('No images found for this place');
                        }
                    } catch (e) {
                        log.warning(`Error extracting images: ${e.message}`);
                    }
                }

                // Extragerea profilurilor sociale din pagina de locație
                const socialProfiles = await page.evaluate(() => {
                    const profiles = {};
                    
                    // Căutăm toate butoanele care ar putea conține linkuri sociale
                    const buttons = document.querySelectorAll('a[data-item-id], button[data-item-id]');
                    
                    buttons.forEach(button => {
                        const text = button.textContent.toLowerCase();
                        const href = button.href || '';
                        
                        // Detectare platforme sociale comune
                        if (text.includes('facebook') || href.includes('facebook.com')) {
                            profiles.facebook = href || 'detected but no URL';
                        }
                        if (text.includes('instagram') || href.includes('instagram.com')) {
                            profiles.instagram = href || 'detected but no URL';
                        }
                        if (text.includes('twitter') || href.includes('twitter.com') || href.includes('x.com')) {
                            profiles.twitter = href || 'detected but no URL';
                        }
                        if (text.includes('linkedin') || href.includes('linkedin.com')) {
                            profiles.linkedin = href || 'detected but no URL';
                        }
                        if (text.includes('youtube') || href.includes('youtube.com')) {
                            profiles.youtube = href || 'detected but no URL';
                        }
                    });
                    
                    return profiles;
                });

                // Actualizează placeData cu informațiile noi
                placeData.openingHoursStatus = openingHours ? openingHours.status : null;
                placeData.openingHours = openingHours && openingHours.fullSchedule ? openingHours.fullSchedule : null;
                placeData.plusCode = plusCode;
                placeData.imageUrls = imageUrls;
                placeData.socialProfiles = { ...placeData.socialProfiles, ...socialProfiles };


                // Add Place ID if extracted separately
                const placeIdFromUrl = request.url.match(/!1s([^!]+)/);
                 if (!placeData.placeId && placeIdFromUrl && placeIdFromUrl[1]) {
                     placeData.placeId = placeIdFromUrl[1];
                 }


                // 7. Extract Reviews if requested
                placeData.reviews = [];
                if (maxReviews > 0) {
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
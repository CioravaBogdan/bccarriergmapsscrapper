const Apify = require('apify');
const { log } = Apify.utils;

// --- Constants and Regex Patterns ---
// More robust email regex, allows for newer TLDs
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,18}/g;
// Regex for obfuscated emails ( [at] / (at) / [dot] / (dot) ) - simplified
const OBFUSCATED_EMAIL_REGEX = /[a-zA-Z0-9._%+-]+\s*\[\s*(?:at|AT)\s*\]\s*[a-zA-Z0-9.-]+\s*\[\s*(?:dot|DOT)\s*\]\s*[a-zA-Z]{2,18}/g;
// Improved phone regex - attempts to capture more international formats (still basic)
const PHONE_REGEX = /(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(\d{1,5}\)[\s.-]?)?\d{1,5}[\s.-]?\d{2,5}[\s.-]?\d{2,5}[\s.-]?\d{0,5}/g;
// More specific social patterns
const SOCIAL_PATTERNS = {
    facebook: /facebook\.com\/(?:pages\/)?(?:[\w.-]+\/)?(?:[\w.-]+)/i, // More flexible FB pattern
    twitter: /(?:twitter\.com|x\.com)\/(?![a-zA-Z]{1,15}\/status\/\d+)([a-zA-Z0-9_]{1,15})/i, // Exclude status links
    linkedin: /linkedin\.com\/(?:in|pub|company)\/([a-zA-Z0-9-%_.~]+)/i, // More specific paths
    instagram: /instagram\.com\/([a-zA-Z0-9_.]{1,30})/i, // Handles are max 30 chars
    youtube: /youtube\.com\/(?:user|channel|c)\/([a-zA-Z0-9-]+)/i,
    tiktok: /tiktok\.com\/@([a-zA-Z0-9_.]+)/i,
    pinterest: /pinterest\.(?:com|ca|co\.uk|fr|de|es|it|jp|br)\/([a-zA-Z0-9_-]+)/i, // Added Pinterest
    github: /github\.com\/([a-zA-Z0-9_-]+)/i, // Added GitHub
};
// Keywords for finding relevant pages
const CONTACT_PAGE_KEYWORDS = ['contact', 'kontakt', 'contacte', 'contacta', 'imprint', 'impressum', 'legal', 'support', 'hilfe', 'contact-us', 'contact_us'];
const ABOUT_PAGE_KEYWORDS = ['about', 'despre', 'über uns', 'a-propos', 'team', 'management', 'our-team', 'staff', 'employees', 'mitarbeiter'];
// Domains/patterns to exclude from emails
const EXCLUDED_EMAIL_DOMAINS = [
    'example.com', 'domain.com', 'mydomain.com', 'email.com', // Generic placeholders
    'wixpress.com', 'squarespace.com', 'godaddy.com', // Website builders
    'sentry.io', 'googleapis.com', 'google.com', 'gstatic.com', 'schema.org', // Common service/schema domains
    '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.svg', '*.css', '*.js', // File extensions
    'email@domain.com', 'info@domain.com', 'support@domain.com', // Common examples
    'privacy', 'abuse', 'noreply', 'no-reply', 'mailer-daemon', 'jobs', 'careers', // Common functional prefixes
    'webmaster', 'admin', 'administrator', 'hostmaster', // Admin roles
    '@example.', '@domain.', '@localhost', // Incomplete/local
];
const ABORT_RESOURCE_TYPES_DEFAULT = ['image', 'stylesheet', 'font', 'media', 'other']; // Aggressive blocking

// --- Helper: Sanitize Obfuscated Email ---
function sanitizeObfuscatedEmail(text) {
    return text.replace(/\s*\[\s*(?:at|AT)\s*\]\s*/g, '@')
               .replace(/\s*\[\s*(?:dot|DOT)\s*\]\s*/g, '.')
               .replace(/\s+/g, ''); // Remove remaining spaces
}

// --- Helper: Extract Data from Page Content ---
function extractDataFromContent(pageUrl, pageHTML, pageText) {
    const results = { emails: new Set(), phones: new Set(), socialProfiles: {}, contactPersons: [] };

    // --- Extract Emails ---
    // 1. From mailto links
    pageHTML.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,18})/gi)
        ?.forEach(mailto => results.emails.add(mailto.substring(7).toLowerCase()));
    // 2. From plain text using regex
    (pageText.match(EMAIL_REGEX) || []).forEach(email => results.emails.add(email.toLowerCase()));
    // 3. From obfuscated text
    (pageText.match(OBFUSCATED_EMAIL_REGEX) || []).forEach(obfuscated => {
        results.emails.add(sanitizeObfuscatedEmail(obfuscated).toLowerCase());
    });

    // --- Extract Phones ---
    // 1. From tel: links
    pageHTML.match(/tel:((?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(\d{1,5}\)[\s.-]?)?\d{1,5}[\s.-]?\d{2,5}[\s.-]?\d{2,5}[\s.-]?\d{0,5})/gi)
        ?.forEach(tel => results.phones.add(tel.substring(4)));
    // 2. From plain text using regex
    (pageText.match(PHONE_REGEX) || []).forEach(phone => results.phones.add(phone));

    // --- Extract Social Profiles ---
    const links = pageHTML.match(/<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1/gi) || []; // Extract all <a href="...">
    for (const linkTag of links) {
        const hrefMatch = linkTag.match(/href=(["'])(.*?)\1/);
        if (!hrefMatch || !hrefMatch[2]) continue;
        const href = hrefMatch[2];

        if (href.startsWith('mailto:') || href.startsWith('tel:')) continue;

        for (const [platform, pattern] of Object.entries(SOCIAL_PATTERNS)) {
            const match = href.match(pattern);
            if (match && match[1]) { // Ensure a capturing group exists and matched
                // Basic validation/cleanup
                let profileId = match[1].replace(/\/$/, ''); // Remove trailing slash
                // Avoid adding just the domain or very short/generic paths
                if (profileId.length > 1 && !['www', 'http:', 'https:'].includes(profileId.toLowerCase())) {
                    // Construct a cleaner URL (optional, depends on regex)
                    let profileUrl = href; // Use original matched href for now
                    if (!results.socialProfiles[platform]) { // Add only the first found link per platform
                        results.socialProfiles[platform] = profileUrl;
                    }
                }
            }
        }
    }

    // --- Extract Contact Persons (Experimental) ---
    // 1. From JSON-LD Schema
    const jsonLdScripts = pageHTML.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const scriptTag of jsonLdScripts) {
        try {
            const scriptContent = scriptTag.replace(/<[^>]*>/g, ''); // Basic tag removal
            const jsonData = JSON.parse(scriptContent);
            const findPersons = (data) => {
                if (!data) return;
                if (Array.isArray(data)) {
                    data.forEach(findPersons);
                } else if (typeof data === 'object') {
                    if (data['@type'] === 'Person') {
                        results.contactPersons.push({
                            name: data.name || null,
                            title: data.jobTitle || data.description || null,
                            email: data.email || null,
                            phone: data.telephone || null,
                            source: 'JSON-LD',
                        });
                    }
                    // Recursively search in object properties
                    Object.values(data).forEach(findPersons);
                }
            };
            findPersons(jsonData);
        } catch (e) { /* Ignore JSON parsing errors */ }
    }

    // 2. Heuristics: Name near Email (very basic)
    // Example: Look for capitalized words before an email address on the same line
    // This requires more sophisticated NLP or DOM structure analysis for reliability,
    // so we'll keep it simple or omit for now to avoid too many false positives.
    // Consider adding if specific patterns are common on target sites.

    // 3. Heuristics: Team/About page structure (e.g., Name + Title in list items)
    // Example: Look for elements with class "team-member", "employee", etc.
    // This is highly site-specific.

    return results;
}

// --- Helper: Filter and Finalize Extracted Data ---
function finalizeData(rawData) {
    // Filter Emails
    const filteredEmails = [...rawData.emails].filter(email =>
        !EXCLUDED_EMAIL_DOMAINS.some(domainOrPattern => {
            if (domainOrPattern.startsWith('*.')) {
                return email.toLowerCase().endsWith(domainOrPattern.substring(1));
            } else if (domainOrPattern.includes('@')) { // Match full example emails
                 return email.toLowerCase() === domainOrPattern.toLowerCase();
            } else if (domainOrPattern.includes('.')) { // Match domains
                return email.split('@')[1]?.toLowerCase() === domainOrPattern.toLowerCase();
            } else { // Match prefixes
                 return email.split('@')[0]?.toLowerCase() === domainOrPattern.toLowerCase();
            }
        }) && email.includes('.') // Ensure it has a dot (basic TLD check)
    );

    // Filter Phones (basic cleanup and length check)
    const filteredPhones = [...rawData.phones]
        .map(phone => phone.replace(/[^\d+().-]/g, '').trim()) // Allow some chars
        .filter(phone => phone.replace(/\D/g, '').length >= 7); // At least 7 digits

    // Filter Contact Persons (remove duplicates, ensure name exists)
    const uniquePersons = [];
    const seenPersons = new Set();
    rawData.contactPersons.forEach(person => {
        if (person.name) {
            const key = `${person.name.toLowerCase()}-${person.email || ''}-${person.title || ''}`;
            if (!seenPersons.has(key)) {
                uniquePersons.push(person);
                seenPersons.add(key);
            }
        }
    });

    return {
        emails: filteredEmails,
        phones: [...new Set(filteredPhones)], // Deduplicate cleaned phones
        socialProfiles: rawData.socialProfiles,
        contactPersons: uniquePersons,
    };
}

// --- Helper: Find Relevant Page URLs ---
async function findPageUrls(page, baseUrl, keywords) {
    log.debug(`Searching for links with keywords: [${keywords.join(', ')}] on: ${page.url()}`);
    return page.evaluate((kws, base) => {
        const foundUrls = new Set();
        const links = Array.from(document.querySelectorAll('a[href]'));

        for (const link of links) {
            const text = (link.innerText || link.getAttribute('aria-label') || '').trim().toLowerCase();
            const href = link.href;

            // Basic validation
            if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href === base || href === base + '/' || href.includes('javascript:')) continue;

            // Check if link text or URL contains any keyword
            const linkPath = href.replace(base, '').toLowerCase();
            if (kws.some(kw => text.includes(kw) || linkPath.includes(kw))) {
                try {
                    // Resolve relative URLs and add
                    foundUrls.add(new URL(href, base).href);
                } catch (e) { /* Ignore invalid URLs */ }
            }
        }
        return Array.from(foundUrls);
    }, keywords, baseUrl);
}

// --- Main Exported Function ---
/**
 * Extracts contact details (email, phone, social media, contact persons) from a given website URL
 * using an existing Puppeteer browser context.
 *
 * @param {string} websiteUrl The URL of the website to scrape.
 * @param {import('puppeteer').Browser} browser The existing Puppeteer browser instance.
 * @param {object} [options] Optional settings.
 * @param {number} [options.timeout=30000] Navigation timeout per page.
 * @param {number} [options.maxDepth=1] How many levels/pages to check (0=main, 1=main+contact, 2=main+contact+about/team).
 * @param {string[]} [options.abortResourceTypes=ABORT_RESOURCE_TYPES_DEFAULT] Resource types to block.
 */
exports.extractContactDetails = async (websiteUrl, browser, options = {}) => {
    const functionStart = Date.now();
    log.info(`[Contact Extractor] Starting for: ${websiteUrl}`, { url: websiteUrl });

    const {
        timeout = 30000,
        maxDepth = 1, // 0: main, 1: main + contact, 2: main + contact + about/team
        abortResourceTypes = ABORT_RESOURCE_TYPES_DEFAULT,
    } = options;

    let page = null;
    const allRawData = { emails: new Set(), phones: new Set(), socialProfiles: {}, contactPersons: [] };
    const visitedUrls = new Set();
    const result = {
        email: null, // Primary email
        emails: [], // All found emails
        phone: null, // Primary phone
        phones: [], // All found phones
        socialProfiles: {},
        contactPersons: [],
        _extractionTimeMs: null,
        _pagesScanned: [],
        _error: null,
    };

    try {
        page = await browser.newPage();
        log.debug(`[Contact Extractor] New page created for ${websiteUrl}`, { url: websiteUrl });

        // Apply resource blocking
        if (Array.isArray(abortResourceTypes) && abortResourceTypes.length > 0) {
            try {
                await page.setRequestInterception(true);
                page.on('request', (request) => {
                    if (abortResourceTypes.includes(request.resourceType())) {
                        request.abort().catch(e => log.debug(`[Contact Extractor] Error aborting request: ${e.message}`));
                    } else {
                        request.continue().catch(e => log.debug(`[Contact Extractor] Error continuing request: ${e.message}`));
                    }
                });
            } catch (e) {
                 log.warning(`[Contact Extractor] Failed to enable request interception: ${e.message}`, { url: websiteUrl });
            }
        }

        const urlsToVisit = [websiteUrl];
        let currentDepth = 0;

        while (currentDepth <= maxDepth && urlsToVisit.length > 0) {
            const currentUrl = urlsToVisit.shift(); // Get next URL
            if (!currentUrl || visitedUrls.has(currentUrl)) {
                continue; // Skip if invalid or already visited
            }

            log.info(`[Contact Extractor] Visiting [Depth ${currentDepth}]: ${currentUrl}`, { url: websiteUrl });
            visitedUrls.add(currentUrl);
            result._pagesScanned.push(currentUrl);

            try {
                const response = await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout });
                if (!response || !response.ok()) {
                    throw new Error(`Navigation failed with status: ${response?.status()}`);
                }
                log.debug(`[Contact Extractor] Page loaded (status ${response.status()}): ${currentUrl}`, { url: websiteUrl });

                // Extract content
                const pageHTML = await page.content();
                const pageText = await page.evaluate(() => document.body.innerText || '');

                // Extract data from this page's content
                const pageRawData = extractDataFromContent(currentUrl, pageHTML, pageText);
                log.debug(`[Contact Extractor] Data from ${currentUrl}: Emails=${pageRawData.emails.size}, Phones=${pageRawData.phones.size}, Social=${Object.keys(pageRawData.socialProfiles).length}, Persons=${pageRawData.contactPersons.length}`, { url: websiteUrl });

                // Merge data
                pageRawData.emails.forEach(e => allRawData.emails.add(e));
                pageRawData.phones.forEach(p => allRawData.phones.add(p));
                allRawData.socialProfiles = { ...pageRawData.socialProfiles, ...allRawData.socialProfiles }; // Prioritize later pages? Or first? Let's prioritize first found.
                allRawData.contactPersons.push(...pageRawData.contactPersons);

                // Find links for the next level (only if depth allows)
                if (currentDepth < maxDepth) {
                    let keywordsForNextLevel = [];
                    if (currentDepth === 0) keywordsForNextLevel = CONTACT_PAGE_KEYWORDS; // Look for contact page first
                    if (currentDepth === 1) keywordsForNextLevel = ABOUT_PAGE_KEYWORDS; // Then look for about/team page

                    if (keywordsForNextLevel.length > 0) {
                        const foundUrls = await findPageUrls(page, websiteUrl, keywordsForNextLevel);
                        foundUrls.forEach(url => {
                            if (!visitedUrls.has(url)) {
                                urlsToVisit.push(url); // Add potential pages for next depth level
                            }
                        });
                    }
                }

            } catch (e) {
                log.warning(`[Contact Extractor] Failed to process ${currentUrl}: ${e.message}`);
                if (!result._error) result._error = `Failed page ${currentUrl}: ${e.message}`; // Store first error
            }
            currentDepth++; // Increment depth after processing a URL from the queue (or attempting to)
             // Reset depth logic slightly - process all found contact pages (depth 1), then all found about pages (depth 2)
             // This requires restructuring the loop. Let's stick to the simpler depth limit for now.
        } // End while loop

        // --- Finalize and Assign Results ---
        const finalData = finalizeData(allRawData);
        result.emails = finalData.emails;
        result.phones = finalData.phones;
        result.socialProfiles = finalData.socialProfiles;
        result.contactPersons = finalData.contactPersons;

        // Assign primary email/phone (simple logic: first from the list)
        if (result.emails.length > 0) result.email = result.emails[0];
        if (result.phones.length > 0) result.phone = result.phones[0];


    } catch (error) {
        log.error(`[Contact Extractor] Unexpected error during extraction for ${websiteUrl}: ${error.message}`, { url: websiteUrl });
        result._error = `Unexpected error: ${error.message}`;
    } finally {
        if (page) {
            try {
                await page.close();
                log.debug(`[Contact Extractor] Closed page for ${websiteUrl}`, { url: websiteUrl });
            } catch (closeError) {
                log.warning(`[Contact Extractor] Failed to close page for ${websiteUrl}: ${closeError.message}`);
            }
        }
        result._extractionTimeMs = Date.now() - functionStart;
    }

    log.info(`[Contact Extractor] Finished for ${websiteUrl} in ${result._extractionTimeMs}ms. Pages: ${result._pagesScanned.length}. Found: Emails=${result.emails.length}, Phones=${result.phones.length}, Social=${Object.keys(result.socialProfiles).length}, Persons=${result.contactPersons.length}, Error=${result._error || 'None'}`, { url: websiteUrl });
    return result;
};
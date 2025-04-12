const Apify = require('apify');
const { log } = Apify.utils;

/**
 * Attempts to extract email and social media links from a given website URL.
 * This is a basic placeholder implementation. A robust solution would involve
 * more sophisticated HTML parsing, potentially crawling multiple pages (Contact, About),
 * and handling various website structures.
 *
 * @param {string} websiteUrl The URL of the website to scrape.
 * @param {Apify.ProxyConfiguration | null} proxyConfiguration Optional proxy configuration.
 * @returns {Promise<{email: string|null, socialProfiles: Record<string, string>}>}
 */
async function extractContactDetails(websiteUrl, proxyConfiguration) {
    log.debug(`Requesting website for contact details: ${websiteUrl}`);
    let email = null;
    const socialProfiles = {};

    try {
        const { body: html } = await Apify.utils.requestAsBrowser({
            url: websiteUrl,
            proxyUrl: proxyConfiguration ? proxyConfiguration.newUrl() : undefined,
            // Ignore SSL errors, as many small business sites might have issues
            ignoreSslErrors: true,
            // Set a timeout for the request
            timeoutSecs: 20
        });

        if (!html) {
            log.warning(`No HTML content received from ${websiteUrl}`);
            return { email, socialProfiles };
        }

        // Basic email regex (can find false positives)
        const emailMatches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi);
        if (emailMatches) {
            // Find the first email that doesn't look like an image file or common exclusion
            email = emailMatches.find(e => !/\.(png|jpg|jpeg|gif)$/i.test(e) && !e.includes('example.com') && !e.includes('domain.com') && !e.includes('wixpress.com')) || null;
            if (email) log.debug(`Found potential email: ${email}`);
        }

        // Basic social media link regexes
        const socialPatterns = {
            facebook: /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9_.-]+/gi,
            instagram: /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.-]+/gi,
            twitter: /https?:\/\/(?:www\.)?twitter\.com\/[A-Za-z0-9_]+/gi,
            linkedin: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9_.-]+/gi,
            // Add more patterns as needed (YouTube, Pinterest, etc.)
        };

        for (const [platform, regex] of Object.entries(socialPatterns)) {
            const matches = html.match(regex);
            if (matches) {
                // Find the first unique, valid-looking URL
                const foundUrl = matches.find(url => url.length > `https://www.${platform}.com/`.length + 2); // Basic sanity check
                if (foundUrl && !socialProfiles[platform]) {
                     socialProfiles[platform] = foundUrl;
                     log.debug(`Found potential ${platform} link: ${foundUrl}`);
                }

            }
        }

    } catch (error) {
        // Log specific errors like timeouts, SSL issues, etc.
        log.warning(`Error fetching or parsing website ${websiteUrl}: ${error.message}`);
        // Don't throw, just return empty results
    }

    return { email, socialProfiles };
}

module.exports = { extractContactDetails };
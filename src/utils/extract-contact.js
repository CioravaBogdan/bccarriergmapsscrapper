const Apify = require('apify');
const { log } = Apify.utils;
const puppeteer = require('puppeteer-extra');

// Funcție pentru extragerea datelor de contact de pe un website
exports.extractContactDetails = async (websiteUrl, proxyConfiguration) => {
    log.info(`Extracting contact details from: ${websiteUrl}`);
    
    const browser = await Apify.launchPuppeteer({
        useChrome: true,
        stealth: true,
        proxyUrl: proxyConfiguration ? proxyConfiguration.newUrl() : undefined,
        launchOptions: {
            headless: true,
        },
    });
    
    const result = {
        email: null,
        socialProfiles: {},
    };
    
    try {
        const page = await browser.newPage();
        
        // Set timeout to avoid waiting too long
        await page.setDefaultNavigationTimeout(30000);
        
        // Set user-agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Navigate to website
        await page.goto(websiteUrl, { waitUntil: 'domcontentloaded' });
        
        // Extract emails from the page using regex
        const emails = await page.evaluate(() => {
            const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            const bodyText = document.body.innerText;
            const matches = bodyText.match(emailRegex) || [];
            
            // Filter out common false positives
            return [...new Set(matches)].filter(email => 
                !email.includes('example.com') && 
                !email.includes('domain.com') && 
                !email.includes('@email')
            );
        });
        
        if (emails.length > 0) {
            result.email = emails[0]; // Use first found email
        }
        
        // Extract social media profiles
        const socialProfiles = await page.evaluate(() => {
            const profiles = {};
            const links = Array.from(document.querySelectorAll('a[href]'));
            
            const socialPatterns = {
                facebook: /facebook\.com/i,
                twitter: /twitter\.com|x\.com/i,
                linkedin: /linkedin\.com/i,
                instagram: /instagram\.com/i,
                youtube: /youtube\.com/i,
                tiktok: /tiktok\.com/i,
            };
            
            for (const link of links) {
                const href = link.href;
                
                for (const [platform, pattern] of Object.entries(socialPatterns)) {
                    if (pattern.test(href)) {
                        profiles[platform] = href;
                    }
                }
            }
            
            return profiles;
        });
        
        result.socialProfiles = socialProfiles;
        
        // Try to find a contact page and extract more info
        const contactPageLink = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href]'));
            const contactKeywords = ['contact', 'contacte', 'despre noi', 'about', 'contacta'];
            
            for (const link of links) {
                const text = link.innerText.toLowerCase();
                
                for (const keyword of contactKeywords) {
                    if (text.includes(keyword)) {
                        return link.href;
                    }
                }
            }
            
            return null;
        });
        
        if (contactPageLink) {
            log.info(`Found contact page: ${contactPageLink}`);
            await page.goto(contactPageLink, { waitUntil: 'domcontentloaded' });
            
            // Extract more emails from contact page
            const contactEmails = await page.evaluate(() => {
                const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
                const bodyText = document.body.innerText;
                return [...new Set(bodyText.match(emailRegex) || [])];
            });
            
            if (contactEmails.length > 0 && !result.email) {
                result.email = contactEmails[0];
            }
        }
        
    } catch (error) {
        log.warning(`Error while scraping website: ${error.message}`);
    } finally {
        await browser.close();
    }
    
    return result;
};
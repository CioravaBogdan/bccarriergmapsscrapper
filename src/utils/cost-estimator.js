/**
 * Simple cost estimator for tracking Google Maps scraping costs
 * based on typical compute and proxy usage for various operations.
 */
class CostEstimator {
    constructor(maxCostUsd = 0) {
        // Initialize counters
        this.placeSearches = 0;        // Number of search queries
        this.placesListed = 0;         // Places found in search results
        this.detailPagesScrapes = 0;   // Number of detail pages visited
        this.contactExtractions = 0;   // Number of website contact extractions
        this.maxCost = maxCostUsd || 0;// Maximum allowed cost (0 = unlimited)
        
        // Default cost factors (in USD)
        this.costPerSearch = 0.005;        // Cost per search query
        this.costPerListingBatch = 0.001;  // Cost per 10 places found in results
        this.costPerDetailPage = 0.01;     // Cost per place detail page
        this.costPerContactExtraction = 0.02; // Cost per website visit for contact info
    }

    /**
     * Set the maximum cost limit (0 = unlimited)
     * @param {number} maxCostUsd Maximum cost in USD
     */
    setMaxCost(maxCostUsd) {
        this.maxCost = maxCostUsd || 0;
    }

    /**
     * Add a place detail scrape and check budget
     * @returns {boolean} False if budget exceeded
     */
    addPlace(count = 1) {
        this.detailPagesScrapes += count;
        return this.checkBudget();
    }

    /**
     * Add details extraction cost and check budget
     * @returns {boolean} False if budget exceeded
     */
    addDetails(count = 1) {
        // This is a lighter operation than a full detail page scrape
        this.detailPagesScrapes += count * 0.5;
        return this.checkBudget();
    }

    /**
     * Add contact extraction cost and check budget
     * @returns {boolean} False if budget exceeded
     */
    addContact(count = 1) {
        this.contactExtractions += count;
        return this.checkBudget();
    }

    /**
     * Check if current cost is within budget
     * @returns {boolean} False if budget exceeded
     */
    checkBudget() {
        if (this.maxCost <= 0) return true; // 0 = unlimited
        return this.getCurrentCost() < this.maxCost;
    }

    /**
     * Log a search operation
     * @param {number} searchCount Number of searches (default: 1)
     */
    addSearches(searchCount = 1) {
        this.placeSearches += searchCount;
    }

    /**
     * Log listing results
     * @param {number} placesCount Number of places found
     */
    addListings(placesCount = 1) {
        this.placesListed += placesCount;
    }

    /**
     * Calculate the current estimated cost
     * @returns {number} Estimated cost in USD
     */
    getCurrentCost() {
        return (
            this.placeSearches * this.costPerSearch +
            Math.ceil(this.placesListed / 10) * this.costPerListingBatch +
            this.detailPagesScrapes * this.costPerDetailPage +
            this.contactExtractions * this.costPerContactExtraction
        );
    }

    /**
     * Check if the estimated cost exceeds the maximum allowed cost
     * @returns {boolean} True if cost limit is reached or exceeded
     */
    isCostLimitReached() {
        if (this.maxCost <= 0) return false; // 0 means unlimited
        return this.getCurrentCost() >= this.maxCost;
    }

    /**
     * Log a summary of cost data
     */
    async logReport() {
        const { Actor, log } = require('apify');
        const summary = this.getSummary();
        log.info(`Cost Summary: $${summary.costs.totalCost} (${summary.operations.detailPagesScrapes} detail pages, ${summary.operations.contactExtractions} contact extractions)`);
        await Actor.setValue('COST_SUMMARY', summary);
    }

    /**
     * Get a summary of the current operations and costs
     * @returns {Object} Summary object
     */
    getSummary() {
        const currentCost = this.getCurrentCost();
        return {
            operations: {
                searches: this.placeSearches,
                listingsFound: this.placesListed,
                detailPagesScrapes: this.detailPagesScrapes,
                contactExtractions: this.contactExtractions
            },
            costs: {
                searchCost: (this.placeSearches * this.costPerSearch).toFixed(4),
                listingsCost: (Math.ceil(this.placesListed / 10) * this.costPerListingBatch).toFixed(4),
                detailPagesCost: (this.detailPagesScrapes * this.costPerDetailPage).toFixed(4),
                contactExtractionsCost: (this.contactExtractions * this.costPerContactExtraction).toFixed(4),
                totalCost: currentCost.toFixed(4)
            },
            limits: {
                maxCost: this.maxCost > 0 ? this.maxCost.toFixed(2) : "Unlimited",
                costLimitReached: this.isCostLimitReached()
            }
        };
    }
}

module.exports = CostEstimator;
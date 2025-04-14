FROM apify/actor-node-puppeteer-chrome:latest

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies (no dev dependencies)
RUN npm install --omit=dev

# Copy the rest of the code
COPY . ./

# Command to run the scraper
CMD ["npm", "start"]
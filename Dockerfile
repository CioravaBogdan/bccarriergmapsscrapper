FROM apify/actor-node-puppeteer-chrome:latest

# Switch to root user for npm install
USER root

# Set environment variable to skip Chromium download
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Set working directory
WORKDIR /usr/src/app

# Copy package.json files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the code
COPY . ./

# Switch back to the non-root user for better security
USER myuser

# Command to run when the container starts
CMD ["npm", "start"]
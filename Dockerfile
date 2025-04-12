# Use the official Apify image with Node.js and Puppeteer/Chrome
FROM apify/actor-node-puppeteer-chrome:latest

# Switch to root for installation
USER root

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies as root
RUN npm install --omit=dev

# Copy the rest of the application code
COPY . ./

# Make sure non-root user owns the files
RUN chown -R myuser:myuser /usr/src/app

# Switch back to non-root user for runtime security
USER myuser

# Run npm start as the default command
CMD ["npm", "start"]
# Use the official Apify image with Node.js and Puppeteer/Chrome
FROM apify/actor-node-puppeteer-chrome:latest

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy the rest of the application code (src folder, apify.json, etc.)
COPY . .

# Define the command to run the actor
CMD [ "npm", "start" ]
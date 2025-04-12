# Use the official Apify image with Node.js and Puppeteer/Chrome
FROM apify/actor-node-puppeteer-chrome:latest

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Create node_modules directory with proper permissions and install dependencies
RUN mkdir -p node_modules && \
    chown -R myuser:myuser /app && \
    su myuser -c "npm install --omit=dev"

# Copy the rest of the application code (src folder, apify.json, etc.)
COPY . .

# Ensure proper permissions for all files
RUN chown -R myuser:myuser /app

# Switch to the non-root user for better security
USER myuser

# Define the command to run the actor
CMD [ "npm", "start" ]
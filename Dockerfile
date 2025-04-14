FROM apify/actor-node-puppeteer-chrome:latest

# Switch to root user for npm install
USER root

# Set working directory
WORKDIR /usr/src/app

# Copy package.json files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the code
COPY . ./

# Switch back to the non-root user for better security
# The apify/actor-node images use 'myuser' as the default user
USER myuser

# Command to run when the container starts
CMD ["npm", "start"]
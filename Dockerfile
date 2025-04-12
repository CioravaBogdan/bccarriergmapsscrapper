# Use the official Apify image with Node.js and Puppeteer/Chrome
FROM apify/actor-node-puppeteer-chrome:latest

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install NPM packages
RUN npm install --only=prod --no-optional

# Copy the rest of the application code
COPY . ./

# Run npm start as the default command
CMD [ "npm", "start" ]
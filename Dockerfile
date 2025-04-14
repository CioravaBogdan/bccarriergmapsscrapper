FROM apify/actor-node-puppeteer-chrome:latest

# Set working directory
WORKDIR /usr/src/app

# Copy package.json files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the code
COPY . ./

# Command to run when the container starts
CMD ["npm", "start"]
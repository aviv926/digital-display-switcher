# Use an official Node.js runtime as a parent image
# Alpine Linux based image for smaller size
FROM node:20-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install app dependencies using --production flag to only install dependencies (not devDependencies)
RUN npm install --production --loglevel error

# Bundle app source code
COPY . .

# Make port configured in .env available to the world outside this container
# The actual port number will be read from the .env file by server.js
# We expose a common default; the docker-compose mapping handles the external connection.
EXPOSE 3000

# Define environment variable (can be overridden by docker-compose)
# Set default timezone, docker-compose will override with .env value
ENV NODE_ENV=production
ENV TZ=UTC

# Run the app when the container launches
CMD [ "node", "server.js" ]

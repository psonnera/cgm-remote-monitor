# Stage 1: Build webpack bundles with Node.js
FROM node:20-slim AS builder

WORKDIR /opt/app
ADD . /opt/app

# Install git (required for GitHub dependencies) and build tools
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Install dependencies and build webpack bundles (skip all npm scripts)
RUN npm install --include=dev --ignore-scripts && \
  echo "Building webpack bundles..." && \
  mkdir -p node_modules/.cache/_ns_cache/public && \
  npx webpack --mode production --config webpack/webpack.config.js && \
  echo "Verifying bundles..." && \
  ls -lah node_modules/.cache/_ns_cache/public/js/ && \
  test -f node_modules/.cache/_ns_cache/public/js/bundle.app.js && echo "✓ bundle.app.js created" || exit 1 && \
  test -f node_modules/.cache/_ns_cache/public/js/bundle.vendor.js && echo "✓ bundle.vendor.js created" || exit 1

# Stage 2: Runtime with Bun
FROM oven/bun:latest

LABEL maintainer="Nightscout Contributors"

# Accept git commit hash as build argument
ARG HEAD=unknown

WORKDIR /opt/app

# Copy application files
COPY . /opt/app

# Install production dependencies only
RUN bun install --production --ignore-scripts && \
  echo "Production packages installed"

# Copy webpack bundles from builder stage
COPY --from=builder /opt/app/node_modules/.cache/_ns_cache /opt/app/node_modules/.cache/_ns_cache

# Verify bundles were copied
RUN ls -lah node_modules/.cache/_ns_cache/public/js/ && \
  test -f node_modules/.cache/_ns_cache/public/js/bundle.app.js && echo "✓ bundle.app.js present" || exit 1 && \
  test -f node_modules/.cache/_ns_cache/public/js/bundle.vendor.js && echo "✓ bundle.vendor.js present" || exit 1

# Debug: Check what was actually created
RUN echo "Checking cache directory structure:" && \
  find node_modules/.cache -type f -name "bundle.*" 2>/dev/null | head -20 || echo "No bundle files found" && \
  echo "" && \
  echo "Full cache directory tree:" && \
  find node_modules/.cache/_ns_cache -type f 2>/dev/null | head -20 || echo "Cache structure not found"

# Generate cache buster key and git commit info
RUN mkdir -p node_modules/.cache/_ns_cache && \
  bun bin/generateRandomString.js > node_modules/.cache/_ns_cache/randomString && \
  bun bin/generateGitCommit.js && \
  echo "Cache buster and git commit generated"

# Clean up temporary files
RUN rm -rf /tmp/*

# Set the HEAD environment variable from build arg
ENV HEAD=${HEAD}

# Avoid container-provided HOSTNAME values (e.g. random pod/container names)
# that can prevent external traffic from reaching the process.
ENV HOSTNAME=0.0.0.0

EXPOSE 1337

# Railway injects HOSTNAME with a container id. Override it at process launch
# so the app binds to all interfaces and is reachable via the proxy.
CMD ["env", "HOSTNAME=0.0.0.0", "bun", "lib/server/server.js"]

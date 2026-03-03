FROM oven/bun:latest

LABEL maintainer="Nightscout Contributors"

# Accept git commit hash as build argument
ARG HEAD=unknown

WORKDIR /opt/app
ADD . /opt/app

# Temporarily skip postinstall hook for webpack (it fails silently in Docker)
# The '--ignore-scripts' flag prevents postinstall from running during bun install
RUN bun install --ignore-scripts && \
  echo "Packages installed (webpack postinstall skipped)"

# Copy pre-built webpack bundles from build context if they exist
# These are built locally with: bun run bundle
RUN if [ -d node_modules/.cache/_ns_cache/public/js ] && [ -f node_modules/.cache/_ns_cache/public/js/bundle.app.js ]; then \
    echo "✓ Using pre-built webpack bundles"; \
  else \
    echo "⚠ Creating empty bundle directory (bundles will be generated at runtime if needed)"; \
    mkdir -p node_modules/.cache/_ns_cache/public/js; \
  fi

# Still run post-generate-keys script for randomString and gitCommit
RUN mkdir -p node_modules/.cache/_ns_cache && \
  bun bin/generateRandomString.js > node_modules/.cache/_ns_cache/randomString && \
  bun bin/generateGitCommit.js && \
  echo "Keys generated"

# Clean up temporary files
RUN rm -rf /tmp/*

# Set the HEAD environment variable from build arg
ENV HEAD=${HEAD}

EXPOSE 1337

CMD ["bun", "lib/server/server.js"]

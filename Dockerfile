FROM oven/bun:latest

LABEL maintainer="Nightscout Contributors"

# Accept git commit hash as build argument
ARG HEAD=unknown

WORKDIR /opt/app
ADD . /opt/app

# TODO: We should be able to do `RUN bun install --production`.
# For this to work, we need to copy only package.json and things needed for `bun`'s to succeed.
# TODO: Do we need to re-add `bun audit` or similar? Or should that be part of a development process/stage?
RUN bun install && \
  bun run postinstall && \
  bun env && \
  rm -rf /tmp/*
  # TODO: These should be added in the future to correctly cache express-minify content to disk
  # Currently, doing this breaks the browser cache.
  # mkdir /tmp/public && \
  # chown bun:bun /tmp/public

# Set the HEAD environment variable from build arg
ENV HEAD=${HEAD}

EXPOSE 1337

CMD ["bun", "lib/server/server.js"]

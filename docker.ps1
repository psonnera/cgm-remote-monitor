# Get the short git commit hash
$commit = git rev-parse --short HEAD
# Build the Docker image with the short commit hash
docker build --build-arg HEAD=$commit --no-cache . -t psonnera/cgm-remote-monitor:dev-AAPS
# Push in Docker Hub
docker image push psonnera/cgm-remote-monitor:dev-AAPS

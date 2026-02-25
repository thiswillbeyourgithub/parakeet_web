#!/bin/zsh

set -euo pipefail


sleep 0.1
ssh $VPS_USERNAME@$VPS_IP -p $VPS_PORT -C "cd ~/docker/parakeet_web && { git pull --force || { echo 'Failed to pull --force so have to stash first' && git stash && git pull --force --rebase } } && echo 'Done pulling'"


# Build the new image while the old container is still serving traffic,
# then do a quick stop+volume-remove+restart to minimize downtime.
# The volume removal prevents ENOTEMPTY errors from stale node_modules
# when dependencies change between deploys.
echo "\nBuilding new image (old container still running)"
ssh $VPS_USERNAME@$VPS_IP -p $VPS_PORT -C "cd ~/docker/parakeet_web && sudo docker compose build && echo 'Done building'"

echo "\nSwapping: stop old container, remove stale node_modules volumes, start new"
ssh $VPS_USERNAME@$VPS_IP -p $VPS_PORT -C "cd ~/docker/parakeet_web && sudo docker compose down -v && sudo docker compose up -d && echo 'Done launching compose'"

sleep 1
echo "\nChecking wether the compose is running."
ssh $VPS_USERNAME@$VPS_IP -p $VPS_PORT -C "val=\$(sudo docker inspect parakeetweb | jq -r '.[0][\"State\"][\"Status\"]') ; echo \"parakeetweb container Stats is: \$val\""

sleep 5
echo "\nChecking wether the compose is STILL running after 5s."
ssh $VPS_USERNAME@$VPS_IP -p $VPS_PORT -C "val=\$(sudo docker inspect parakeetweb | jq -r '.[0][\"State\"][\"Status\"]') ; echo \"parakeetweb container Stats is: \$val\""

echo "All done"


set +euo pipefail

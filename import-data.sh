
#!/bin/bash
# import-data.sh
# This script calls the specific Docker Compose services to import data into FlyNext (and AFS, if applicable).
# Make sure your Docker Compose services are up and running before executing this script.

set -e

echo "Waiting for services to start..."
# Optionally wait for a few seconds to allow containers to fully start
sleep 10

echo "Starting data import for FlyNext..."

# Example: Assuming your PostgreSQL service is named flynext-postgres,
# the username is postgres, the database name is flynextdb,
# and your SQL file is located in /app/data/hotels_data.sql inside the container.
docker-compose exec flynext-postgres psql -U postgres -d flynextdb -f /prisma/generate_data.sql

echo "FlyNext data import completed."

# If you have an AFS data import process, add the corresponding command below:
# echo "Starting data import for AFS..."
# docker-compose exec afs-service <your-import-command>
# echo "AFS data import completed."

echo "All data has been imported successfully."

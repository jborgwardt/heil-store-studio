export APP_GUACAMOLE_DB_PASSWORD="$(derive_entropy "env-${app_entropy_identifier}-DB_PASSWORD" | head -c32)"

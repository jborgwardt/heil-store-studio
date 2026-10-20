export APP_ALTMOUNT_JWT_SECRET="$(derive_entropy "env-${app_entropy_identifier}-JWT_SECRET" | head -c64)"

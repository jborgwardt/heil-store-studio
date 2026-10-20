export APP_BUBBALOSTREAMER_ADDON_SECRET="$(derive_entropy "env-${app_entropy_identifier}-ADDON_SHARED_SECRET" | head -c48)"

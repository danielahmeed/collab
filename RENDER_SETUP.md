Steps to add environment variables on Render

1. Open your Render dashboard and select your service.
2. Go to the "Environment" or "Environment Variables" section.
3. Add the following keys (paste the values from your local `.env.local`):
   - `MONGODB_URI` = <your Atlas connection string>
   - `MONGODB_DB_NAME` = digiboard
   - `GOOGLE_CLIENT_ID` = <Google OAuth client id>
   - `GOOGLE_CLIENT_SECRET` = <Google OAuth client secret>
   - `GOOGLE_REDIRECT_URI` = https://<your-service>.onrender.com/api/auth/google/callback
4. Save and trigger a deploy (Manual Deploy → Deploy Latest or push to GitHub).

Troubleshooting tips
- If the app falls back to in-memory persistence, check Atlas network access (allow Render IPs or temporarily add 0.0.0.0/0).
- Ensure the `GOOGLE_REDIRECT_URI` above is also registered in Google Cloud Console (Credentials → OAuth 2.0 Client IDs → Authorized redirect URIs).
- If TLS/SSL errors occur connecting to Atlas, verify your connection string and Atlas network settings.

If you want, I can:
- watch the next deploy logs and triage errors, or
- prepare a `render.yaml` for infra-as-code (you'll still need to add secrets in Render dashboard).

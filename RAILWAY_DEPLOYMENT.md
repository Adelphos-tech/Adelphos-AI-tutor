# Railway Deployment Guide

## ✅ How to Fix the Build Error

The error occurs because Railway can't find `package.json` at the repo root.  
Your Next.js app is inside the `intellitutor` folder.

**Solution:** Configure Railway to use `intellitutor` as the root directory.

---

## 🚀 Deploy Steps

### 1. Configure Root Directory in Railway

In Railway dashboard:

1. Go to your **Adelphos-AI-tutor** service
2. Click **Settings** tab
3. Scroll to **Source** section
4. Find **Root Directory** field
5. Enter: `intellitutor`
6. Click **Save** or it auto-saves

### 2. Add Railway Postgres Database

In Railway dashboard:

1. Click **+ New**
2. Select **Database** → **PostgreSQL**  
3. Railway automatically creates `DATABASE_URL` variable ✅

### 3. Set Environment Variables

Go to **Variables** tab → Click **"Raw Editor"** → Paste these:

```bash
DEEPGRAM_API_KEY=your_actual_deepgram_api_key_here
GEMINI_API_KEY=your_actual_gemini_api_key_here
GEMINI_SPEECH_MODEL=gemini-2.5-flash-preview-tts
PINECONE_API_KEY=your_actual_pinecone_api_key_here
PINECONE_ENVIRONMENT=your_pinecone_environment_here
PINECONE_INDEX_NAME=intellitutor-vectors
NEXTAUTH_URL=https://your-app-name.up.railway.app
NEXTAUTH_SECRET=9K30GEWth5VGVkn/3XY9VzG/mWooXrER5KE4XXp9aDM=
MAX_FILE_SIZE=209715200
UPLOAD_DIR=/tmp/uploads
```

**Get your API keys from:**
- **Deepgram**: https://console.deepgram.com/
- **Gemini**: https://aistudio.google.com/app/apikey
- **Pinecone**: https://app.pinecone.io/

Replace all `your_actual_...` placeholders with real values.

### 4. Trigger Redeploy

After setting the root directory and environment variables:

1. Go to **Deployments** tab
2. Click the **three dots `⋮`** on the failed deployment
3. Click **"Redeploy"**
4. Watch the build logs - it should now succeed ✅

### 5. Update NEXTAUTH_URL After Deploy

After successful deployment:

1. Copy your Railway app URL (e.g., `https://adelphos-ai-tutor-production.up.railway.app`)
2. Go back to **Variables** tab
3. Update `NEXTAUTH_URL` with the real URL
4. Redeploy again

---

## 🔍 Troubleshooting

### If build still fails:

1. Check the build logs in Railway
2. Verify all environment variables are set
3. Make sure `DATABASE_URL` is valid
4. Ensure Prisma migrations run (add to build command if needed)

### If app crashes on start:

- Check that `DATABASE_URL` is accessible
- Verify all API keys are correct
- Look at Runtime logs in Railway

### Database migrations:

If you need to run Prisma migrations on Railway:

1. Go to **Settings** tab
2. Find **Build Command** (or **Custom Build Command**)
3. Enter:
   ```bash
   npm install && npx prisma generate && npx prisma migrate deploy && npm run build
   ```
4. Save and redeploy

---

## 📝 Notes

- Railway automatically detects Next.js apps from `package.json`
- Set root directory to `intellitutor` in Settings → Source
- The app will be available at `https://your-project.up.railway.app`
- Logs are available in the Railway dashboard
- Railway provides 500 hours/month free tier

---

## 🐍 Deploying the Python Voice Backend (Optional)

If you also want to deploy the `voice-backend` Python service:

1. Create a **new service** in Railway
2. Connect the same GitHub repo
3. Create a `railway.toml` in the root (or use Railway dashboard):
   - Set root directory to `voice-backend`
   - Build command: `pip install -r requirements.txt`
   - Start command: `python main_websocket.py` (or whichever file you want)
4. Add environment variables from `voice-backend/.env`

Let me know if you need help with this!

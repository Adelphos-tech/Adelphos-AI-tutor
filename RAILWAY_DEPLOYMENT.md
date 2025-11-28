# Railway Deployment Guide

## ✅ Fixed Issues

Created `railway.toml` at the root to tell Railway:
- Build from the `intellitutor` directory
- Use Node.js 22
- Run `npm install && npm run build` 
- Start with `npm run start`

This fixes the "Error creating build plan with Railpack" error.

---

## 🚀 Deploy Steps

### 1. Push the railway.toml file

```bash
git add railway.toml RAILWAY_DEPLOYMENT.md
git commit -m "Add Railway deployment config"
git push origin main
```

### 2. Set Environment Variables in Railway

Go to your Railway project → **Variables** tab and add these:

#### Required Variables

```bash
# Database (use Railway Postgres plugin or external DB)
DATABASE_URL=postgresql://user:password@host:5432/intellitutor

# Gemini API
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_SPEECH_MODEL=gemini-2.5-flash-preview-tts

# Pinecone
PINECONE_API_KEY=your_pinecone_api_key_here
PINECONE_ENVIRONMENT=your_pinecone_environment
PINECONE_INDEX_NAME=intellitutor-vectors

# NextAuth
NEXTAUTH_URL=https://your-app.railway.app
NEXTAUTH_SECRET=your_nextauth_secret_here

# File Upload
MAX_FILE_SIZE=209715200
UPLOAD_DIR=/tmp/uploads
```

#### Optional (for S3 file storage)

```bash
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=intellitutor-files
```

### 3. Add Railway Postgres (Recommended)

1. In your Railway project, click **+ New**
2. Select **Database** → **PostgreSQL**
3. Railway will automatically set `DATABASE_URL` for you

### 4. Generate NEXTAUTH_SECRET

Run this locally and copy the output:

```bash
openssl rand -base64 32
```

Paste it as the `NEXTAUTH_SECRET` value in Railway.

### 5. Update NEXTAUTH_URL

After deployment, Railway will give you a URL like `https://adelphos-ai-tutor-production.up.railway.app`

Update the `NEXTAUTH_URL` variable to match that URL.

### 6. Trigger Deployment

After pushing `railway.toml` and setting all environment variables:

1. Go to **Deployments** tab
2. Click **Deploy** or it will auto-deploy from your latest commit
3. Watch the build logs - it should now succeed

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

If you need to run Prisma migrations on Railway, update the build command in `railway.toml`:

```toml
buildCommand = "cd intellitutor && npm install && npx prisma generate && npx prisma migrate deploy && npm run build"
```

---

## 📝 Notes

- Railway automatically detects the `railway.toml` file
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
